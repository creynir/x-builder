import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Behaviour-level pinning for the process runner's child-environment construction
// when the caller supplies an EXPLICIT allowlist. This is the path every real
// caller (the codex provider and the readiness probe) takes today, so it is the
// behaviour that must survive the relocation of the provider env allowlists out
// of the runner: given an explicit allowlist, the child env contains exactly the
// allowlisted names that exist in the parent process.env — and nothing else.
//
// These names are pinned as concrete literals rather than imported from any
// source constant, so a rename/relocation of the allowlist keeps this green
// while a change to the effective passed-through set turns it red.

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
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
};

type ProcessRunner = {
  run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult>;
};

// The exact 12-name set the codex generation run passes through today.
const codexRunAllowlist = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "CODEX_SQLITE_HOME",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
  "RUST_LOG",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

const defaultRunOptions = {
  timeoutMs: 2_000,
  maxStdoutBytes: 4_096,
  maxStderrBytes: 4_096,
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
  const runtimeRoot = await mkdtemp(join(tmpdir(), "x-builder-process-runner-explicit-allowlist-"));

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

// Runs a tiny node child that reports back every environment variable name it
// actually received, so the test observes the child's real environment rather
// than re-reading the runner's internals.
async function childEnvNames(
  runner: ProcessRunner,
  runtimeRoot: string,
  envAllowlist: readonly string[],
): Promise<Set<string>> {
  const result = await runner.run(
    process.execPath,
    ["-e", "console.log(JSON.stringify(Object.keys(process.env)))"],
    {
      cwd: runtimeRoot,
      ...defaultRunOptions,
      envAllowlist,
    },
  );

  expect(result.status).toBe("success");

  return new Set(JSON.parse(result.stdout) as string[]);
}

// The OS-injected floor: variables the platform adds to ANY spawned child
// regardless of the allowlist (e.g. macOS adds __CF_USER_TEXT_ENCODING). We
// measure it with an empty allowlist so the assertions can isolate exactly the
// runner's own contribution rather than coupling to platform artifacts.
async function spawnFloor(runner: ProcessRunner, runtimeRoot: string): Promise<Set<string>> {
  return childEnvNames(runner, runtimeRoot, []);
}

function runnerContribution(childNames: Set<string>, floor: Set<string>): Set<string> {
  return new Set([...childNames].filter((name) => !floor.has(name)));
}

describe("node process runner with an explicit env allowlist", () => {
  it("passes exactly the explicitly allowlisted parent variables that are present, excluding everything else", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      // A couple of allowlisted vars are present in the parent; an allowlisted
      // var is deliberately left ABSENT; and several sensitive non-allowlisted
      // vars are present and must NOT cross into the child.
      vi.stubEnv("CODEX_HOME", "/tmp/x-builder-codex-home");
      vi.stubEnv("CODEX_API_KEY", "codex-key-secret");
      vi.stubEnv("RUST_LOG", "debug");
      vi.stubEnv("OPENAI_API_KEY", "openai-secret");
      vi.stubEnv("AWS_SECRET_ACCESS_KEY", "aws-secret");
      vi.stubEnv("GITHUB_TOKEN", "github-token-secret");
      vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid");
      // Ensure one allowlisted name is genuinely absent from the parent.
      vi.stubEnv("CODEX_SQLITE_HOME", undefined as unknown as string);

      try {
        const runner = await createRunner();
        const floor = await spawnFloor(runner, runtimeRoot);
        const childNames = await childEnvNames(runner, runtimeRoot, codexRunAllowlist);
        // Only the variables the runner itself injected (platform floor removed).
        const contributed = runnerContribution(childNames, floor);

        // Present + allowlisted → contributed by the runner.
        expect(contributed.has("CODEX_HOME")).toBe(true);
        expect(contributed.has("CODEX_API_KEY")).toBe(true);
        expect(contributed.has("RUST_LOG")).toBe(true);

        // Absent + allowlisted → NOT injected (only names that exist in the
        // parent are copied).
        expect(childNames.has("CODEX_SQLITE_HOME")).toBe(false);

        // Present but NOT allowlisted → excluded.
        expect(childNames.has("OPENAI_API_KEY")).toBe(false);
        expect(childNames.has("AWS_SECRET_ACCESS_KEY")).toBe(false);
        expect(childNames.has("GITHUB_TOKEN")).toBe(false);
        expect(childNames.has("HTTPS_PROXY")).toBe(false);

        // Everything the runner added is drawn from the allowlist: nothing
        // outside the allowlist leaks in.
        const allowed = new Set<string>(codexRunAllowlist);
        for (const name of contributed) {
          expect(allowed.has(name)).toBe(true);
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("passes through only PATH for the readiness-probe allowlist, even when other allowlisted secrets are present", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      // All of these would pass under the codex run allowlist; under the probe's
      // ["PATH"] allowlist, only PATH may cross into the child.
      vi.stubEnv("CODEX_HOME", "/tmp/x-builder-codex-home");
      vi.stubEnv("CODEX_API_KEY", "codex-key-secret");
      vi.stubEnv("HOME", "/tmp/x-builder-home");
      vi.stubEnv("SSL_CERT_FILE", "/tmp/x-builder-cert.pem");

      try {
        const runner = await createRunner();
        const floor = await spawnFloor(runner, runtimeRoot);
        const childNames = await childEnvNames(runner, runtimeRoot, ["PATH"]);
        const contributed = runnerContribution(childNames, floor);

        // The probe allowlist contributes exactly PATH and nothing else.
        expect([...contributed]).toEqual(["PATH"]);
        for (const name of ["CODEX_HOME", "CODEX_API_KEY", "HOME", "SSL_CERT_FILE"]) {
          expect(childNames.has(name)).toBe(false);
        }
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("passes the full codex-run set through when every allowlisted variable is present in the parent", async () => {
    await withTempRuntimeRoot(async (runtimeRoot) => {
      // Force every allowlisted name to be present so the effective child set is
      // exactly the 12-name allowlist (PATH already exists in the parent).
      for (const name of codexRunAllowlist) {
        if (name !== "PATH") {
          vi.stubEnv(name, `value-for-${name}`);
        }
      }

      try {
        const runner = await createRunner();
        const floor = await spawnFloor(runner, runtimeRoot);
        const childNames = await childEnvNames(runner, runtimeRoot, codexRunAllowlist);
        const contributed = runnerContribution(childNames, floor);

        // With every allowlisted name present in the parent, the runner's
        // contribution is exactly the 12-name codex run allowlist — no more, no
        // fewer.
        expect(contributed).toEqual(new Set(codexRunAllowlist));
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
