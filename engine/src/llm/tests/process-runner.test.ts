import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

type ProcessRunOptions = {
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  env?: Record<string, string>;
  envAllowlist?: readonly string[];
};

type ProcessRunResult = {
  status: "success" | "failed";
  code?: string;
  retryable?: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  timedOut?: boolean;
  stream?: "stdout" | "stderr";
  message?: string;
  details?: Record<string, unknown>;
};

type ProcessRunner = {
  run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult>;
};

const defaultRunOptions = {
  timeoutMs: 2_000,
  maxStdoutBytes: 256,
  maxStderrBytes: 256,
} as const;

async function loadNodeProcessRunner(): Promise<new () => ProcessRunner> {
  const module = (await import("../process-runner.js")) as {
    NodeProcessRunner: new () => ProcessRunner;
  };

  return module.NodeProcessRunner;
}

async function createRunner(): Promise<ProcessRunner> {
  vi.resetModules();
  vi.doUnmock("node:child_process");

  const NodeProcessRunner = await loadNodeProcessRunner();

  return new NodeProcessRunner();
}

async function withTempRuntimeRoot<T>(callback: (runtimeRoot: string) => Promise<T>): Promise<T> {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "x-builder-process-runner-"));

  try {
    await mkdir(join(runtimeRoot, ".git"));

    return await callback(runtimeRoot);
  } finally {
    await rm(runtimeRoot, {
      recursive: true,
      force: true,
    });
  }
}

function nodeScript(script: string, ...args: string[]): readonly string[] {
  return ["-e", script, ...args];
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertNoStackTrace(value: unknown): void {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain('"stack"');
  expect(serialized).not.toMatch(/\bError:\s/);
  expect(serialized).not.toMatch(/\bat\s+\S+\s+\(/);
}

function createSpawnStubResult({
  stdout = "",
  stderr = "",
  exitCode = 0,
  signal = null,
}: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
} = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);

  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit("exit", exitCode, signal);
    child.emit("close", exitCode, signal);
  });

  return child;
}

describe("node process runner", () => {
  it("starts commands with argument arrays and shell execution disabled", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      vi.resetModules();
      const spawn = vi.fn(() =>
        createSpawnStubResult({
          stdout: "done\n",
        }),
      );
      vi.doMock("node:child_process", () => ({
        spawn,
      }));

      try {
        const NodeProcessRunner = await loadNodeProcessRunner();
        const runner = new NodeProcessRunner();
        const args = nodeScript(
          "console.log(process.argv.slice(1).join('|'))",
          "plain-argument",
          "value with spaces; echo unsafe",
        );

        const result = await runner.run(process.execPath, args, {
          cwd: runtimeRoot,
          ...defaultRunOptions,
        });

        expect(result).toMatchObject({
          status: "success",
          stdout: "done\n",
          exitCode: 0,
          signal: null,
        });
        expect(spawn).toHaveBeenCalledOnce();
        expect(spawn).toHaveBeenCalledWith(
          process.execPath,
          [...args],
          expect.objectContaining({
            cwd: runtimeRoot,
            shell: false,
          }),
        );
      } finally {
        vi.doUnmock("node:child_process");
        vi.resetModules();
      }
    });
  });

  it("runs in the runtime cwd while cwd-like request input remains an ordinary argument", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();
      const requestSuppliedCwd = await mkdtemp(join(tmpdir(), "x-builder-request-cwd-"));

      try {
        await writeFile(join(runtimeRoot, "runtime-marker.txt"), "from-runtime-root", "utf8");
        await writeFile(join(requestSuppliedCwd, "runtime-marker.txt"), "from-request-cwd", "utf8");

        const result = await runner.run(
          process.execPath,
          nodeScript(
            [
              "const fs = require('node:fs');",
              "const path = require('node:path');",
              "const marker = fs.readFileSync(path.join(process.cwd(), 'runtime-marker.txt'), 'utf8');",
              "console.log(JSON.stringify({ cwd: process.cwd(), marker, argv: process.argv.slice(1) }));",
            ].join("\n"),
            requestSuppliedCwd,
          ),
          {
            cwd: runtimeRoot,
            ...defaultRunOptions,
          },
        );

        const payload = JSON.parse(result.stdout) as {
          cwd: string;
          marker: string;
          argv: string[];
        };
        const runtimeRootRealPath = await realpath(runtimeRoot);
        const payloadCwdRealPath = await realpath(payload.cwd);

        expect(result.status).toBe("success");
        expect(payloadCwdRealPath).toBe(runtimeRootRealPath);
        expect(payload.marker).toBe("from-runtime-root");
        expect(payload.argv).toEqual([requestSuppliedCwd]);
      } finally {
        await rm(requestSuppliedCwd, {
          recursive: true,
          force: true,
        });
      }
    });
  });

  it("passes only the explicitly allowlisted parent environment variables to the child process", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      vi.stubEnv("CODEX_HOME", "/tmp/x-builder-codex-home");
      vi.stubEnv("OPENAI_API_KEY", "openai-secret");
      vi.stubEnv("AWS_SECRET_ACCESS_KEY", "aws-secret");
      vi.stubEnv("GITHUB_TOKEN", "github-token-secret");
      vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid");

      try {
        const runner = await createRunner();
        // Pin the env-copy MECHANIC against an explicit allowlist (the path every
        // real caller takes), not the runner's default fallback: an allowlisted
        // name present in the parent crosses into the child; a present name that
        // is NOT on the allowlist does not.
        const result = await runner.run(
          process.execPath,
          nodeScript(
            [
              "const names = JSON.parse(process.argv[1]);",
              "console.log(JSON.stringify(Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]))));",
            ].join("\n"),
            JSON.stringify([
              "CODEX_HOME",
              "OPENAI_API_KEY",
              "AWS_SECRET_ACCESS_KEY",
              "GITHUB_TOKEN",
              "HTTPS_PROXY",
            ]),
          ),
          {
            cwd: runtimeRoot,
            ...defaultRunOptions,
            envAllowlist: ["PATH", "CODEX_HOME"],
          },
        );

        expect(result.status).toBe("success");
        expect(JSON.parse(result.stdout)).toEqual({
          CODEX_HOME: "/tmp/x-builder-codex-home",
          OPENAI_API_KEY: null,
          AWS_SECRET_ACCESS_KEY: null,
          GITHUB_TOKEN: null,
          HTTPS_PROXY: null,
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("returns bounded stdout, stderr, exit metadata, duration, and byte counts for exit code zero", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();
      const stdout = "hello from stdout\n";
      const stderr = "warning from stderr\n";

      const result = await runner.run(
        process.execPath,
        nodeScript(
          [
            `process.stdout.write(${JSON.stringify(stdout)});`,
            `process.stderr.write(${JSON.stringify(stderr)});`,
          ].join("\n"),
        ),
        {
          cwd: runtimeRoot,
          ...defaultRunOptions,
        },
      );

      expect(result).toMatchObject({
        status: "success",
        stdout,
        stderr,
        exitCode: 0,
        signal: null,
        stdoutBytes: byteLength(stdout),
        stderrBytes: byteLength(stderr),
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  it("returns non-zero exit metadata without throwing", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();

      await expect(
        runner.run(
          process.execPath,
          nodeScript(
            [
              "process.stdout.write('partial output');",
              "process.stderr.write('failure details');",
              "process.exit(17);",
            ].join("\n"),
          ),
          {
            cwd: runtimeRoot,
            ...defaultRunOptions,
          },
        ),
      ).resolves.toMatchObject({
        status: "failed",
        code: "nonzero_exit",
        retryable: false,
        stdout: "partial output",
        stderr: "failure details",
        exitCode: 17,
        signal: null,
        stdoutBytes: byteLength("partial output"),
        stderrBytes: byteLength("failure details"),
      });
    });
  });

  it("terminates a process that exceeds its timeout and returns a timeout result", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();

      const result = await runner.run(
        process.execPath,
        nodeScript("setInterval(() => undefined, 1_000);"),
        {
          cwd: runtimeRoot,
          timeoutMs: 50,
          maxStdoutBytes: 256,
          maxStderrBytes: 256,
        },
      );

      expect(result).toMatchObject({
        status: "failed",
        code: "request_timeout",
        retryable: true,
        timedOut: true,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(50);
      expect(result.stdoutBytes).toBe(0);
      expect(result.stderrBytes).toBe(0);
    });
  });

  it("terminates a process when stdout exceeds its byte cap and returns an output-too-large result", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();

      const result = await runner.run(
        process.execPath,
        nodeScript("process.stdout.write('abcdefghijklmnop'); setInterval(() => undefined, 1_000);"),
        {
          cwd: runtimeRoot,
          timeoutMs: 2_000,
          maxStdoutBytes: 8,
          maxStderrBytes: 256,
        },
      );

      expect(result).toMatchObject({
        status: "failed",
        code: "output_too_large",
        retryable: false,
        stream: "stdout",
      });
      expect(result.stdoutBytes).toBeGreaterThan(8);
      expect(byteLength(result.stdout)).toBeLessThanOrEqual(8);
    });
  });

  it("terminates a process when stderr exceeds its byte cap and returns an output-too-large result", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();

      const result = await runner.run(
        process.execPath,
        nodeScript("process.stderr.write('abcdefghijklmnop'); setInterval(() => undefined, 1_000);"),
        {
          cwd: runtimeRoot,
          timeoutMs: 2_000,
          maxStdoutBytes: 256,
          maxStderrBytes: 8,
        },
      );

      expect(result).toMatchObject({
        status: "failed",
        code: "output_too_large",
        retryable: false,
        stream: "stderr",
      });
      expect(result.stderrBytes).toBeGreaterThan(8);
      expect(byteLength(result.stderr)).toBeLessThanOrEqual(8);
    });
  });

  it("returns a process-start failure shape for an impossible command without stack traces", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      const runner = await createRunner();

      const result = await runner.run(
        join(runtimeRoot, "missing-command"),
        ["--version"],
        {
          cwd: runtimeRoot,
          ...defaultRunOptions,
        },
      );

      expect(result).toMatchObject({
        status: "failed",
        code: "process_failed",
        retryable: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        stdoutBytes: 0,
        stderrBytes: 0,
      });
      assertNoStackTrace(result);
    });
  });
});
