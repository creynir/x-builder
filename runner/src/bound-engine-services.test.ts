import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBoundEngineServices } from "./bound-engine-services.js";

type FakeLlmCall = {
  purpose: string;
  instructions: string;
  userContent: string;
};

const ISO = "2026-06-29T10:00:00.000Z";

const verdictModelOutput = () => ({
  confidence: "medium",
  scores: {
    overall: 82,
    replies: 80,
    profileClicks: 72,
    impressions: 65,
    bookmarkValue: 60,
    dwellProxy: 70,
    voiceMatch: 85,
    negativeRisk: 10,
    answerEffort: 55,
    strangerAnswerability: 48,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: null,
  },
  headline: "Judged.",
  strengths: ["specific"],
  improvements: [],
  annotations: [],
});

const createFakeLlm = () => {
  const calls: FakeLlmCall[] = [];
  const generateStructured = vi.fn(async (request: any) => {
    const userContent = request.turns.find((turn: any) => turn.role === "user")?.content ?? "";
    calls.push({
      purpose: request.purpose,
      instructions: request.instructions ?? "",
      userContent,
    });

    const raw =
      request.purpose === "candidate_judge"
        ? verdictModelOutput()
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
  });

  return { gateway: { generateStructured }, calls };
};

const writerInstructions = (calls: FakeLlmCall[]): string => {
  const writerCall = calls.find((call) => call.purpose === "writer_variants");
  expect(writerCall).toBeDefined();

  return writerCall!.instructions;
};

let tempDir: string;
let settingsRepository: Record<string, unknown>;
let postLibraryRepository: Record<string, unknown>;
let liveCapture: Record<string, unknown>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "x-builder-bound-services-"));
  const settings = {
    engineBaseUrl: "http://127.0.0.1:4173",
    storagePath: join(tempDir, "storage"),
    judgeProvider: "codex-cli",
    showDeterministicDetails: true,
  };
  const emptyStore = {
    schemaVersion: 2,
    updatedAt: ISO,
    posts: [],
    importRuns: [],
    derivedInsights: [],
    activeContext: { status: "empty" },
    profileSnapshots: [],
  };

  settingsRepository = {
    defaults: () => settings,
    load: async () => ({
      settings,
      source: "defaults",
      updatedAt: ISO,
    }),
    save: async () => ({
      settings,
      source: "persisted",
      updatedAt: ISO,
    }),
  };
  postLibraryRepository = {
    loadStore: async () => emptyStore,
    readAllPosts: async () => [],
    readPostByPlatformKey: async () => undefined,
    readProfileSnapshots: async () => [],
    readImportRuns: async () => [],
    readDerivedInsights: async () => [],
    readActiveContext: async () => emptyStore.activeContext,
    upsertPosts: vi.fn(),
    saveImportRun: vi.fn(),
    saveDerivedInsights: vi.fn(),
    setActiveContext: vi.fn(),
    pushProfileSnapshot: vi.fn(),
    writePost: vi.fn(),
  };
  liveCapture = {
    summary: vi.fn(async () => ({
      status: "empty",
      posts: [],
      updatedAt: ISO,
    })),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

const buildServices = (extra: Record<string, unknown> = {}) => {
  const { gateway, calls } = createFakeLlm();

  const services = createBoundEngineServices({
    settingsRepository,
    postLibraryRepository,
    liveCapture,
    llm: gateway,
    judgeLlm: gateway,
    observer: { state: "paused" as const, lastCaptureAt: undefined },
    feedbackLoopService: {
      recordPrediction: vi.fn(),
      linkPrediction: vi.fn(),
      getSummary: vi.fn(),
    },
    externalXSignalsService: {
      getOverview: vi.fn(),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      refreshSource: vi.fn(),
    },
    readinessService: {
      getStatus: () => ({
        appVersion: "0.0.0-test",
        deterministic: { state: "ok", label: "Deterministic" },
        llm: { state: "ok", label: "LLM" },
        storage: { state: "ok", label: "Storage" },
        updatedAt: ISO,
      }),
    },
    ...extra,
  } as never);

  return { services, calls };
};

describe("createBoundEngineServices generation guidance wiring", () => {
  it("passes a paired external pattern guidance provider into format generation", async () => {
    const externalPatternGuidanceProvider = vi.fn(async () => [
      {
        id: "external-pattern-1",
        patternType: "hook",
        statement: "BOUND_PROVIDER_EXTERNAL_PATTERN_SENTINEL",
        confidence: 0.87,
        supportCount: 12,
        generatedAt: ISO,
        version: "external-x-signals:v1",
      },
    ]);
    const { services, calls } = buildServices({ externalPatternGuidanceProvider });

    await services.generateIdeasService.generate({ format: "hot_take" });

    expect(externalPatternGuidanceProvider).toHaveBeenCalledTimes(1);
    expect(writerInstructions(calls)).toContain(
      "# External performance patterns (derived constraints, not voice)",
    );
    expect(writerInstructions(calls)).toContain("BOUND_PROVIDER_EXTERNAL_PATTERN_SENTINEL");
  });

  it("keeps external generation guidance disabled when only an external signals service is injected", async () => {
    const externalXSignalsService = {
      getOverview: vi.fn(),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      refreshSource: vi.fn(),
    };
    const { services, calls } = buildServices({ externalXSignalsService });

    await services.generateIdeasService.generate({ format: "hot_take" });

    expect(writerInstructions(calls)).not.toContain("# External performance patterns");
  });

  it("declares paired guidance-provider and snapshot-reader construction options", async () => {
    const source = await readFile(new URL("./bound-engine-services.ts", import.meta.url), "utf8");

    expect(source).toContain("externalPatternGuidanceProvider?");
    expect(source).toContain("externalPatternSnapshotReader?");
  });

  it("default-constructs one external repository variable and shares it with service and guidance", async () => {
    const source = await readFile(new URL("./bound-engine-services.ts", import.meta.url), "utf8");
    const repositoryDeclaration = source.match(
      /const\s+(\w*externalXSignalsRepository\w*)\s*=\s*new SqliteExternalXSignalsRepository\(/,
    );

    expect(repositoryDeclaration).not.toBeNull();
    const repositoryVariable = repositoryDeclaration![1]!;
    expect(source).toMatch(
      new RegExp(
        `new ExternalXSignalsService\\(\\{\\s*repository:\\s*${repositoryVariable}\\s*\\}\\)`,
      ),
    );
    expect(source).toMatch(
      new RegExp(`externalPattern(?:GuidanceProvider|SnapshotReader)[\\s\\S]*${repositoryVariable}`),
    );
  });
});
