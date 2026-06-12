import { describe, expect, it, vi } from "vitest";
import {
  judgeProviderLabels,
  subsystemStatusSchema,
  type JudgeProviderId,
} from "@x-builder/shared";

import type { ProcessRunOptions, ProcessRunResult, ProcessRunner } from "../process-runner.js";

type ProviderReadinessSpec = {
  command: string;
  adapter: JudgeProviderId;
  label: string;
  sandbox: string;
};

type JudgeReadinessRegistryEntry = {
  id: JudgeProviderId;
  judgeLabel: string;
  readiness: ProviderReadinessSpec;
};

type CapturedProcessRun = {
  command: string;
  args: readonly string[];
  options: ProcessRunOptions;
};

type FakeProcessRunner = ProcessRunner & {
  calls: CapturedProcessRun[];
};

const workspaceRoot = "/tmp/x-builder-cursor-readiness-workspace";

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

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

const successfulProcessResult = (stdout: string): ProcessRunResult => ({
  status: "success",
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
  durationMs: 4,
  stdoutBytes: byteLength(stdout),
  stderrBytes: 0,
});

async function loadRegistry(): Promise<readonly JudgeReadinessRegistryEntry[]> {
  const module = (await import("../judge-provider-registry.js")) as {
    judgeProviderRegistry: readonly JudgeReadinessRegistryEntry[];
  };

  return module.judgeProviderRegistry;
}

async function loadSelectedJudgeReadinessProbe() {
  const module = (await import("../selected-judge-readiness-probe.js")) as {
    SelectedJudgeReadinessProbe: new (options: {
      resolveProvider: () => Promise<JudgeProviderId>;
      registry: readonly JudgeReadinessRegistryEntry[];
      resolveWorkspaceRoot: () => string | null;
      runner: ProcessRunner;
    }) => { check: () => Promise<unknown> };
  };

  return module.SelectedJudgeReadinessProbe;
}

describe("cursor judge readiness", () => {
  it("registers a cursor-cli readiness spec that probes cursor-agent with the ask-mode sandbox", async () => {
    const registry = await loadRegistry();
    const cursorEntry = registry.find((entry) => entry.id === "cursor-cli");

    if (cursorEntry === undefined) {
      throw new Error("Expected a cursor-cli entry in the judge provider registry.");
    }

    expect(cursorEntry.readiness.command).toBe("cursor-agent");
    expect(cursorEntry.readiness.adapter).toBe("cursor-cli");
    expect(cursorEntry.readiness.label).toBe(judgeProviderLabels["cursor-cli"]);
    expect(cursorEntry.readiness.sandbox).toBe("ask-mode");
    expect(cursorEntry.judgeLabel).toBe(judgeProviderLabels["cursor-cli"]);
    expect(cursorEntry.judgeLabel).toBe("Cursor judge");
  });

  it("probes cursor-agent --version and reports the Cursor judge slot ready when cursor-cli is selected", async () => {
    const registry = await loadRegistry();
    const runner = fakeProcessRunner(() => successfulProcessResult("2026.06.11 (cursor-agent)\n"));
    const SelectedJudgeReadinessProbe = await loadSelectedJudgeReadinessProbe();
    const probe = new SelectedJudgeReadinessProbe({
      resolveProvider: vi.fn(async () => "cursor-cli" as const),
      registry,
      resolveWorkspaceRoot: () => workspaceRoot,
      runner,
    });

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(runner.run).toHaveBeenCalledOnce();
    const [call] = runner.calls;
    expect(call?.command).toBe("cursor-agent");
    // Version-only readiness is the architectural invariant: ONLY --version, and
    // never the multi-second auth-status round-trips (status/about).
    expect(call?.args).toEqual(["--version"]);
    expect(status.state).toBe("ready");
    expect(status.label).toBe("Cursor judge");
  });

  it("never issues an auth-status subcommand (status/about) anywhere in the cursor readiness path", async () => {
    const registry = await loadRegistry();
    const runner = fakeProcessRunner(() => successfulProcessResult("2026.06.11 (cursor-agent)\n"));
    const SelectedJudgeReadinessProbe = await loadSelectedJudgeReadinessProbe();
    const probe = new SelectedJudgeReadinessProbe({
      resolveProvider: vi.fn(async () => "cursor-cli" as const),
      registry,
      resolveWorkspaceRoot: () => workspaceRoot,
      runner,
    });

    const status = subsystemStatusSchema.parse(await probe.check());

    // The probe must reach the cheap version check (proving the readiness path
    // actually ran), so the no-auth-status assertions below are not vacuously
    // true over an empty call list.
    expect(status.state).toBe("ready");
    expect(runner.run).toHaveBeenCalledOnce();
    const issuedArgs = runner.calls.flatMap((call) => [...call.args]);
    expect(issuedArgs).toContain("--version");
    expect(issuedArgs).not.toContain("status");
    expect(issuedArgs).not.toContain("about");
    // The single readiness invocation is the cheap version probe — no auth probe.
    const [call] = runner.calls;
    expect(call?.command).toBe("cursor-agent");
    expect(call?.args).toEqual(["--version"]);
  });
});
