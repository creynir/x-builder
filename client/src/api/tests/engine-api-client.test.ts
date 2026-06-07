import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  ApiError,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
} from "@x-builder/shared";

import { ApiClientError, EngineApiClient } from "../engine-api-client";

const baseUrl = "http://127.0.0.1:4173";

const statusResponse: AppStatus = {
  overall: "partial",
  version: "0.0.0",
  generatedAt: "2026-06-06T12:00:00.000Z",
  engine: {
    state: "ready",
    label: "Engine",
    retryable: false,
    checkedAt: "2026-06-06T12:00:00.000Z",
    details: {
      adapter: "fastify",
    },
  },
  deterministic: {
    state: "ready",
    label: "Deterministic scorer",
    retryable: false,
    checkedAt: "2026-06-06T12:00:00.000Z",
    details: {
      mode: "in-process",
    },
  },
  codex: {
    state: "unconfigured",
    label: "Codex judge",
    message: "Codex judge is not configured for automatic readiness checks.",
    retryable: true,
    checkedAt: "2026-06-06T12:00:00.000Z",
    details: {
      judgeExecuted: false,
    },
  },
  storage: {
    state: "ready",
    label: "Storage",
    retryable: true,
    checkedAt: "2026-06-06T12:00:00.000Z",
    details: {
      boundary: "local-settings",
    },
  },
  lastRun: {
    state: "none",
  },
};

const settings: AppSettings = {
  engineBaseUrl: "http://127.0.0.1:4173",
  storagePath: "/tmp/x-builder-client-test-storage",
  codexCommandLabel: "Codex judge",
  runCodexJudgeAfterGeneration: false,
  showDeterministicDetails: true,
};

const settingsResponse: AppSettingsResponse = {
  settings,
  source: "persisted",
  updatedAt: "2026-06-06T12:00:00.000Z",
};

const validationError: ApiError = {
  code: "validation_failed",
  message: "The request is invalid.",
  scope: "field",
  retryable: false,
  status: 400,
  fieldErrors: {
    engineBaseUrl: ["Engine base URL must use http(s) localhost or 127.0.0.1."],
  },
};

const analysisRequest: AnalyzePostsRequest = {
  items: [
    {
      id: "candidate-1",
      text: "genuine question: why do agent handoffs fail when context is hidden from the next step?",
      sourceFormat: "debate-question",
    },
    {
      id: "candidate-2",
      text: "hot take: scoring retries should not regenerate already-rendered candidate text.",
      sourceFormat: "one-liner",
    },
  ],
  scoringContext: {
    followers: 2400,
  },
  presentation: {
    postCoachMode: "preview",
  },
};

const mixedAnalysisResponse: AnalyzePostsResponse = {
  items: [
    {
      status: "scored",
      id: "candidate-1",
      text: analysisRequest.items[0]?.text ?? "",
      sourceFormat: "debate-question",
      detectedFormat: "genuine_question",
      score: {
        value: 74,
        checks: [
          {
            id: "specificity",
            label: "Specific proof",
            status: "pass",
          },
        ],
        learnings: [
          {
            text: "Static rule evidence: specific details make posts easier to evaluate.",
            relevance: "general",
          },
        ],
        engageability: {
          engageable: true,
          reason: "Ends with a concrete question.",
        },
      },
      postCoach: {
        state: "ready",
        title: "Post Coach",
        value: 74,
        badge: {
          label: "Ship it",
          tone: "ship",
          tooltip: "Solid post. Ship it; higher scores are a bonus.",
        },
        target: 60,
        engageability: {
          engageable: true,
          reason: "Ends with a concrete question.",
        },
        failed: [],
        warned: [],
        passed: [
          {
            id: "specificity",
            label: "Specific proof",
            status: "pass",
          },
        ],
        counts: {
          flagged: 0,
          nudges: 0,
          onPoint: 1,
        },
        expanded: false,
        previewMode: true,
        sections: [
          {
            title: "On point",
            items: [
              {
                id: "specificity",
                label: "Specific proof",
                status: "pass",
              },
            ],
          },
        ],
        learnings: [],
        learningCaveat: "Static rule check. Imported performance data is not connected yet.",
        hiddenChecks: 0,
        helperText: "Signals, not verdicts.",
        footerText: "Static heuristic checks only.",
      },
      prediction: {
        status: "available",
        rangeLow: 120,
        rangeHigh: 260,
        midpoint: 190,
        confidence: "medium",
        signals: [
          {
            signal_key: "quality_voice",
            label: "Voice score 74",
            multiplier: 0.8,
          },
        ],
      },
      heuristicLabel: "Heuristic rank, not prediction.",
      analyzedAt: "2026-06-07T12:00:00.000Z",
      analyzerVersion: "deterministic-v1",
    },
    {
      status: "score_failed",
      id: "candidate-2",
      text: analysisRequest.items[1]?.text ?? "",
      sourceFormat: "one-liner",
      reason: "analyzer_exception",
      message: "Deterministic analysis failed for this candidate.",
      retryable: true,
    },
  ],
};

const analysisRouteFailure: ApiError = {
  code: "deterministic_analysis_failed",
  message: "Deterministic analysis failed.",
  scope: "deterministic",
  retryable: true,
  status: 500,
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });

const invalidJsonResponse = () =>
  new Response("{not json", {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });

const createFetch = (...responses: Array<Response | Promise<Response>>) =>
  vi.fn(
    async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const response = responses.shift();

      if (!response) {
        throw new Error("No mocked response was queued for fetch.");
      }

      return response;
    },
  );

const expectApiClientError = async (
  operation: Promise<unknown>,
  expected: Partial<ApiError>,
) => {
  await expect(operation).rejects.toBeInstanceOf(ApiClientError);

  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).apiError).toMatchObject(expected);

    return;
  }

  throw new Error("Expected operation to throw ApiClientError.");
};

describe("EngineApiClient", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns typed app status from GET /status", async () => {
    const fetchMock = createFetch(jsonResponse(statusResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    const status: AppStatus = await client.getStatus();

    expect(status).toEqual(statusResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/status`, expect.objectContaining({
      method: "GET",
    }));
  });

  it("classifies fetch rejections as engine_unreachable", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await expectApiClientError(client.getStatus(), {
      code: "engine_unreachable",
      scope: "app",
      retryable: true,
    });
  });

  it("classifies request timeouts as request_timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((): Promise<Response> => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl, timeoutMs: 25 });
    const request = client.getStatus();

    await vi.advanceTimersByTimeAsync(25);

    await expectApiClientError(request, {
      code: "request_timeout",
      scope: "app",
      retryable: true,
    });
  });

  it("classifies invalid JSON responses as invalid_response", async () => {
    const fetchMock = createFetch(invalidJsonResponse());
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await expectApiClientError(client.getStatus(), {
      code: "invalid_response",
      scope: "app",
      retryable: true,
    });
  });

  it("classifies schema mismatches as invalid_response", async () => {
    const fetchMock = createFetch(jsonResponse({ ...statusResponse, overall: "warming-up" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await expectApiClientError(client.getStatus(), {
      code: "invalid_response",
      scope: "app",
      retryable: true,
    });
  });

  it("preserves normalized API error payloads from HTTP errors", async () => {
    const fetchMock = createFetch(jsonResponse(validationError, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    try {
      await client.saveSettings(settings);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).apiError).toEqual(validationError);
      expect((error as ApiClientError).apiError.fieldErrors?.engineBaseUrl).toEqual([
        "Engine base URL must use http(s) localhost or 127.0.0.1.",
      ]);

      return;
    }

    throw new Error("Expected saveSettings to throw ApiClientError.");
  });

  it("lets consumers catch ApiClientError and read the normalized apiError payload", async () => {
    const fetchMock = createFetch(jsonResponse(validationError, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });
    let caughtError: ApiError | undefined;

    try {
      await client.saveSettings(settings);
    } catch (error) {
      if (error instanceof ApiClientError) {
        caughtError = (error as ApiClientError).apiError;
      }
    }

    expect(caughtError).toEqual(validationError);
  });

  it("returns typed settings from GET /settings", async () => {
    const fetchMock = createFetch(jsonResponse(settingsResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    const result: AppSettingsResponse = await client.getSettings();

    expect(result).toEqual(settingsResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/settings`, expect.objectContaining({
      method: "GET",
    }));
  });

  it("classifies invalid settings response bodies as invalid_response", async () => {
    const fetchMock = createFetch(jsonResponse({
      settings: {
        ...settings,
        engineBaseUrl: "https://example.com/not-local",
      },
      source: "persisted",
      updatedAt: "2026-06-06T12:00:00.000Z",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await expectApiClientError(client.getSettings(), {
      code: "invalid_response",
      scope: "app",
      retryable: true,
    });
  });

  it("saves settings with PATCH /settings and a JSON body", async () => {
    const fetchMock = createFetch(jsonResponse(settingsResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    const result: AppSettingsResponse = await client.saveSettings(settings);

    expect(result).toEqual(settingsResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/settings`, expect.objectContaining({
      body: JSON.stringify(settings),
      headers: expect.objectContaining({
        "content-type": "application/json",
      }),
      method: "PATCH",
    }));
  });

  it("generates ideas with POST /ideas/generate and a JSON idea body", async () => {
    const generationRequest: GenerateIdeaRequest = {
      idea: "Local-first tools need boring edges.",
      useKnownPostIds: ["post-one", "post-two"],
      voiceProfileId: "voice-default",
    };
    const generationResponse: GenerateIdeaResponse = {
      candidates: [
        {
          id: "one-liner",
          format: "one-liner",
          text: "Local-first tools need boring edges.",
        },
        {
          id: "mini-framework",
          format: "mini-framework",
          text: "Name the edge, show the tradeoff, make the local-first decision.",
        },
        {
          id: "debate-question",
          format: "debate-question",
          text: "What local-first compromise would make the product easier to trust?",
        },
      ],
    };
    const fetchMock = createFetch(jsonResponse(generationResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    const result: GenerateIdeaResponse = await client.generateIdea(generationRequest);

    expect(result).toEqual(generationResponse);
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/ideas/generate`, expect.objectContaining({
      body: JSON.stringify(generationRequest),
      headers: expect.objectContaining({
        "content-type": "application/json",
      }),
      method: "POST",
    }));
  });

  it("classifies invalid idea generation response bodies as invalid_response", async () => {
    const fetchMock = createFetch(jsonResponse({
      candidates: [
        {
          id: "one-liner",
          format: "one-liner",
          text: "Local-first tools need boring edges.",
        },
        {
          id: "mini-framework",
          format: "mini-framework",
        },
        {
          id: "debate-question",
          format: "debate-question",
          text: "What local-first compromise would make the product easier to trust?",
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await expectApiClientError(client.generateIdea({
      idea: "Local-first tools need boring edges.",
    }), {
      code: "invalid_response",
      scope: "app",
      retryable: true,
    });
  });

  it("analyzes posts with POST /posts/analyze and a JSON analysis body", async () => {
    const fetchMock = createFetch(jsonResponse(mixedAnalysisResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    const result: AnalyzePostsResponse = await client.analyzePosts(analysisRequest);

    expect(result).toEqual(mixedAnalysisResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/posts/analyze`, expect.objectContaining({
      body: JSON.stringify(analysisRequest),
      headers: expect.objectContaining({
        "content-type": "application/json",
      }),
      method: "POST",
    }));
  });

  it("preserves mixed scored and score-failed analysis results for UI recovery", async () => {
    const fetchMock = createFetch(jsonResponse(mixedAnalysisResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    const result: AnalyzePostsResponse = await client.analyzePosts(analysisRequest);

    expect(result.items).toEqual([
      expect.objectContaining({
        status: "scored",
        id: "candidate-1",
        postCoach: expect.objectContaining({
          state: "ready",
          title: "Post Coach",
        }),
      }),
      expect.objectContaining({
        status: "score_failed",
        id: "candidate-2",
        text: analysisRequest.items[1]?.text,
        sourceFormat: "one-liner",
        reason: "analyzer_exception",
        retryable: true,
      }),
    ]);
  });

  it("classifies scored analysis responses missing Post Coach as invalid_response", async () => {
    const scoredItem = mixedAnalysisResponse.items[0];

    if (scoredItem?.status !== "scored") {
      throw new Error("Expected scored analysis fixture item.");
    }

    const { postCoach: _postCoach, ...withoutPostCoach } = scoredItem;
    const fetchMock = createFetch(jsonResponse({
      items: [withoutPostCoach],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await expectApiClientError(client.analyzePosts(analysisRequest), {
      code: "invalid_response",
      scope: "app",
      retryable: true,
    });
  });

  it("preserves API errors from full analysis route failures", async () => {
    const fetchMock = createFetch(jsonResponse(analysisRouteFailure, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    try {
      await client.analyzePosts(analysisRequest);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect((error as ApiClientError).apiError).toEqual(analysisRouteFailure);

      return;
    }

    throw new Error("Expected analyzePosts to throw ApiClientError.");
  });

  it("keeps analysis separate from idea generation calls", async () => {
    const fetchMock = createFetch(jsonResponse(mixedAnalysisResponse));
    vi.stubGlobal("fetch", fetchMock);
    const client = new EngineApiClient({ baseUrl });

    await client.analyzePosts(analysisRequest);

    const fetchUrls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(fetchUrls).toEqual([`${baseUrl}/posts/analyze`]);
    expect(fetchUrls).not.toContain(`${baseUrl}/ideas/generate`);
  });
});
