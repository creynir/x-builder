import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema, appStatusSchema, type AppStatus } from "@x-builder/shared";
import { buildServer } from "../server";

type ReadinessServiceFake = {
  getStatus: () => Promise<AppStatus> | AppStatus;
};

const now = "2026-06-06T12:00:00.000Z";

const subsystem = (
  state: AppStatus["engine"]["state"],
  label: string,
  overrides: Partial<AppStatus["engine"]> = {},
): AppStatus["engine"] => ({
  state,
  label,
  checkedAt: now,
  retryable: true,
  details: {},
  ...overrides,
});

const statusFixture = (overrides: Partial<AppStatus> = {}): AppStatus =>
  appStatusSchema.parse({
    overall: "ready",
    version: "0.0.0-test",
    generatedAt: now,
    engine: subsystem("ready", "Engine"),
    deterministic: subsystem("ready", "Deterministic scorer"),
    codex: subsystem("ready", "Codex judge"),
    storage: subsystem("ready", "Storage"),
    lastRun: {
      state: "none",
    },
    ...overrides,
  });

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const buildServerWithReadiness = (readinessService: ReadinessServiceFake) =>
  buildServer({ readinessService });

describe("engine status readiness", () => {
  it("keeps health liveness-only without detailed readiness", async () => {
    const app = await buildServer();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const payload = parseJsonPayload(response.body);

      expect(response.statusCode).toBe(200);
      expect(payload).toEqual({ ok: true });
      expect(payload).not.toHaveProperty("overall");
      expect(payload).not.toHaveProperty("engine");
      expect(payload).not.toHaveProperty("codex");
      expect(payload).not.toHaveProperty("storage");
    } finally {
      await app.close();
    }
  });

  it("returns ready status from the injected readiness service", async () => {
    const readyStatus = statusFixture();
    const readinessService = {
      getStatus: vi.fn(async () => readyStatus),
    };
    const app = await buildServerWithReadiness(readinessService);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      const payload = parseJsonPayload(response.body);

      expect(response.statusCode).toBe(200);
      expect(readinessService.getStatus).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(payload);

      expect(status).toEqual(readyStatus);
      expect(status.overall).toBe("ready");
      expect(status.engine.state).toBe("ready");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("ready");
      expect(status.storage.state).toBe("ready");
    } finally {
      await app.close();
    }
  });

  it("reports partial readiness when Codex is unavailable but deterministic scoring is ready", async () => {
    const partialStatus = statusFixture({
      overall: "partial",
      codex: subsystem("unavailable", "Codex judge", {
        message: "Codex command is not available.",
        retryable: true,
      }),
    });
    const readinessService = {
      getStatus: vi.fn(async () => partialStatus),
    };
    const app = await buildServerWithReadiness(readinessService);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(readinessService.getStatus).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("unavailable");
    } finally {
      await app.close();
    }
  });

  it("reports degraded storage readiness without changing engine readiness", async () => {
    const storageFailedStatus = statusFixture({
      overall: "partial",
      storage: subsystem("failed", "Storage", {
        message: "Storage path is not writable.",
        retryable: true,
      }),
    });
    const readinessService = {
      getStatus: vi.fn(async () => storageFailedStatus),
    };
    const app = await buildServerWithReadiness(readinessService);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(readinessService.getStatus).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.engine.state).toBe("ready");
      expect(status.storage.state).toBe("failed");
    } finally {
      await app.close();
    }
  });

  it("normalizes readiness service failures as status API errors", async () => {
    const readinessService = {
      getStatus: vi.fn(async () => {
        throw new Error("Local storage path leaked from readiness internals");
      }),
    };
    const app = await buildServerWithReadiness(readinessService);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      const payload = parseJsonPayload(response.body);

      expect(response.statusCode).toBe(500);
      expect(readinessService.getStatus).toHaveBeenCalledOnce();
      const error = apiErrorSchema.parse(payload);

      expect(error).toMatchObject({
        code: "status_unavailable",
        scope: "status",
        retryable: true,
        status: 500,
      });
      expect(response.body).not.toContain("Local storage path");
      expect(response.body).not.toContain("readiness internals");
      expect(response.body).not.toContain("stack");
    } finally {
      await app.close();
    }
  });
});
