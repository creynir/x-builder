import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  judgeDraftResponseSchema,
  type AppSettings,
  type JudgeVerdict,
} from "@x-builder/shared";

import { JudgeDraftService } from "../../llm/judge-draft-service";
import {
  StructuredLlmService,
  type LlmProvider,
  type NormalizedStructuredLlmRequest,
  type StructuredLlmProviderResult,
} from "../../llm/structured-llm-service";
import { JsonFileAppSettingsRepository } from "../settings-repository";
import { buildServer } from "../server";

const generalizedJudgeFailedMessage = "The judge could not score this draft. Try again.";

const codexVerdictProvider = (): LlmProvider<JudgeVerdict> => ({
  id: "codex-cli",
  generateStructured: <TOutput,>(
    request: NormalizedStructuredLlmRequest<TOutput>,
  ): StructuredLlmProviderResult<JudgeVerdict> => ({
    status: "success",
    provider: request.provider,
    requestId: "codex-req-1",
    output: request.structuredOutput.parser({
      confidence: "medium",
      scores: verdict.scores,
      headline: verdict.headline,
      strengths: verdict.strengths,
      improvements: verdict.improvements,
    }) as JudgeVerdict,
    durationMs: 7,
    completedAt: "2026-06-10T12:00:00.000Z",
  }),
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
  headline: "Solid hook, weak closer.",
  strengths: ["Clear, concrete claim"],
  improvements: ["Cut the last sentence"],
};

const judgedOutcome = {
  status: "judged" as const,
  response: {
    status: "judged" as const,
    verdict,
    model: "codex-cli",
    judgedAt: "2026-06-10T12:00:00.000Z",
  },
};

describe("POST /drafts/judge", () => {
  it("returns a judged verdict for a valid draft", async () => {
    const judge = vi.fn(async () => judgedOutcome);
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft worth judging." },
      });

      expect(response.statusCode).toBe(200);
      expect(judge).toHaveBeenCalledWith("A draft worth judging.");

      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.verdict).toEqual(verdict);
      expect(body.model).toBe("codex-cli");
    } finally {
      await app.close();
    }
  });

  it("maps a provider failure to a retryable judge_failed error without leaking internals", async () => {
    const judge = vi.fn(async () => ({
      status: "failed" as const,
      retryable: true,
      code: "provider_unavailable",
      message: "codex unavailable: /Users/secret/path",
    }));
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "secret draft text" },
      });

      expect(response.statusCode).toBe(503);

      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: true });
      expect(response.body).not.toContain("secret draft text");
      expect(response.body).not.toContain("/Users/secret/path");
      expect(response.body).not.toContain("stack");
    } finally {
      await app.close();
    }
  });

  it("maps a non-retryable failure to a 500 judge_failed error", async () => {
    const judge = vi.fn(async () => ({
      status: "failed" as const,
      retryable: false,
      code: "structured_output_invalid",
      message: "bad output",
    }));
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });

      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(parseJson(response.body))).toMatchObject({
        code: "judge_failed",
        scope: "judge",
        retryable: false,
      });
    } finally {
      await app.close();
    }
  });

  it("maps a verdict that violates the response contract to a non-retryable internal_error", async () => {
    const judge = vi.fn(async () => ({
      status: "judged" as const,
      response: {
        status: "judged" as const,
        verdict: { ...verdict, scores: { ...verdict.scores, replies: 999 } },
        model: "codex-cli",
        judgedAt: "2026-06-10T12:00:00.000Z",
      },
    }));
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });

      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(parseJson(response.body))).toMatchObject({
        code: "internal_error",
        retryable: false,
      });
    } finally {
      await app.close();
    }
  });

  it("generalizes the judge failure message across retryable and non-retryable failures", async () => {
    const retryableApp = buildServer({
      judgeDraftService: {
        judge: vi.fn(async () => ({
          status: "failed" as const,
          retryable: true,
          code: "provider_unavailable",
          message: "codex unavailable: /Users/secret/path",
        })),
      },
    });
    const nonRetryableApp = buildServer({
      judgeDraftService: {
        judge: vi.fn(async () => ({
          status: "failed" as const,
          retryable: false,
          code: "provider_unconfigured",
          message: "The requested LLM provider is not configured.",
        })),
      },
    });

    try {
      const retryableResponse = await retryableApp.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });
      const nonRetryableResponse = await nonRetryableApp.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });

      expect(apiErrorSchema.parse(parseJson(retryableResponse.body)).message).toBe(
        generalizedJudgeFailedMessage,
      );
      expect(apiErrorSchema.parse(parseJson(nonRetryableResponse.body)).message).toBe(
        generalizedJudgeFailedMessage,
      );
    } finally {
      await retryableApp.close();
      await nonRetryableApp.close();
    }
  });

  it("returns non-retryable judge_failed when the resolved provider is not in the injected provider set", async () => {
    // Injection seam: a real judge service whose registered providers lack the
    // selected claude-cli id. Resolving claude-cli per call yields an internal
    // provider_unconfigured failure, surfaced as a generic non-retryable error.
    const judgeDraftService = new JudgeDraftService(
      new StructuredLlmService({ providers: [codexVerdictProvider()] }),
      () => "claude-cli",
    );
    const app = buildServer({ judgeDraftService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft selected for an unconfigured provider." },
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({
        code: "judge_failed",
        scope: "judge",
        retryable: false,
      });
      expect(error.message).toBe(generalizedJudgeFailedMessage);
    } finally {
      await app.close();
    }
  });

  it("judges successfully through the codex provider when claude-cli is the resolved selection but registered", async () => {
    // Sanity counterpart: when the resolved provider IS registered, the same
    // injected service path produces a judged verdict (no false unconfigured).
    const judgeDraftService = new JudgeDraftService(
      new StructuredLlmService({ providers: [codexVerdictProvider()] }),
      () => "codex-cli",
    );
    const app = buildServer({ judgeDraftService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft for the registered provider." },
      });

      expect(response.statusCode).toBe(200);
      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.model).toBe("codex-cli");
      expect(body.verdict.verdict).toBe(verdict.verdict);
    } finally {
      await app.close();
    }
  });

  it("rejects an empty draft with validation_failed and does not call the judge", async () => {
    const judge = vi.fn();
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "   " },
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(parseJson(response.body)).code).toBe("validation_failed");
      expect(judge).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

// AC: the route reads accountProfile from the body, falls back to the persisted
// settings.accountProfile, and passes the resolved profile to the judge — which
// returns a numeric audienceMatch when a profile anchors fit and an explicit null
// when none is present. Exercised through a real temp-root settings repository
// and an in-process fake judge that captures the received profile.
describe("POST /drafts/judge account profile fallback", () => {
  // A judge fake that records the profile it received and reflects presence into
  // the verdict's audienceMatch: a number when a profile arrives, null otherwise.
  const profileCapturingJudge = () => {
    const received: Array<string | undefined> = [];

    const judge = vi.fn(async (_text: string, accountProfile?: string) => {
      received.push(accountProfile);

      return {
        status: "judged" as const,
        response: {
          status: "judged" as const,
          verdict: {
            ...verdict,
            scores: {
              ...verdict.scores,
              audienceMatch: accountProfile === undefined ? null : 64,
            },
          },
          model: "codex-cli",
          judgedAt: "2026-06-10T12:00:00.000Z",
        },
      };
    });

    return { judge, received };
  };

  const withSettingsRoot = async <T,>(
    run: (repository: JsonFileAppSettingsRepository) => Promise<T>,
  ): Promise<T> => {
    const root = await mkdtemp(join(tmpdir(), "x-builder-judge-profile-"));

    try {
      return await run(new JsonFileAppSettingsRepository({ root }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };

  const persistedSettings = (root: string, accountProfile?: string): AppSettings =>
    ({
      engineBaseUrl: "http://127.0.0.1:4173",
      storagePath: join(root, "storage"),
      judgeProvider: "codex-cli",
      showDeterministicDetails: true,
      ...(accountProfile !== undefined ? { accountProfile } : {}),
    }) as AppSettings;

  it("passes an account profile from the request body to the judge", async () => {
    await withSettingsRoot(async (settingsRepository) => {
      const { judge, received } = profileCapturingJudge();
      const app = buildServer({ judgeDraftService: { judge }, settingsRepository });
      const bodyProfile = "Indie hacker shipping a local-first writing tool.";

      try {
        const response = await app.inject({
          method: "POST",
          url: "/drafts/judge",
          payload: { text: "A draft worth judging.", accountProfile: bodyProfile },
        });

        expect(response.statusCode).toBe(200);
        expect(received).toEqual([bodyProfile]);
        const body = judgeDraftResponseSchema.parse(parseJson(response.body));
        expect(body.verdict.scores.audienceMatch).toBe(64);
      } finally {
        await app.close();
      }
    });
  });

  it("falls back to the persisted settings account profile when the body omits one", async () => {
    const settingsProfile = "Solo founder writing about local-first dev tooling.";

    await withSettingsRoot(async (settingsRepository) => {
      const saved = await settingsRepository.save(
        persistedSettings(settingsRepository.defaults().storagePath, settingsProfile),
      );
      expect(saved.settings.accountProfile).toBe(settingsProfile);

      const { judge, received } = profileCapturingJudge();
      const app = buildServer({ judgeDraftService: { judge }, settingsRepository });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/drafts/judge",
          payload: { text: "A draft judged with the settings profile." },
        });

        expect(response.statusCode).toBe(200);
        expect(received).toEqual([settingsProfile]);
        const body = judgeDraftResponseSchema.parse(parseJson(response.body));
        expect(body.verdict.scores.audienceMatch).toBe(64);
      } finally {
        await app.close();
      }
    });
  });

  it("passes no account profile and yields a null audienceMatch when body and settings both omit one", async () => {
    await withSettingsRoot(async (settingsRepository) => {
      await settingsRepository.save(
        persistedSettings(settingsRepository.defaults().storagePath),
      );

      const { judge, received } = profileCapturingJudge();
      const app = buildServer({ judgeDraftService: { judge }, settingsRepository });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/drafts/judge",
          payload: { text: "A draft judged without any account profile." },
        });

        expect(response.statusCode).toBe(200);
        expect(received).toEqual([undefined]);
        const body = judgeDraftResponseSchema.parse(parseJson(response.body));
        expect(body.verdict.scores.audienceMatch).toBeNull();
      } finally {
        await app.close();
      }
    });
  });
});
