import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  appStatusSchema,
  type AppStatus,
  type SubsystemStatus,
} from "@x-builder/shared";
import { buildServer } from "../server";

type ReadinessProbe = {
  check: () => Promise<SubsystemStatus> | SubsystemStatus;
};

type ReadinessDependencies = {
  deterministic: ReadinessProbe;
  codex: ReadinessProbe;
  storage: ReadinessProbe;
};

type ReadinessServiceFake = {
  getStatus: () => Promise<AppStatus> | AppStatus;
};

type BuildServerReadinessOptions = Parameters<typeof buildServer>[0] & {
  readinessDependencies?: ReadinessDependencies;
  readinessService?: ReadinessServiceFake;
  readinessTimeoutMs?: number;
};

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

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const buildServerWithReadinessDependencies = (
  readinessDependencies: ReadinessDependencies,
  options: { readinessTimeoutMs?: number } = {},
) =>
  buildServer({
    readinessDependencies,
    readinessTimeoutMs: options.readinessTimeoutMs,
  } as BuildServerReadinessOptions);

const buildServerWithReadiness = (readinessService: ReadinessServiceFake) =>
  buildServer({ readinessService } as BuildServerReadinessOptions);

const readinessDependencies = (
  overrides: Partial<ReadinessDependencies> = {},
): ReadinessDependencies => ({
  deterministic: {
    check: vi.fn(async () => subsystem("ready", "Deterministic scorer")),
  },
  codex: {
    check: vi.fn(async () => subsystem("ready", "Codex judge")),
  },
  storage: {
    check: vi.fn(async () => subsystem("ready", "Storage")),
  },
  ...overrides,
});

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

  it("aggregates ready subsystem probes into ready app status", async () => {
    const dependencies = readinessDependencies();
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      const payload = parseJsonPayload(response.body);

      expect(response.statusCode).toBe(200);
      expect(dependencies.deterministic.check).toHaveBeenCalledOnce();
      expect(dependencies.codex.check).toHaveBeenCalledOnce();
      expect(dependencies.storage.check).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(payload);

      expect(status.overall).toBe("ready");
      expect(status.engine.state).toBe("ready");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("ready");
      expect(status.storage.state).toBe("ready");
    } finally {
      await app.close();
    }
  });

  it("aggregates unavailable Codex and ready deterministic scoring into partial app status", async () => {
    const dependencies = readinessDependencies({
      codex: {
        check: vi.fn(async () =>
          subsystem("unavailable", "Codex judge", {
            message: "Codex command is not available.",
            retryable: true,
          }),
        ),
      },
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(dependencies.deterministic.check).toHaveBeenCalledOnce();
      expect(dependencies.codex.check).toHaveBeenCalledOnce();
      expect(dependencies.storage.check).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.engine.state).toBe("ready");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("unavailable");
      expect(status.storage.state).toBe("ready");
    } finally {
      await app.close();
    }
  });

  it("aggregates a failed storage boundary into degraded app status", async () => {
    const dependencies = readinessDependencies({
      storage: {
        check: vi.fn(async () =>
          subsystem("failed", "Storage", {
            message: "Storage path is not writable.",
            retryable: true,
          }),
        ),
      },
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(dependencies.deterministic.check).toHaveBeenCalledOnce();
      expect(dependencies.codex.check).toHaveBeenCalledOnce();
      expect(dependencies.storage.check).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.engine.state).toBe("ready");
      expect(status.storage.state).toBe("failed");
    } finally {
      await app.close();
    }
  });

  it("times out a slow readiness probe and returns degraded status without waiting for it", async () => {
    vi.useFakeTimers();

    const dependencies = readinessDependencies({
      codex: {
        check: vi.fn(() => new Promise<SubsystemStatus>(() => {})),
      },
    });
    const app = await buildServerWithReadinessDependencies(dependencies, {
      readinessTimeoutMs: 25,
    });

    try {
      const responsePromise = app.inject({
        method: "GET",
        url: "/status",
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(25);

      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(dependencies.deterministic.check).toHaveBeenCalledOnce();
      expect(dependencies.codex.check).toHaveBeenCalledOnce();
      expect(dependencies.storage.check).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("unavailable");
      expect(status.codex.retryable).toBe(true);
      expect(status.storage.state).toBe("ready");
    } finally {
      vi.useRealTimers();
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
