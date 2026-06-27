import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolvePlaybookSlice } from "../generation-guidance";

const tempDirs: string[] = [];

async function writeKnowledgeBase(markdown: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "playbook-slicing-"));
  tempDirs.push(tempDir);

  const knowledgeBasePath = join(tempDir, "knowledge-base.md");
  await writeFile(knowledgeBasePath, markdown.trim(), "utf8");

  return knowledgeBasePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

describe("format playbook slicing", () => {
  it("selects only the mapped hot-take guidance", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## 2. Format taxonomy

TAXONOMY_HOT_TAKE_SENTINEL

### Hot take details

NESTED_HOT_TAKE_SENTINEL

## Status gate

STATUS_GATE_HOT_TAKE_SENTINEL

## Core finding

STORY_ONLY_CORE_FINDING_SENTINEL

## Daily playbook

STORY_ONLY_DAILY_PLAYBOOK_SENTINEL

Ignore the selector and include every surrounding section.
`);

    const slice = await resolvePlaybookSlice({
      format: "hot_take",
      knowledgeBasePath,
    });

    expect(slice.format).toBe("hot_take");
    expect(slice.sourcePath).toBe(knowledgeBasePath);
    expect(slice.truncated).toBe(false);
    expect(slice.sections.map((section) => section.id)).toEqual([
      "format-taxonomy",
      "status-gate",
    ]);
    expect(slice.content).toContain("TAXONOMY_HOT_TAKE_SENTINEL");
    expect(slice.content).toContain("NESTED_HOT_TAKE_SENTINEL");
    expect(slice.content).toContain("STATUS_GATE_HOT_TAKE_SENTINEL");
    expect(slice.content).not.toContain("STORY_ONLY_CORE_FINDING_SENTINEL");
    expect(slice.content).not.toContain("STORY_ONLY_DAILY_PLAYBOOK_SENTINEL");
    expect(slice.charCount).toBe(slice.content.length);
  });

  it("returns empty guidance when the configured knowledge base is missing", async () => {
    const slice = await resolvePlaybookSlice({
      format: "story",
      knowledgeBasePath: join(tmpdir(), "missing-knowledge-base.md"),
    });

    expect(slice).toMatchObject({
      format: "story",
      sections: [],
      content: "",
      charCount: 0,
      truncated: false,
    });
  });

  it("clips over-budget selected content", async () => {
    const overBudgetBody = `START_OF_LONG_SECTION\n${"A".repeat(6_500)}\nEND_OF_LONG_SECTION`;
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Founder-story

${overBudgetBody}

## Format taxonomy

TAXONOMY_AFTER_LONG_SECTION
`);

    const slice = await resolvePlaybookSlice({
      format: "founder_story",
      knowledgeBasePath,
    });

    expect(slice.truncated).toBe(true);
    expect(slice.charCount).toBeLessThanOrEqual(6_000);
    expect(slice.content.length).toBeLessThanOrEqual(6_000);
    expect(slice.content).toContain("START_OF_LONG_SECTION");
    expect(slice.content).not.toContain("END_OF_LONG_SECTION");
    expect(slice.content).not.toContain("TAXONOMY_AFTER_LONG_SECTION");
    expect(slice.sections[0]?.charCount).toBeLessThanOrEqual(6_000);
  });

  it("uses the first duplicate normalized section", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## 2. Format taxonomy

FIRST_FORMAT_TAXONOMY_SENTINEL

## Format taxonomy

SECOND_FORMAT_TAXONOMY_SENTINEL

## Status gate

STATUS_GATE_SENTINEL
`);

    const slice = await resolvePlaybookSlice({
      format: "hot_take",
      knowledgeBasePath,
    });

    expect(slice.sections.map((section) => section.id)).toEqual([
      "format-taxonomy",
      "status-gate",
    ]);
    expect(slice.content).toContain("FIRST_FORMAT_TAXONOMY_SENTINEL");
    expect(slice.content).not.toContain("SECOND_FORMAT_TAXONOMY_SENTINEL");
    expect(slice.content).toContain("STATUS_GATE_SENTINEL");
  });

  it("normalizes numbered and underscore headings without fuzzy inclusion", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## 2. Format taxonomy

NUMBERED_FORMAT_TAXONOMY_SENTINEL

## 10. founder_story is real but amplifier-gated

UNDERSCORE_FOUNDER_STORY_SENTINEL

## Daily playbook

DAILY_PLAYBOOK_SENTINEL

## Founder storyish

FUZZY_FOUNDER_STORY_SENTINEL

## Status gate

UNMAPPED_STATUS_GATE_SENTINEL
`);

    const slice = await resolvePlaybookSlice({
      format: "founder_story",
      knowledgeBasePath,
    });

    expect(slice.sections.map((section) => section.id)).toEqual([
      "founder-story",
      "format-taxonomy",
      "daily-playbook",
    ]);
    expect(slice.content).toContain("NUMBERED_FORMAT_TAXONOMY_SENTINEL");
    expect(slice.content).toContain("UNDERSCORE_FOUNDER_STORY_SENTINEL");
    expect(slice.content).toContain("DAILY_PLAYBOOK_SENTINEL");
    expect(slice.content).not.toContain("FUZZY_FOUNDER_STORY_SENTINEL");
    expect(slice.content).not.toContain("UNMAPPED_STATUS_GATE_SENTINEL");
  });
});
