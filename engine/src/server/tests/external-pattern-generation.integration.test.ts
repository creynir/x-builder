import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addExternalXSignalSourceResponseSchema,
  applyJudgeSuggestionsResponseSchema,
  generateIdeaRequestSchema,
  generateIdeaResponseSchema,
  type ExternalXSignalEvidence,
  type ExternalXSignalPattern,
  type JudgeVerdict,
} from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StructuredLlmRequest } from "../../llm/structured-llm-service";
import { openEngineDatabase } from "../open-engine-database";
import { buildServer } from "../server";
import { JsonFileAppSettingsRepository } from "../settings-repository";
import { SqliteExternalXSignalsRepository } from "../../external/sqlite-external-x-signals-repository";
import type { ExternalXSignalsService } from "../../external/external-x-signals-service";

type LlmCall = {
  purpose: string;
  instructions: string;
  userContent: string;
};

const ISO = "2026-06-29T12:00:00.000Z";
const EXTERNAL_GUIDANCE_HEADER =
  "# External performance patterns (derived constraints, not voice)";
const SANITIZED_PATTERN_SENTINEL =
  "EFL005_SANITIZED_PATTERN_STATEMENT: start with the concrete receipt before the broader lesson.";
const DUPLICATE_PATTERN_PREFIX = "EFL005_DUPLICATE_PATTERN_";
const REMOVED_SOURCE_SENTINEL =
  "EFL005_REMOVED_SOURCE_EVIDENCE_SENTINEL: removed evidence must stay out.";
const REMOVED_SOURCE_PATTERN_SENTINEL =
  "EFL005_REMOVED_SOURCE_PATTERN_SENTINEL: removed-source-only pattern must stay out.";
const RAW_EXTERNAL_TEXT_SENTINEL =
  "EFL005_RAW_EXTERNAL_TEXT_SENTINEL: raw external post body.";
const RAW_EXTERNAL_PREVIEW_SENTINEL =
  "EFL005_RAW_EXTERNAL_PREVIEW_SENTINEL: raw preview must not render.";
const EVIDENCE_PREVIEW_SENTINEL =
  "EFL005_PATTERN_EVIDENCE_PREVIEW_SENTINEL: pattern preview must not render.";
const SOURCE_ID_SENTINEL = "efl005-source-secret";
const EVIDENCE_ID_SENTINEL = "efl005-evidence-secret";
const PLATFORM_POST_ID_SENTINEL = "efl005-platform-post-secret";
const HANDLE_SENTINEL = "efl005_external_handle";
const METRIC_VALUE_SENTINEL = "987654";

const llmCalls = vi.hoisted((): LlmCall[] => []);
const generateStructuredFake = vi.hoisted(() =>
  vi.fn(async (request: StructuredLlmRequest<unknown>) => {
    const userContent = request.turns.find((turn) => turn.role === "user")?.content ?? "";
    llmCalls.push({
      purpose: request.purpose,
      instructions: request.instructions,
      userContent,
    });

    const raw =
      request.purpose === "candidate_judge"
        ? verdictOutput()
        : request.purpose === "writer_first_pass"
          ? { text: `${userContent} rewritten with tighter proof.` }
          : {
              candidates: [
                { id: "candidate-1", text: `${userContent} :: first angle` },
                { id: "candidate-2", text: `${userContent} :: second angle` },
                { id: "candidate-3", text: `${userContent} :: third angle` },
              ],
            };

    return {
      status: "success" as const,
      provider: "codex-cli",
      requestId: "fake-request",
      output: request.structuredOutput.parser(raw),
      durationMs: 1,
      completedAt: ISO,
    };
  }),
);

vi.mock("../../llm/structured-llm-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../llm/structured-llm-service")>();

  return {
    ...actual,
    StructuredLlmService: vi.fn().mockImplementation(() => ({
      generateStructured: generateStructuredFake,
    })),
  };
});

const verdictOutput = (): JudgeVerdict => ({
  verdict: "post_now",
  confidence: "medium",
  scores: {
    overall: 82,
    replies: 80,
    profileClicks: 72,
    impressions: 68,
    bookmarkValue: 61,
    dwellProxy: 74,
    voiceMatch: 83,
    negativeRisk: 12,
    answerEffort: 55,
    strangerAnswerability: 49,
    statusDependency: 24,
    replyVsQuoteOrientation: 64,
    audienceMatch: null,
  },
  headline: "Specific enough to test.",
  strengths: ["concrete"],
  improvements: [],
  annotations: [],
});

const parseJson = (payload: string): unknown => JSON.parse(payload);

const writerInstructions = (): string => {
  const call = llmCalls.find((entry) => entry.purpose === "writer_variants");
  expect(call).toBeDefined();

  return call!.instructions;
};

const forbiddenExternalTokens = (sourceId: string): string[] => [
  sourceId,
  SOURCE_ID_SENTINEL,
  EVIDENCE_ID_SENTINEL,
  PLATFORM_POST_ID_SENTINEL,
  HANDLE_SENTINEL,
  RAW_EXTERNAL_TEXT_SENTINEL,
  RAW_EXTERNAL_PREVIEW_SENTINEL,
  EVIDENCE_PREVIEW_SENTINEL,
  REMOVED_SOURCE_SENTINEL,
  METRIC_VALUE_SENTINEL,
];

const evidenceFor = (
  sourceId: string,
  overrides: Partial<ExternalXSignalEvidence> = {},
): ExternalXSignalEvidence => ({
  id: overrides.id ?? EVIDENCE_ID_SENTINEL,
  sourceId: overrides.sourceId ?? sourceId,
  platform: "x",
  platformPostId: overrides.platformPostId ?? PLATFORM_POST_ID_SENTINEL,
  screenName: overrides.screenName ?? HANDLE_SENTINEL,
  text: overrides.text ?? RAW_EXTERNAL_TEXT_SENTINEL,
  previewText: overrides.previewText ?? RAW_EXTERNAL_PREVIEW_SENTINEL,
  createdAt: ISO,
  kind: "original",
  language: "en",
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
  metrics: overrides.metrics ?? { likes: 987654, reposts: 123, bookmarks: 45 },
  evidenceSource: "external_fixture_import",
  observedAt: overrides.observedAt ?? ISO,
  importedAt: ISO,
});

const patternFor = (
  sourceId: string,
  overrides: Partial<ExternalXSignalPattern> = {},
): ExternalXSignalPattern => ({
  id: overrides.id ?? "efl005-pattern-1",
  patternType: overrides.patternType ?? "format",
  format: overrides.format ?? "hot_take",
  label: overrides.label ?? "External hot take pattern",
  statement: overrides.statement ?? SANITIZED_PATTERN_SENTINEL,
  confidence: overrides.confidence ?? 0.94,
  supportCount: overrides.supportCount ?? 3,
  sourceIds: overrides.sourceIds ?? [sourceId, SOURCE_ID_SENTINEL],
  evidenceIds: overrides.evidenceIds ?? [EVIDENCE_ID_SENTINEL],
  evidence:
    overrides.evidence ??
    [
      {
        evidenceId: EVIDENCE_ID_SENTINEL,
        sourceId,
        screenName: HANDLE_SENTINEL,
        platformPostId: PLATFORM_POST_ID_SENTINEL,
        text: EVIDENCE_PREVIEW_SENTINEL,
        metrics: { likes: 987654, reposts: 123, bookmarks: 45 },
      },
    ],
  generatedAt: overrides.generatedAt ?? ISO,
  version: overrides.version ?? "external-x-signals:v1",
});

const openExternalRepository = (root: string) => {
  mkdirSync(join(root, "storage"), { recursive: true });
  const db = openEngineDatabase(join(root, "storage", "x-builder.db"));
  return {
    db,
    repository: new SqliteExternalXSignalsRepository(db, {
      now: () => ISO,
      id: () => SOURCE_ID_SENTINEL,
    }),
  };
};

const fakeExternalXSignalsService = (): ExternalXSignalsService => ({
  getOverview: vi.fn(),
  addSource: vi.fn(),
  removeSource: vi.fn(),
  refreshSource: vi.fn(),
} as unknown as ExternalXSignalsService);

const postTableCount = (root: string): number => {
  const db = openEngineDatabase(join(root, "storage", "x-builder.db"));
  try {
    return (db.prepare("SELECT COUNT(*) AS count FROM post").get() as { count: number }).count;
  } finally {
    db.close();
  }
};

let tempRoots: string[] = [];

beforeEach(() => {
  llmCalls.length = 0;
  generateStructuredFake.mockClear();
});

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

const createTempRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
};

describe("external pattern generation integration", () => {
  it("threads persisted sanitized external patterns through the default Generate rail without changing response shape or own corpus", async () => {
    const root = createTempRoot("x-builder-efl005-server-");
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(root, "settings") });
    const app = buildServer({ storageRoot: root, settingsRepository });

    try {
      const addResponse = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources",
        payload: { screenName: `@${HANDLE_SENTINEL}`, platformUserId: "efl005-platform-user" },
      });
      const added = addExternalXSignalSourceResponseSchema.parse(parseJson(addResponse.body));

      const { db, repository } = openExternalRepository(root);
      try {
        await repository.upsertObservedEvidence([
          evidenceFor(added.source.id),
          evidenceFor(added.source.id, {
            id: "efl005-evidence-secondary",
            platformPostId: "efl005-platform-post-secondary",
            text: "Secondary raw external body should not render.",
            previewText: "Secondary preview should not render.",
            observedAt: "2026-06-29T12:01:00.000Z",
          }),
        ]);
        await repository.replacePatterns([patternFor(added.source.id)]);
      } finally {
        db.close();
      }

      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(200);
      const result = generateIdeaResponseSchema.parse(parseJson(response.body));
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates.map((candidate) => candidate.format)).toEqual([
        "one-liner",
        "mini-framework",
        "debate-question",
      ]);

      const instructions = writerInstructions();
      expect(instructions).toContain(EXTERNAL_GUIDANCE_HEADER);
      expect(instructions).toContain(SANITIZED_PATTERN_SENTINEL);
      expect(instructions).not.toContain("# Voice samples (match tone, do not copy)");
      expect(postTableCount(root)).toBe(0);

      for (const token of forbiddenExternalTokens(added.source.id)) {
        expect(instructions).not.toContain(token);
      }

      const nonWriterPrompts = llmCalls
        .filter((call) => call.purpose !== "writer_variants")
        .map((call) => JSON.stringify(call))
        .join("\n");
      expect(nonWriterPrompts).not.toContain(SANITIZED_PATTERN_SENTINEL);
      expect(nonWriterPrompts).not.toContain(RAW_EXTERNAL_PREVIEW_SENTINEL);
    } finally {
      await app.close();
    }
  });

  it("continues generation without an external section when no external patterns exist", async () => {
    const root = createTempRoot("x-builder-efl005-empty-");
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(root, "settings") });
    const app = buildServer({ storageRoot: root, settingsRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(200);
      expect(generateIdeaResponseSchema.parse(parseJson(response.body)).candidates).toHaveLength(3);
      const instructions = writerInstructions();
      expect(instructions).toContain('Produce exactly 3 distinct draft posts in the "hot_take" format.');
      expect(instructions).not.toContain(EXTERNAL_GUIDANCE_HEADER);
      expect(instructions).not.toContain("# Voice samples (match tone, do not copy)");
      expect(postTableCount(root)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("does not read default-storage external patterns when an unpaired external signals service is injected", async () => {
    const root = createTempRoot("x-builder-efl005-injected-service-");
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(root, "settings") });

    const { db, repository } = openExternalRepository(root);
    try {
      const { source } = await repository.addSource({ screenName: "default_storage_source" });
      await repository.upsertObservedEvidence([evidenceFor(source.id)]);
      await repository.replacePatterns([
        patternFor(source.id, {
          id: "efl005-default-storage-stale-pattern",
          statement:
            "EFL005_SERVER_UNPAIRED_SERVICE_STALE_PATTERN_SENTINEL should not reach generation.",
        }),
      ]);
    } finally {
      db.close();
    }

    const app = buildServer({
      storageRoot: root,
      settingsRepository,
      externalXSignalsService: fakeExternalXSignalsService(),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(200);
      expect(generateIdeaResponseSchema.parse(parseJson(response.body)).candidates).toHaveLength(3);
      const instructions = writerInstructions();
      expect(instructions).not.toContain(EXTERNAL_GUIDANCE_HEADER);
      expect(instructions).not.toContain("EFL005_SERVER_UNPAIRED_SERVICE_STALE_PATTERN_SENTINEL");
    } finally {
      await app.close();
    }
  });

  it("bounds duplicate persisted pattern rendering and ignores removed-source evidence that has no active pattern snapshot", async () => {
    const root = createTempRoot("x-builder-efl005-duplicates-");
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(root, "settings") });
    const app = buildServer({ storageRoot: root, settingsRepository });

    try {
      const activeResponse = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources",
        payload: { screenName: "efl005_active_source" },
      });
      const active = addExternalXSignalSourceResponseSchema.parse(parseJson(activeResponse.body));
      const removedResponse = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources",
        payload: { screenName: "efl005_removed_source" },
      });
      const removed = addExternalXSignalSourceResponseSchema.parse(parseJson(removedResponse.body));
      await app.inject({
        method: "DELETE",
        url: `/external-x/signals/sources/${removed.source.id}`,
      });

      const { db, repository } = openExternalRepository(root);
      try {
        await repository.upsertObservedEvidence([
          evidenceFor(active.source.id),
          evidenceFor(removed.source.id, {
            id: "efl005-removed-evidence",
            platformPostId: "efl005-removed-platform-post",
            screenName: "efl005_removed_source",
            text: REMOVED_SOURCE_SENTINEL,
            previewText: REMOVED_SOURCE_SENTINEL,
          }),
        ]);
        await repository.replacePatterns(
          [
            patternFor(removed.source.id, {
              id: "efl005-removed-source-only-pattern",
              statement: REMOVED_SOURCE_PATTERN_SENTINEL,
              confidence: 0.99,
              supportCount: 20,
              sourceIds: [removed.source.id],
              evidenceIds: ["efl005-removed-evidence"],
              evidence: [
                {
                  evidenceId: "efl005-removed-evidence",
                  sourceId: removed.source.id,
                  screenName: "efl005_removed_source",
                  platformPostId: "efl005-removed-platform-post",
                  text: REMOVED_SOURCE_SENTINEL,
                  metrics: { likes: 987654 },
                },
              ],
            }),
            ...Array.from({ length: 8 }, (_value, index) =>
              patternFor(active.source.id, {
                id: `efl005-duplicate-pattern-${index}`,
                statement: `${DUPLICATE_PATTERN_PREFIX}${index}: keep this bounded duplicate constraint.`,
                confidence: 0.95 - index * 0.01,
                supportCount: 10 - index,
                evidenceIds: [EVIDENCE_ID_SENTINEL],
              }),
            ),
          ],
        );
      } finally {
        db.close();
      }

      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(200);
      expect(generateIdeaResponseSchema.parse(parseJson(response.body)).candidates).toHaveLength(3);

      const instructions = writerInstructions();
      expect(instructions).toContain(`${DUPLICATE_PATTERN_PREFIX}0`);
      expect(instructions).toContain(`${DUPLICATE_PATTERN_PREFIX}3`);
      expect(instructions).not.toContain(`${DUPLICATE_PATTERN_PREFIX}4`);
      expect(instructions).not.toContain(REMOVED_SOURCE_SENTINEL);
      expect(instructions).not.toContain(REMOVED_SOURCE_PATTERN_SENTINEL);
      expect(instructions.length).toBeLessThan(10_000);
    } finally {
      await app.close();
    }
  });

  it("keeps public generate and apply contracts free of direct external context", async () => {
    const parsed = generateIdeaRequestSchema.parse({
      format: "hot_take",
      externalPatternGuidance: SANITIZED_PATTERN_SENTINEL,
      externalEvidencePreview: RAW_EXTERNAL_PREVIEW_SENTINEL,
      externalContext: { pattern: SANITIZED_PATTERN_SENTINEL },
    });
    expect(parsed).toEqual({ format: "hot_take" });
    expect(parsed).not.toHaveProperty("externalPatternGuidance");
    expect(parsed).not.toHaveProperty("externalEvidencePreview");
    expect(parsed).not.toHaveProperty("externalContext");

    const root = createTempRoot("x-builder-efl005-apply-");
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(root, "settings") });
    const app = buildServer({ storageRoot: root, settingsRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/apply-suggestions",
        payload: {
          text: "A draft that needs a clearer opening.",
          externalPatternGuidance: SANITIZED_PATTERN_SENTINEL,
          externalEvidencePreview: RAW_EXTERNAL_PREVIEW_SENTINEL,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(() => applyJudgeSuggestionsResponseSchema.parse(parseJson(response.body))).not.toThrow();

      const applyPrompts = llmCalls.map((call) => JSON.stringify(call)).join("\n");
      expect(applyPrompts).not.toContain(SANITIZED_PATTERN_SENTINEL);
      expect(applyPrompts).not.toContain(RAW_EXTERNAL_PREVIEW_SENTINEL);
    } finally {
      await app.close();
    }
  });
});
