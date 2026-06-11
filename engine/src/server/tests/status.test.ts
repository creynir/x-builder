import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  type AppSettings,
  type AppSettingsResponse,
  type AppStatus,
  type SubsystemStatus,
} from "@x-builder/shared";
import type {
  ProcessRunner,
  ProcessRunOptions,
  ProcessRunResult,
} from "../../llm/process-runner";
import { buildServer, createDefaultReadinessDependencies } from "../server";

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

type AppSettingsRepositoryFake = {
  defaults: () => AppSettings;
  load: () => Promise<AppSettingsResponse> | AppSettingsResponse;
  save: (settings: AppSettings) => Promise<AppSettingsResponse> | AppSettingsResponse;
};

type BuildServerReadinessOptions = Parameters<typeof buildServer>[0] & {
  readinessDependencies?: ReadinessDependencies;
  readinessService?: ReadinessServiceFake;
  readinessTimeoutMs?: number;
  settingsRepository?: AppSettingsRepositoryFake;
};

type CodexReadinessProbeConstructor = new (options: {
  runner: ProcessRunner;
  workspaceRoot: string;
  executionTimeoutMs?: number;
}) => ReadinessProbe;

type CapturedProcessRun = {
  command: string;
  args: readonly string[];
  options: ProcessRunOptions;
};

type FakeProcessRunner = ProcessRunner & {
  calls: CapturedProcessRun[];
};

const now = "2026-06-06T12:00:00.000Z";
const codexReadinessWorkspaceRoot = "/tmp/x-builder-codex-readiness-workspace";
const codexReadinessExecutionTimeoutMs = 321;

const settingsWithCodexJudgeEnabled: AppSettings = appSettingsSchema.parse({
  engineBaseUrl: "http://127.0.0.1:4173",
  storagePath: "/tmp/x-builder-settings-storage",
  judgeProvider: "codex-cli",
  codexModel: "gpt-5.2-codex",
  showDeterministicDetails: true,
});

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

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

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

const createCodexReadinessProbe = async (
  runner: ProcessRunner,
  options: { executionTimeoutMs?: number } = {},
): Promise<ReadinessProbe> => {
  const module = (await import("../../llm/codex-readiness-probe.js")) as {
    CodexReadinessProbe: CodexReadinessProbeConstructor;
  };

  return new module.CodexReadinessProbe({
    runner,
    workspaceRoot: codexReadinessWorkspaceRoot,
    executionTimeoutMs: options.executionTimeoutMs ?? codexReadinessExecutionTimeoutMs,
  });
};

const successfulProcessResult = (
  stdout: string,
  overrides: Partial<ProcessRunResult> = {},
): ProcessRunResult => {
  const stderr = overrides.stderr ?? "";

  return {
    status: "success",
    stdout,
    stderr,
    exitCode: 0,
    signal: null,
    durationMs: 4,
    stdoutBytes: byteLength(stdout),
    stderrBytes: byteLength(stderr),
    ...overrides,
  };
};

const failedProcessResult = (
  code: ProcessRunResult["code"],
  overrides: Partial<ProcessRunResult> = {},
): ProcessRunResult => {
  const stdout = overrides.stdout ?? "";
  const stderr = overrides.stderr ?? "";

  return {
    status: "failed",
    code,
    retryable: overrides.retryable ?? false,
    stdout,
    stderr,
    exitCode: overrides.exitCode ?? null,
    signal: overrides.signal ?? null,
    durationMs: overrides.durationMs ?? 4,
    stdoutBytes: byteLength(stdout),
    stderrBytes: byteLength(stderr),
    ...overrides,
  };
};

const fakeProcessRunner = (
  handler: (call: CapturedProcessRun) => Promise<ProcessRunResult> | ProcessRunResult,
): FakeProcessRunner => {
  const calls: CapturedProcessRun[] = [];

  return {
    calls,
    run: vi.fn(async (command, args, options) => {
      const call = { command, args, options };
      calls.push(call);

      return handler(call);
    }),
  };
};

const settingsRepository = (settings: AppSettings): AppSettingsRepositoryFake => ({
  defaults: vi.fn(() => settings),
  load: vi.fn(async () => ({
    settings,
    source: "persisted" as const,
    updatedAt: now,
  })),
  save: vi.fn(async (nextSettings) => ({
    settings: nextSettings,
    source: "persisted" as const,
    updatedAt: now,
  })),
});

async function withTempDirectory<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "x-builder-status-"));

  try {
    return await callback(root);
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
}

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

  it("reports Codex ready from a successful cheap version probe", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(runner.run).toHaveBeenCalledOnce();
      const [call] = runner.calls;
      if (!call) {
        throw new Error("Expected Codex readiness probe to invoke the fake process runner.");
      }
      expect(call.command).toBe("codex");
      expect(call.args.join(" ")).toMatch(/\bversion\b/i);
      expect(call.args).not.toContain("exec");
      expect(call.args).not.toContain("--output-schema");
      expect(call.options).toMatchObject({
        cwd: codexReadinessWorkspaceRoot,
        timeoutMs: codexReadinessExecutionTimeoutMs,
      });
      expect(call.options).not.toHaveProperty("stdin");
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("ready");
      expect(status.codex.state).toBe("ready");
      expect(status.codex.retryable).toBe(false);
      expect(status.codex.details).toEqual({
        adapter: "codex-cli",
        command: "codex",
        commandAvailable: true,
        version: "codex-cli 0.42.0",
        sandbox: "read-only",
        executionTimeoutMs: codexReadinessExecutionTimeoutMs,
      });
      expect(status.codex.details).not.toHaveProperty("autoJudgeEnabled");
      expect(status.codex.details).not.toHaveProperty("runCodexJudgeAfterGeneration");
    } finally {
      await app.close();
    }
  });

  it("reports unavailable Codex and partial app status when the command cannot start", async () => {
    const runner = fakeProcessRunner(() =>
      failedProcessResult("process_failed", {
        message: "spawn codex ENOENT",
        details: {
          path: "/Users/nataly/.codex/bin/codex",
        },
      }),
    );
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(runner.run).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("unavailable");
      expect(status.codex.details).toEqual({
        adapter: "codex-cli",
        command: "codex",
        commandAvailable: false,
        sandbox: "read-only",
        executionTimeoutMs: codexReadinessExecutionTimeoutMs,
      });
      expect(status.storage.state).toBe("ready");
      expect(response.body).not.toContain("/Users/nataly");
      expect(response.body).not.toContain("ENOENT");
    } finally {
      await app.close();
    }
  });

  it("does not leak sensitive Codex failure output through status readiness", async () => {
    const stderrSentinel = "STDERR_SENTINEL_DO_NOT_LEAK";
    const promptSentinel = "PROMPT_SENTINEL_DO_NOT_LEAK";
    const rawModelOutputSentinel = "RAW_MODEL_OUTPUT_SENTINEL_DO_NOT_LEAK";
    const authPath = "/Users/nataly/.codex/auth.json";
    const stackTrace = "Error: sensitive stack\n    at runCodex";
    const runner = fakeProcessRunner(() =>
      failedProcessResult("nonzero_exit", {
        stdout: rawModelOutputSentinel,
        stderr: `${stderrSentinel}\n${promptSentinel}\nauth file: ${authPath}\n${stackTrace}`,
        exitCode: 1,
        details: {
          authPath,
          stack: stackTrace,
        },
      }),
    );
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(runner.run).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.deterministic.state).toBe("ready");
      expect(status.codex.state).toBe("unavailable");
      expect(status.codex.retryable).toBe(true);
      expect(status.codex.details).toEqual({
        adapter: "codex-cli",
        command: "codex",
        commandAvailable: true,
        sandbox: "read-only",
        executionTimeoutMs: codexReadinessExecutionTimeoutMs,
      });
      expect(status.storage.state).toBe("ready");
      expect(response.body).not.toContain(stderrSentinel);
      expect(response.body).not.toContain(promptSentinel);
      expect(response.body).not.toContain(rawModelOutputSentinel);
      expect(response.body).not.toContain(authPath);
      expect(response.body).not.toContain("/Users/nataly");
      expect(response.body).not.toContain("auth.json");
      expect(response.body).not.toContain("sensitive stack");
      expect(response.body).not.toContain("runCodex");
      expect(status.codex.details).not.toHaveProperty("stderr");
      expect(status.codex.details).not.toHaveProperty("stdout");
      expect(status.codex.details).not.toHaveProperty("rawOutput");
      expect(status.codex.details).not.toHaveProperty("stack");
    } finally {
      await app.close();
    }
  });

  it("maps a Codex version probe timeout to retryable unavailable status within the readiness timeout", async () => {
    vi.useFakeTimers();

    const runner = fakeProcessRunner(() => new Promise<ProcessRunResult>(() => {}));
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner, {
        executionTimeoutMs: 5_000,
      }),
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
      expect(runner.run).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.overall).toBe("partial");
      expect(status.codex.state).toBe("unavailable");
      expect(status.codex.retryable).toBe(true);
      expect(status.codex.message).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("uses the startup-resolved workspace root for default Codex readiness", async () => {
    await withTempDirectory(async (root) => {
      const workspaceRoot = join(root, "workspace");
      const nestedStartupCwd = join(workspaceRoot, "engine", "src");
      const liveCwd = join(root, "live-cwd");
      const originalCwd = process.cwd();
      const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));

      await mkdir(join(workspaceRoot, ".git"), { recursive: true });
      await mkdir(nestedStartupCwd, { recursive: true });
      await mkdir(liveCwd, { recursive: true });

      const dependencies = createDefaultReadinessDependencies({
        codexRunner: runner,
        startupCwd: nestedStartupCwd,
      });
      const app = buildServerWithReadinessDependencies(dependencies);

      try {
        process.chdir(liveCwd);

        const response = await app.inject({
          method: "GET",
          url: "/status",
        });

        expect(response.statusCode).toBe(200);
        expect(runner.run).toHaveBeenCalledOnce();
        const [call] = runner.calls;

        expect(call?.options.cwd).toBe(workspaceRoot);
        expect(call?.options.cwd).not.toBe(liveCwd);
        const status = appStatusSchema.parse(parseJsonPayload(response.body));

        expect(status.codex.state).toBe("ready");
      } finally {
        process.chdir(originalCwd);
        await app.close();
      }
    });
  });

  it("reports Codex unavailable without running a probe when no startup workspace root resolves", async () => {
    await withTempDirectory(async (root) => {
      const nestedStartupCwd = join(root, "not-a-repo", "engine", "src");
      const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));

      await mkdir(nestedStartupCwd, { recursive: true });

      const dependencies = createDefaultReadinessDependencies({
        codexRunner: runner,
        startupCwd: nestedStartupCwd,
      });
      const app = buildServerWithReadinessDependencies(dependencies);

      try {
        const response = await app.inject({
          method: "GET",
          url: "/status",
        });

        expect(response.statusCode).toBe(200);
        expect(runner.run).not.toHaveBeenCalled();
        const status = appStatusSchema.parse(parseJsonPayload(response.body));

        expect(status.overall).toBe("partial");
        expect(status.codex.state).toBe("unavailable");
        expect(status.codex.message).toBe("Workspace root could not be resolved.");
        expect(status.codex.details).toEqual({
          reason: "workspace_root_unresolved",
        });
      } finally {
        await app.close();
      }
    });
  });

  it("keeps Codex readiness independent from stored judge settings", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const repository = settingsRepository(settingsWithCodexJudgeEnabled);
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = buildServer({
      readinessDependencies: dependencies,
      settingsRepository: repository,
    } as BuildServerReadinessOptions);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      expect(repository.load).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(runner.run).toHaveBeenCalledOnce();
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.codex.state).toBe("ready");
      expect(status.codex.details).toEqual({
        adapter: "codex-cli",
        command: "codex",
        commandAvailable: true,
        version: "codex-cli 0.42.0",
        sandbox: "read-only",
        executionTimeoutMs: codexReadinessExecutionTimeoutMs,
      });
      expect(status.codex.details).not.toHaveProperty("autoJudgeEnabled");
      expect(status.codex.details).not.toHaveProperty("runCodexJudgeAfterGeneration");
      expect(response.body).not.toContain("Local Codex judge");
    } finally {
      await app.close();
    }
  });

  it("keeps settings responses separate from Codex readiness details", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const repository = settingsRepository(settingsWithCodexJudgeEnabled);
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = buildServer({
      readinessDependencies: dependencies,
      settingsRepository: repository,
    } as BuildServerReadinessOptions);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/settings",
      });

      expect(response.statusCode).toBe(200);
      const settingsResponse = appSettingsResponseSchema.parse(parseJsonPayload(response.body));

      expect(settingsResponse).toEqual({
        settings: settingsWithCodexJudgeEnabled,
        source: "persisted",
        updatedAt: now,
      });
      expect(Object.keys(settingsResponse).sort()).toEqual(["settings", "source", "updatedAt"]);
      expect(repository.load).toHaveBeenCalledOnce();
      expect(repository.save).not.toHaveBeenCalled();
      expect(runner.run).not.toHaveBeenCalled();
      expect(response.body).not.toContain("overall");
      expect(response.body).not.toContain("commandAvailable");
      expect(response.body).not.toContain("autoJudgeEnabled");
    } finally {
      await app.close();
    }
  });

  it("sanitizes Codex process output before returning readiness details", async () => {
    const fullStdoutSentinel = "FULL_STDOUT_SENTINEL_DO_NOT_LEAK";
    const stderrSentinel = "STDERR_SENTINEL_DO_NOT_LEAK";
    const promptSentinel = "PROMPT_SENTINEL_DO_NOT_LEAK";
    const authPath = "/Users/nataly/.codex/auth.json";
    const runner = fakeProcessRunner(() =>
      successfulProcessResult(`codex-cli 0.42.0\n${fullStdoutSentinel}\n`, {
        stderr: `${stderrSentinel}\n${promptSentinel}\nauth file: ${authPath}\n`,
      }),
    );
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/status",
      });

      expect(response.statusCode).toBe(200);
      const status = appStatusSchema.parse(parseJsonPayload(response.body));

      expect(status.codex.state).toBe("ready");
      expect(status.codex.details).toMatchObject({
        adapter: "codex-cli",
        command: "codex",
        commandAvailable: true,
        version: "codex-cli 0.42.0",
      });
      expect(response.body).not.toContain(fullStdoutSentinel);
      expect(response.body).not.toContain(stderrSentinel);
      expect(response.body).not.toContain(promptSentinel);
      expect(response.body).not.toContain(authPath);
      expect(response.body).not.toContain("/Users/nataly");
      expect(status.codex.details).not.toHaveProperty("stderr");
      expect(status.codex.details).not.toHaveProperty("stdout");
      expect(status.codex.details).not.toHaveProperty("rawOutput");
    } finally {
      await app.close();
    }
  });

  it("does not run or expose Codex readiness from the liveness endpoint", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const dependencies = readinessDependencies({
      codex: await createCodexReadinessProbe(runner),
    });
    const app = await buildServerWithReadinessDependencies(dependencies);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const payload = parseJsonPayload(response.body);

      expect(response.statusCode).toBe(200);
      expect(payload).toEqual({ ok: true });
      expect(runner.run).not.toHaveBeenCalled();
      expect(response.body).not.toContain("codex");
      expect(response.body).not.toContain("codex-cli");
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
