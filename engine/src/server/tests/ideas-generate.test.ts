import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  deriveApproved,
  generateIdeaResponseSchema,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import { openEngineDatabase } from "../open-engine-database";
import { buildServer } from "../server";
import { JsonFileAppSettingsRepository } from "../settings-repository";
import { SqlitePostLibraryRepository } from "../sqlite-post-library-repository";
import type { StructuredLlmRequest } from "../../llm/structured-llm-service";

const ISO = "2026-06-20T12:00:00.000Z";
const SELECTED_FORMAT_SENTINEL = "HTTP_HOT_TAKE_SELECTED_FORMAT_SENTINEL";
const SELECTED_STATUS_SENTINEL = "HTTP_HOT_TAKE_SELECTED_STATUS_SENTINEL";
const UNRELATED_KB_SENTINEL = "HTTP_UNRELATED_FULL_KB_SENTINEL";
const KNOWN_VOICE_SENTINEL = "HTTP_KNOWN_POST_VOICE_SENTINEL";
const FALLBACK_VOICE_SENTINEL = "HTTP_FALLBACK_RECENT_VOICE_SENTINEL";
const REPLY_VOICE_SENTINEL = "HTTP_REPLY_VOICE_SENTINEL";

type LlmCall = { purpose: string; instructions: string; userContent: string };

const llmCalls = vi.hoisted((): LlmCall[] => []);
const failedJudgeTexts = vi.hoisted(() => new Set<string>());
const requestTimeoutJudgeTexts = vi.hoisted(() => new Set<string>());
const chainBudgetJudgeTexts = vi.hoisted(() => new Set<string>());
const generateStructuredFake = vi.hoisted(() =>
  vi.fn(async (request: StructuredLlmRequest<unknown>) => {
    const userContent = request.turns.find((turn) => turn.role === "user")?.content ?? "";
    llmCalls.push({
      purpose: request.purpose,
      instructions: request.instructions,
      userContent,
    });

    if (request.purpose === "candidate_judge" && chainBudgetJudgeTexts.has(userContent)) {
      return {
        status: "failed" as const,
        provider: "codex-cli",
        requestId: "fake-request",
        code: "chain_budget_exhausted" as const,
        message: "judge chain budget exhausted",
        retryable: true,
        durationMs: 1,
        completedAt: ISO,
      };
    }

    if (request.purpose === "candidate_judge" && requestTimeoutJudgeTexts.has(userContent)) {
      return {
        status: "failed" as const,
        provider: "codex-cli",
        requestId: "fake-request",
        code: "request_timeout" as const,
        message: "judge request timed out",
        retryable: true,
        durationMs: 1,
        completedAt: ISO,
      };
    }

    if (request.purpose === "candidate_judge" && failedJudgeTexts.has(userContent)) {
      return {
        status: "failed" as const,
        provider: "codex-cli",
        requestId: "fake-request",
        code: "provider_unavailable" as const,
        message: "judge provider unavailable",
        retryable: true,
        durationMs: 1,
        completedAt: ISO,
      };
    }

    const raw =
      request.purpose === "candidate_judge"
        ? {
            scores: {
              overall: 82,
              replies: 82,
              profileClicks: 82,
              impressions: 82,
              bookmarkValue: 82,
              dwellProxy: 82,
              voiceMatch: 82,
              negativeRisk: 12,
              answerEffort: 82,
              strangerAnswerability: 82,
              statusDependency: 12,
              replyVsQuoteOrientation: 82,
              audienceMatch: null,
            },
            confidence: "medium",
            headline: "Judged.",
            strengths: ["clear"],
            improvements: [],
            annotations: [],
          }
        : {
            candidates: [
              { id: "cand-1", text: `${userContent} :: first angle` },
              { id: "cand-2", text: `${userContent} :: second angle` },
              { id: "cand-3", text: `${userContent} :: third angle` },
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

const parseJson = (payload: string): unknown => JSON.parse(payload);

const verdict: JudgeVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores: {
    overall: 78,
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
  headline: "Solid, reply-friendly.",
  strengths: ["Concrete claim"],
  improvements: ["Trim the close"],
  annotations: [],
};

// A format-path response shaped exactly like the contract: three candidates,
// each carrying a verdict and an approved flag.
const formatPathResponse = (): GenerateIdeaResponse => ({
  candidates: [
    { id: "cand-0", format: "one-liner", text: "First angle.", verdict, approved: true },
    { id: "cand-1", format: "mini-framework", text: "Second angle.", verdict, approved: true },
    { id: "cand-2", format: "debate-question", text: "Third angle.", verdict, approved: true },
  ],
});

const formatBody: GenerateIdeaRequest = { format: "hot_take" };

type VoicePostInput = Parameters<SqlitePostLibraryRepository["upsertPosts"]>[0][number];

const voicePost = (
  overrides: Pick<VoicePostInput, "id" | "platformPostId" | "text" | "createdAt"> &
    Partial<VoicePostInput>,
): VoicePostInput => ({
  platform: "x",
  kind: "original",
  language: "en",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  weakMetrics: {},
  metricSnapshots: [],
  sourceRefs: [],
  ...overrides,
});

const writeGuidancePlaybook = (root: string): string => {
  const knowledgeBasePath = join(root, "generation-playbook.md");
  writeFileSync(
    knowledgeBasePath,
    [
      "# Format Taxonomy",
      `Hot take format rules. ${SELECTED_FORMAT_SENTINEL}.`,
      "",
      "# Growth Loop",
      `This unrelated section must not reach the writer prompt. ${UNRELATED_KB_SENTINEL}.`,
      "",
      "# Status Gate",
      `Status gate rules for hot takes. ${SELECTED_STATUS_SENTINEL}.`,
    ].join("\n"),
    "utf8",
  );

  return knowledgeBasePath;
};

const seedVoiceSamples = async (repository: SqlitePostLibraryRepository): Promise<void> => {
  await repository.upsertPosts([
    voicePost({
      id: "recent-fallback",
      platformPostId: "platform-recent-fallback",
      text: `${FALLBACK_VOICE_SENTINEL}: recent fallback voice sample.`,
      createdAt: "2026-06-21T12:00:00.000Z",
    }),
    voicePost({
      id: "known-canonical",
      platformPostId: "known-platform-id",
      text: `${KNOWN_VOICE_SENTINEL}: known post voice sample.`,
      createdAt: "2024-01-01T12:00:00.000Z",
    }),
    voicePost({
      id: "reply-ignored",
      platformPostId: "reply-ignored-platform",
      text: `${REPLY_VOICE_SENTINEL}: reply text must not become a voice sample.`,
      createdAt: "2026-06-22T12:00:00.000Z",
      kind: "reply",
    }),
  ]);
};

const writerInstructions = (): string => {
  const call = llmCalls.find((entry) => entry.purpose === "writer_variants");
  expect(call).toBeDefined();

  return call!.instructions;
};

let tempRoots: string[] = [];

beforeEach(() => {
  llmCalls.length = 0;
  generateStructuredFake.mockClear();
  failedJudgeTexts.clear();
  requestTimeoutJudgeTexts.clear();
  chainBudgetJudgeTexts.clear();
});

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

describe("POST /ideas/generate", () => {
  it("returns 200 with exactly three candidates for a format-path request", async () => {
    const generateCandidates = vi.fn(
      async (_input: GenerateIdeaRequest): Promise<GenerateIdeaResponse> => formatPathResponse(),
    );
    const app = buildServer({ generateCandidates });
    const body: GenerateIdeaRequest = { format: "hot_take", useKnownPostIds: ["known-post-id"] };

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(generateCandidates).toHaveBeenCalledTimes(1);
      expect(generateCandidates).toHaveBeenCalledWith(body);
      expect(generateStructuredFake).not.toHaveBeenCalled();
      expect(llmCalls).toHaveLength(0);

      const result = generateIdeaResponseSchema.parse(parseJson(response.body));
      expect(result.candidates).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it("uses compact guidance and tight voice samples through the default HTTP generation path", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "x-builder-http-generate-"));
    tempRoots.push(tempRoot);
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(tempRoot, "settings") });
    const postLibraryRepository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
    await settingsRepository.save({
      ...settingsRepository.defaults(),
      knowledgeBasePath: writeGuidancePlaybook(tempRoot),
    });
    await seedVoiceSamples(postLibraryRepository);
    const app = buildServer({ settingsRepository, postLibraryRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take", useKnownPostIds: ["known-platform-id"] },
      });

      expect(response.statusCode).toBe(200);
      const result = generateIdeaResponseSchema.parse(parseJson(response.body));
      expect(result.candidates).toHaveLength(3);

      const instructions = writerInstructions();
      expect(instructions).toContain("# Requested format playbook");
      expect(instructions).toContain(SELECTED_FORMAT_SENTINEL);
      expect(instructions).toContain(SELECTED_STATUS_SENTINEL);
      expect(instructions).not.toContain(UNRELATED_KB_SENTINEL);
      expect(instructions).toContain("# Voice samples (match tone, do not copy)");
      expect(instructions).toContain(KNOWN_VOICE_SENTINEL);
      expect(instructions).toContain(FALLBACK_VOICE_SENTINEL);
      expect(instructions).not.toContain(REPLY_VOICE_SENTINEL);
    } finally {
      await app.close();
    }
  });

  it("keeps three candidates and attaches only successful verdicts when one judge pass fails", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "x-builder-http-generate-judge-fail-"));
    tempRoots.push(tempRoot);
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(tempRoot, "settings") });
    const postLibraryRepository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
    failedJudgeTexts.add("Format: hot_take. :: second angle");
    const app = buildServer({ settingsRepository, postLibraryRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(200);
      const result = generateIdeaResponseSchema.parse(parseJson(response.body));
      expect(result.candidates).toHaveLength(3);

      const failedCandidate = result.candidates.find((candidate) => candidate.text.includes("second angle"));
      expect(failedCandidate).toBeDefined();
      expect(failedCandidate).not.toHaveProperty("verdict");
      expect(failedCandidate).not.toHaveProperty("approved");

      const successfulCandidates = result.candidates.filter((candidate) => !candidate.text.includes("second angle"));
      expect(successfulCandidates).toHaveLength(2);
      for (const candidate of successfulCandidates) {
        expect(candidate.verdict).toBeDefined();
        expect(candidate.approved).toBe(deriveApproved(candidate.verdict!));
      }
    } finally {
      await app.close();
    }
  });

  it("returns 500 with generation_failed when a default-path judge times out", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "x-builder-http-generate-judge-timeout-"));
    tempRoots.push(tempRoot);
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(tempRoot, "settings") });
    const postLibraryRepository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
    requestTimeoutJudgeTexts.add("Format: hot_take. :: second angle");
    const app = buildServer({ settingsRepository, postLibraryRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error.code).toBe("generation_failed");
      expect(error.status).toBe(500);
    } finally {
      await app.close();
    }
  });

  it("returns 500 with generation_failed when a default-path judge exhausts the chain budget", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "x-builder-http-generate-judge-budget-"));
    tempRoots.push(tempRoot);
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(tempRoot, "settings") });
    const postLibraryRepository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
    chainBudgetJudgeTexts.add("Format: hot_take. :: second angle");
    const app = buildServer({ settingsRepository, postLibraryRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error.code).toBe("generation_failed");
      expect(error.status).toBe(500);
    } finally {
      await app.close();
    }
  });

  it("keeps the base writer prompt reachable when guidance inputs are absent", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "x-builder-http-generate-empty-"));
    tempRoots.push(tempRoot);
    const settingsRepository = new JsonFileAppSettingsRepository({ root: join(tempRoot, "settings") });
    const postLibraryRepository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
    const app = buildServer({ settingsRepository, postLibraryRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: { format: "hot_take" },
      });

      expect(response.statusCode).toBe(200);
      const result = generateIdeaResponseSchema.parse(parseJson(response.body));
      expect(result.candidates).toHaveLength(3);

      const instructions = writerInstructions();
      expect(instructions).toContain('Produce exactly 3 distinct draft posts in the "hot_take" format.');
      expect(instructions).not.toContain("# Requested format playbook");
      expect(instructions).not.toContain("# Voice samples (match tone, do not copy)");
    } finally {
      await app.close();
    }
  });

  it("returns 500 with generation_failed when the generate step throws", async () => {
    const generateCandidates = vi.fn(async (_input: GenerateIdeaRequest) => {
      throw new Error("generate step failed");
    });
    const app = buildServer({ generateCandidates });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: formatBody,
      });

      expect(response.statusCode).toBe(500);
      expect(generateCandidates).toHaveBeenCalledTimes(1);

      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error.code).toBe("generation_failed");
      expect(error.status).toBe(500);
    } finally {
      await app.close();
    }
  });
});
