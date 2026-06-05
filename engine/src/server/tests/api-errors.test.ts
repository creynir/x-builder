import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema, type ApiError } from "@x-builder/shared";
import { buildServer } from "../server";

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);
const parseApiError = (payload: unknown): ApiError => apiErrorSchema.parse(payload);

const expectNoSensitiveLeak = (body: string, payload: unknown, leakedMessages: string[] = []) => {
  const serializedPayload = JSON.stringify(payload);

  for (const serialized of [body, serializedPayload]) {
    expect(serialized).not.toContain('"stack"');
    expect(serialized).not.toMatch(/\bError:\s/);
    expect(serialized).not.toMatch(/\bat\s+\S+\s+\(/);

    for (const leakedMessage of leakedMessages) {
      expect(serialized).not.toContain(leakedMessage);
    }
  }
};

describe("engine API error normalization", () => {
  it("returns a normalized validation error for invalid idea generation input", async () => {
    const app = await buildServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: {
          idea: "",
        },
      });

      const payload = parseJsonPayload(response.body);

      expectNoSensitiveLeak(response.body, payload);

      const error = parseApiError(payload);

      expect(response.statusCode).toBe(400);
      expect(error).toMatchObject({
        code: "validation_failed",
        retryable: false,
        status: 400,
      });
      expect(error.fieldErrors?.idea).toEqual(expect.arrayContaining([expect.any(String)]));
    } finally {
      await app.close();
    }
  });

  it("returns a normalized not found error for unknown routes", async () => {
    const app = await buildServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/missing-route",
      });

      const payload = parseJsonPayload(response.body);

      expectNoSensitiveLeak(response.body, payload);

      const error = parseApiError(payload);

      expect(response.statusCode).toBe(404);
      expect(error).toMatchObject({
        code: "not_found",
        retryable: false,
        status: 404,
      });
    } finally {
      await app.close();
    }
  });

  it("returns a normalized generation error when idea generation fails", async () => {
    const generateCandidates = vi.fn(async () => {
      throw new Error("Writer generator leaked secret prompt internals");
    });
    const app = await buildServer({ generateCandidates });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: {
          idea: "Explain why deterministic feedback helps founders revise faster.",
        },
      });

      const payload = parseJsonPayload(response.body);

      expectNoSensitiveLeak(response.body, payload, ["secret prompt internals"]);

      const error = parseApiError(payload);

      expect(generateCandidates).toHaveBeenCalledOnce();
      expect(response.statusCode).toBe(500);
      expect(error).toMatchObject({
        code: "generation_failed",
        scope: "writer",
        retryable: true,
        status: 500,
      });
    } finally {
      await app.close();
    }
  });

  it("returns a normalized internal error when a route handler throws unexpectedly", async () => {
    const app = await buildServer();

    app.get("/__test__/throws", async () => {
      throw new Error("Unexpected engine failure with sensitive internals");
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/__test__/throws",
      });

      const payload = parseJsonPayload(response.body);

      expectNoSensitiveLeak(response.body, payload, ["sensitive internals"]);

      const error = parseApiError(payload);

      expect(response.statusCode).toBe(500);
      expect(error).toMatchObject({
        code: "internal_error",
        retryable: true,
        status: 500,
      });
    } finally {
      await app.close();
    }
  });
});
