import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiError,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
} from "@x-builder/shared";

import { ApiClientError, EngineApiClient } from "../engine-api-client";

const baseUrl = "http://127.0.0.1:4173";

type GenerateIdeaRequestContract = {
  idea: string;
  voiceProfileId?: string;
  useKnownPostIds?: string[];
};

type GenerateIdeaCandidateContract = {
  id: string;
  format: "one-liner" | "mini-framework" | "debate-question";
  text: string;
};

type GenerateIdeaResponseContract = {
  candidates: GenerateIdeaCandidateContract[];
};

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
  vi.fn(async (): Promise<Response> => {
    const response = responses.shift();

    if (!response) {
      throw new Error("No mocked response was queued for fetch.");
    }

    return response;
  });

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
    const generationRequest: GenerateIdeaRequestContract = {
      idea: "Local-first tools need boring edges.",
      useKnownPostIds: ["post-one", "post-two"],
      voiceProfileId: "voice-default",
    };
    const generationResponse: GenerateIdeaResponseContract = {
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

    const result: GenerateIdeaResponseContract = await client.generateIdea(generationRequest);

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
});
