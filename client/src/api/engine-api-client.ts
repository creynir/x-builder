import {
  analyzePostsResponseSchema,
  apiErrorSchema,
  appSettingsResponseSchema,
  appStatusSchema,
  generateIdeaResponseSchema,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type ApiError,
  type AppSettings,
  type AppSettingsResponse,
  type AppStatus,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
} from "@x-builder/shared";
import type { output, ZodTypeAny } from "zod";

export interface EngineApiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type RequestOptions = {
  body?: unknown;
  method: "GET" | "PATCH" | "POST";
};

export class ApiClientError extends Error {
  public readonly apiError: ApiError;
  public readonly cause?: unknown;

  constructor(apiError: ApiError, cause?: unknown) {
    super(apiError.message);
    this.name = "ApiClientError";
    this.apiError = apiError;
    this.cause = cause;
  }
}

const clientError = (
  code: Extract<ApiError["code"], "engine_unreachable" | "request_timeout" | "invalid_response">,
  message: string,
): ApiError =>
  apiErrorSchema.parse({
    code,
    message,
    scope: "app",
    retryable: true,
  });

const engineUnreachableError = () =>
  clientError("engine_unreachable", "The local engine could not be reached. Try again.");

const requestTimeoutError = () =>
  clientError("request_timeout", "The local engine request timed out. Try again.");

const invalidResponseError = () =>
  clientError("invalid_response", "The local engine returned an invalid response. Try again.");

const defaultFetch = (): typeof fetch => globalThis.fetch.bind(globalThis);

export class EngineApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: EngineApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  getStatus(): Promise<AppStatus> {
    return this.observe(this.request("/status", { method: "GET" }, appStatusSchema));
  }

  getSettings(): Promise<AppSettingsResponse> {
    return this.observe(this.request("/settings", { method: "GET" }, appSettingsResponseSchema));
  }

  saveSettings(settings: AppSettings): Promise<AppSettingsResponse> {
    return this.observe(
      this.request(
        "/settings",
        {
          body: settings,
          method: "PATCH",
        },
        appSettingsResponseSchema,
      ),
    );
  }

  generateIdea(input: GenerateIdeaRequest): Promise<GenerateIdeaResponse> {
    return this.observe(
      this.request(
        "/ideas/generate",
        {
          body: {
            ...input,
            useKnownPostIds: input.useKnownPostIds ?? [],
          },
          method: "POST",
        },
        generateIdeaResponseSchema,
      ),
    );
  }

  analyzePosts(input: AnalyzePostsRequest): Promise<AnalyzePostsResponse> {
    return this.observe(
      this.request(
        "/posts/analyze",
        {
          body: input,
          method: "POST",
        },
        analyzePostsResponseSchema,
      ),
    );
  }

  private observe<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => undefined);

    return promise;
  }

  private async request<TSchema extends ZodTypeAny>(
    path: string,
    options: RequestOptions,
    responseSchema: TSchema,
  ): Promise<output<TSchema>> {
    const response = await this.fetchWithTimeout(path, options);
    const payload = await this.readJson(response);

    if (!response.ok) {
      const parsedError = apiErrorSchema.safeParse(payload);

      if (parsedError.success) {
        throw new ApiClientError(parsedError.data);
      }

      throw new ApiClientError(invalidResponseError());
    }

    const parsedResponse = responseSchema.safeParse(payload);

    if (!parsedResponse.success) {
      throw new ApiClientError(invalidResponseError(), parsedResponse.error);
    }

    return parsedResponse.data;
  }

  private async fetchWithTimeout(path: string, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutError = new ApiClientError(requestTimeoutError());
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(timeoutError);
        controller.abort();
      }, this.timeoutMs);
    });

    const fetchPromise = Promise.resolve().then(() =>
      this.fetchImpl(`${this.baseUrl}${path}`, {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers:
          options.body === undefined
            ? undefined
            : {
                "content-type": "application/json",
              },
        method: options.method,
        signal: controller.signal,
      }),
    );

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }

      throw new ApiClientError(engineUnreachableError(), error);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new ApiClientError(invalidResponseError(), error);
    }
  }
}
