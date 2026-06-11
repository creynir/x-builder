import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiErrorSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  generateIdeaResponseSchema,
  type AppSettings,
  type SubsystemStatus,
} from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import {
  buildServer,
  createEngineRuntimeConfig,
  defaultCorsAllowedOrigins,
} from "../server";
import { JsonFileAppSettingsRepository } from "../settings-repository";

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const now = "2026-06-06T12:00:00.000Z";

const subsystem = (
  state: SubsystemStatus["state"],
  label: string,
  overrides: Partial<SubsystemStatus> = {},
): SubsystemStatus => ({
  state,
  label,
  checkedAt: now,
  retryable: true,
  details: {},
  ...overrides,
});

const readinessDependencies = () => ({
  deterministic: {
    check: vi.fn(async () => subsystem("ready", "Deterministic scorer", { retryable: false })),
  },
  codex: {
    check: vi.fn(async () => subsystem("unconfigured", "Codex judge")),
  },
  storage: {
    check: vi.fn(async () => subsystem("ready", "Storage")),
  },
});

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-engine-integration-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const patchedSettings: AppSettings = appSettingsSchema.parse({
  engineBaseUrl: "http://localhost:5199",
  storagePath: "/tmp/x-builder-integration-storage",
  judgeProvider: "codex-cli",
  showDeterministicDetails: false,
});

describe("engine and shared schema integration", () => {
  it("uses the local engine bind address and port for the runtime entrypoint", () => {
    const config = createEngineRuntimeConfig({});

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 4173,
    });
  });

  it("allows only known local Vite origins through CORS", async () => {
    const app = buildServer();

    try {
      const allowedOrigin = defaultCorsAllowedOrigins[0];
      const allowedPreflight = await app.inject({
        method: "OPTIONS",
        url: "/status",
        headers: {
          Origin: allowedOrigin,
        },
      });
      const allowedStatus = await app.inject({
        method: "GET",
        url: "/status",
        headers: {
          Origin: allowedOrigin,
        },
      });
      const unknownOrigin = await app.inject({
        method: "OPTIONS",
        url: "/status",
        headers: {
          Origin: "https://example.com",
        },
      });

      expect(allowedPreflight.statusCode).toBe(204);
      expect(allowedPreflight.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(allowedPreflight.headers["access-control-allow-methods"]).toBe("GET,PATCH,POST,OPTIONS");
      expect(allowedPreflight.headers["access-control-allow-headers"]).toBe("Content-Type");
      expect(allowedPreflight.headers).not.toHaveProperty("access-control-allow-credentials");
      expect(allowedStatus.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(unknownOrigin.headers).not.toHaveProperty("access-control-allow-origin");
      expect(unknownOrigin.headers).not.toHaveProperty("access-control-allow-credentials");
    } finally {
      await app.close();
    }
  });

  it("returns status payloads accepted by the shared app status schema", async () => {
    const dependencies = readinessDependencies();
    const app = buildServer({ readinessDependencies: dependencies });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(200);
      expect(status.overall).toBe("partial");
      expect(status.engine.state).toBe("ready");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("unconfigured");
      expect(status.storage.state).toBe("ready");
      expect(status.lastRun.state).toBe("none");
      expect(dependencies.deterministic.check).toHaveBeenCalledOnce();
      expect(dependencies.codex.check).toHaveBeenCalledOnce();
      expect(dependencies.storage.check).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("keeps health liveness-only outside the shared readiness payload contract", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const payload = parseJsonPayload(response.body);

      expect(response.statusCode).toBe(200);
      expect(payload).toEqual({ ok: true });
      expect(payload).not.toHaveProperty("overall");
      expect(payload).not.toHaveProperty("generatedAt");
      expect(payload).not.toHaveProperty("engine");
      expect(payload).not.toHaveProperty("deterministic");
      expect(payload).not.toHaveProperty("codex");
      expect(payload).not.toHaveProperty("storage");
      expect(() => appStatusSchema.parse(payload)).toThrow();
    } finally {
      await app.close();
    }
  });

  it("persists patched settings through the engine API and reloads them through the shared settings schema", async () => {
    await withTempRoot(async (root) => {
      const settingsRepository = new JsonFileAppSettingsRepository({ root });
      const app = buildServer({ settingsRepository });

      try {
        const saveResponse = await app.inject({
          method: "PATCH",
          url: "/settings",
          payload: patchedSettings,
        });
        const saved = appSettingsResponseSchema.parse(parseJsonPayload(saveResponse.body));

        const loadResponse = await app.inject({
          method: "GET",
          url: "/settings",
        });
        const loaded = appSettingsResponseSchema.parse(parseJsonPayload(loadResponse.body));

        expect(saveResponse.statusCode).toBe(200);
        expect(loadResponse.statusCode).toBe(200);
        expect(saved).toMatchObject({
          settings: patchedSettings,
          source: "persisted",
        });
        expect(saved.updatedAt).toEqual(expect.any(String));
        expect(loaded).toEqual(saved);
      } finally {
        await app.close();
      }
    });
  });

  it("returns generated idea payloads accepted by the shared generation schema with exactly three candidates", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: {
          idea: "Explain why local-first feedback loops help founders write sharper posts.",
        },
      });

      const result = generateIdeaResponseSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(200);
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates.map((candidate) => candidate.format)).toEqual([
        "one-liner",
        "mini-framework",
        "debate-question",
      ]);
    } finally {
      await app.close();
    }
  });

  it("returns shared API error payloads for invalid engine requests", async () => {
    const app = buildServer();

    try {
      const invalidGenerationResponse = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: {
          idea: "",
        },
      });
      const invalidGenerationError = apiErrorSchema.parse(
        parseJsonPayload(invalidGenerationResponse.body),
      );

      const invalidSettingsResponse = await app.inject({
        method: "PATCH",
        url: "/settings",
        payload: {
          ...patchedSettings,
          engineBaseUrl: "https://engine.example.com",
        },
      });
      const invalidSettingsError = apiErrorSchema.parse(parseJsonPayload(invalidSettingsResponse.body));

      const missingRouteResponse = await app.inject({
        method: "GET",
        url: "/missing-route",
      });
      const missingRouteError = apiErrorSchema.parse(parseJsonPayload(missingRouteResponse.body));

      expect(invalidGenerationResponse.statusCode).toBe(400);
      expect(invalidGenerationError).toMatchObject({
        code: "validation_failed",
        scope: "field",
        retryable: false,
        status: 400,
      });
      expect(invalidGenerationError.fieldErrors?.idea).toEqual(expect.arrayContaining([expect.any(String)]));

      expect(invalidSettingsResponse.statusCode).toBe(400);
      expect(invalidSettingsError).toMatchObject({
        code: "validation_failed",
        scope: "field",
        retryable: false,
        status: 400,
      });
      expect(invalidSettingsError.fieldErrors?.engineBaseUrl).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );

      expect(missingRouteResponse.statusCode).toBe(404);
      expect(missingRouteError).toMatchObject({
        code: "not_found",
        scope: "route",
        retryable: false,
        status: 404,
      });
    } finally {
      await app.close();
    }
  });
});
