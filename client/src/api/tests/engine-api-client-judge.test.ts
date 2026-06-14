import { describe, expect, it, vi } from "vitest";
import type { JudgeDraftResponse } from "@x-builder/shared";

import { ApiClientError, EngineApiClient } from "../engine-api-client";

const baseUrl = "http://127.0.0.1:4173";

const verdictResponse: JudgeDraftResponse = {
  status: "judged",
  verdict: {
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
    headline: "Strong, specific, reply-friendly.",
    strengths: ["Concrete claim up front"],
    improvements: ["Trim the middle paragraph"],
  },
  model: "codex-cli",
  judgedAt: "2026-06-10T12:00:00.000Z",
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });

describe("EngineApiClient.judgeDraft", () => {
  it("posts the draft to /drafts/judge and returns the parsed verdict", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(verdictResponse),
    );
    const client = new EngineApiClient({ baseUrl, fetchImpl: fetchMock });

    const result = await client.judgeDraft({ text: "judge this draft" });

    expect(result).toEqual(verdictResponse);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/drafts/judge`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ text: "judge this draft" });
  });

  it("throws ApiClientError carrying the engine apiError on a judge_failed response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          code: "judge_failed",
          message: "The Codex judge could not score this draft. Try again.",
          scope: "judge",
          retryable: true,
          status: 503,
        },
        { status: 503 },
      ),
    );
    const client = new EngineApiClient({ baseUrl, fetchImpl: fetchMock });

    await expect(client.judgeDraft({ text: "x" })).rejects.toBeInstanceOf(ApiClientError);
  });

  it("uses a judge-specific timeout longer than the short default request timeout", async () => {
    // Codex can take far longer than the 5ms default used here. Fake timers make
    // this deterministic: advancing well past the default (but far short of the
    // judge timeout) must NOT abort the request, proving judgeDraft overrides it.
    vi.useFakeTimers();

    try {
      let resolveFetch: (() => void) | undefined;
      const fetchMock = vi.fn(
        (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(jsonResponse(verdictResponse));
          }),
      );
      const client = new EngineApiClient({ baseUrl, fetchImpl: fetchMock, timeoutMs: 5 });

      const pending = client.judgeDraft({ text: "slow" });
      // Past the 5ms default; if judgeDraft wrongly used it, this would reject.
      await vi.advanceTimersByTimeAsync(2_000);
      resolveFetch?.();

      await expect(pending).resolves.toEqual(verdictResponse);
    } finally {
      vi.useRealTimers();
    }
  });
});
