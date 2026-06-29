import { describe, expect, expectTypeOf, it } from "vitest";
import type { DetectedPostFormat, ExternalXSignalPatternType } from "@x-builder/shared";

import type {
  ExternalPatternGuidanceItem,
  ExternalPatternGuidanceProvider,
  ExternalPatternGuidanceRequest,
} from "../external-pattern-guidance.js";

type RenderExternalPatternGuidanceOptions = {
  maxItems?: number;
  charBudget?: number;
};

type ExternalPatternGuidanceModule = {
  renderExternalPatternGuidance?: (
    items: ExternalPatternGuidanceItem[],
    options?: RenderExternalPatternGuidanceOptions,
  ) => string | undefined;
};

const loadExternalPatternGuidance = async (): Promise<ExternalPatternGuidanceModule> =>
  import("../external-pattern-guidance.js") as Promise<ExternalPatternGuidanceModule>;

const loadRenderer = async () => {
  const module = await loadExternalPatternGuidance();

  expect(module.renderExternalPatternGuidance).toBeTypeOf("function");

  return module.renderExternalPatternGuidance!;
};

const guidanceItem = (
  overrides: Partial<ExternalPatternGuidanceItem> = {},
): ExternalPatternGuidanceItem => ({
  id: overrides.id ?? "pattern-1",
  patternType: overrides.patternType ?? "hook",
  label: overrides.label ?? "Concrete launch proof",
  statement:
    overrides.statement ??
    "Open with a concrete proof point before naming the broader lesson.",
  confidence: overrides.confidence ?? 0.82,
  ...(overrides.format === undefined ? {} : { format: overrides.format }),
});

const rendered = async (
  items: ExternalPatternGuidanceItem[],
  options?: RenderExternalPatternGuidanceOptions,
): Promise<string | undefined> => {
  const renderExternalPatternGuidance = await loadRenderer();

  return renderExternalPatternGuidance(items, options);
};

describe("external pattern guidance", () => {
  it("exports the documented external guidance contracts", async () => {
    const module = await loadExternalPatternGuidance();

    expect(module.renderExternalPatternGuidance).toBeTypeOf("function");

    expectTypeOf<ExternalPatternGuidanceItem>().toEqualTypeOf<{
      id: string;
      patternType: ExternalXSignalPatternType;
      format?: DetectedPostFormat;
      label: string;
      statement: string;
      confidence: number;
    }>();

    expectTypeOf<ExternalPatternGuidanceRequest>().toEqualTypeOf<{
      format?: DetectedPostFormat;
      maxItems?: number;
      charBudget?: number;
    }>();

    expectTypeOf<ExternalPatternGuidanceProvider>().toEqualTypeOf<
      (request: ExternalPatternGuidanceRequest) => Promise<ExternalPatternGuidanceItem[]>
    >();
  });

  it("renders only sanitized statement metadata from external patterns", async () => {
    const guidance = await rendered([
      {
        ...guidanceItem({
          id: "pattern-with-sensitive-source",
          patternType: "format",
          format: "genuine_question",
          label: "Specific question frame",
          statement: "Ask the sharp tradeoff before giving advice.",
          confidence: 0.91,
        }),
        sourceIds: ["source-secret-1"],
        evidenceIds: ["evidence-secret-1"],
        supportCount: 11,
        evidence: [
          {
            evidenceId: "evidence-secret-1",
            sourceId: "source-secret-1",
            screenName: "external_builder",
            platformPostId: "1800000000000000001",
            text: "RAW EXTERNAL PREVIEW SENTINEL",
            metrics: { likes: 123, reposts: 7 },
          },
        ],
      } as ExternalPatternGuidanceItem & Record<string, unknown>,
    ]);

    expect(guidance).toBeDefined();
    expect(guidance).toContain("# External performance patterns (derived constraints, not voice)");
    expect(guidance).toContain("weak writing constraints");
    expect(guidance).toContain("not author voice");
    expect(guidance).toContain("Specific question frame");
    expect(guidance).toContain("Ask the sharp tradeoff before giving advice.");
    expect(guidance).toContain("format");
    expect(guidance).toContain("genuine_question");
    expect(guidance).toContain("0.91");
    expect(guidance).not.toContain("source-secret-1");
    expect(guidance).not.toContain("evidence-secret-1");
    expect(guidance).not.toContain("external_builder");
    expect(guidance).not.toContain("1800000000000000001");
    expect(guidance).not.toContain("RAW EXTERNAL PREVIEW SENTINEL");
    expect(guidance).not.toContain("likes");
    expect(guidance).not.toContain("123");
  });

  it("renders at most four default items in provider order", async () => {
    const guidance = await rendered([
      guidanceItem({ id: "pattern-1", label: "Alpha frame", statement: "Use alpha proof." }),
      guidanceItem({ id: "pattern-2", label: "Beta frame", statement: "Use beta proof." }),
      guidanceItem({ id: "pattern-3", label: "Gamma frame", statement: "Use gamma proof." }),
      guidanceItem({ id: "pattern-4", label: "Delta frame", statement: "Use delta proof." }),
      guidanceItem({ id: "pattern-5", label: "Epsilon frame", statement: "Use epsilon proof." }),
    ]);

    expect(guidance).toBeDefined();
    expect(guidance).toContain("Alpha frame");
    expect(guidance).toContain("Beta frame");
    expect(guidance).toContain("Gamma frame");
    expect(guidance).toContain("Delta frame");
    expect(guidance).not.toContain("Epsilon frame");
    expect(guidance!.indexOf("Alpha frame")).toBeLessThan(guidance!.indexOf("Beta frame"));
    expect(guidance!.indexOf("Beta frame")).toBeLessThan(guidance!.indexOf("Gamma frame"));
    expect(guidance!.indexOf("Gamma frame")).toBeLessThan(guidance!.indexOf("Delta frame"));
  });

  it("returns no section when there are no guidance items", async () => {
    await expect(rendered([])).resolves.toBeUndefined();
  });

  it("keeps rendered guidance within the configured character budget", async () => {
    const guidance = await rendered(
      [
        guidanceItem({
          label: "Long-form proof frame",
          statement: `START ${"long statement ".repeat(80)} END_SENTINEL`,
        }),
      ],
      { charBudget: 260 },
    );

    expect(guidance).toBeDefined();
    expect(guidance!.length).toBeLessThanOrEqual(260);
    expect(guidance).toContain("# External performance patterns");
    expect(guidance).toContain("Long-form proof frame");
    expect(guidance).not.toContain("END_SENTINEL");
  });

  it("renders a pattern without inventing a missing format", async () => {
    const guidance = await rendered([
      guidanceItem({
        label: "No format frame",
        statement: "Use the statement without implying a post format.",
      }),
    ]);

    expect(guidance).toBeDefined();
    expect(guidance).toContain("No format frame");
    expect(guidance).toContain("Use the statement without implying a post format.");
    expect(guidance).not.toContain("undefined");
    expect(guidance).not.toContain("other");
    expect(guidance).not.toContain("hot_take");
    expect(guidance).not.toContain("genuine_question");
  });
});
