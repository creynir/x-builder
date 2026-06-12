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

const workspaceRoot = "/tmp/x-builder-claude-readiness-workspace";

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

describe("claude judge readiness", () => {
  it("registers a claude-cli readiness spec that probes the claude command with a tools-disabled sandbox", async () => {
    const registry = await loadRegistry();
    const claudeEntry = registry.find((entry) => entry.id === "claude-cli");

    if (claudeEntry === undefined) {
      throw new Error("Expected a claude-cli entry in the judge provider registry.");
    }

    expect(claudeEntry.readiness.command).toBe("claude");
    expect(claudeEntry.readiness.adapter).toBe("claude-cli");
    expect(claudeEntry.readiness.label).toBe(judgeProviderLabels["claude-cli"]);
    expect(claudeEntry.readiness.sandbox).toBe("tools-disabled");
    expect(claudeEntry.judgeLabel).toBe(judgeProviderLabels["claude-cli"]);
  });

  it("probes claude --version and reports the Claude judge slot ready when claude-cli is selected", async () => {
    const registry = await loadRegistry();
    const runner = fakeProcessRunner(() => successfulProcessResult("2.1.111 (Claude Code)\n"));
    const SelectedJudgeReadinessProbe = await loadSelectedJudgeReadinessProbe();
    const probe = new SelectedJudgeReadinessProbe({
      resolveProvider: vi.fn(async () => "claude-cli" as const),
      registry,
      resolveWorkspaceRoot: () => workspaceRoot,
      runner,
    });

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(runner.run).toHaveBeenCalledOnce();
    const [call] = runner.calls;
    expect(call?.command).toBe("claude");
    expect(call?.args).toEqual(["--version"]);
    expect(status.state).toBe("ready");
    expect(status.label).toBe("Claude judge");
  });

  it("drops an unsafe version string while keeping the Claude judge slot ready", async () => {
    const registry = await loadRegistry();
    // A version line that trips the probe's no-leak regex (contains a home path)
    // must be dropped from details while the ready state is preserved.
    const runner = fakeProcessRunner(() =>
      successfulProcessResult("2.1.111 from /Users/secret/.claude/local\n"),
    );
    const SelectedJudgeReadinessProbe = await loadSelectedJudgeReadinessProbe();
    const probe = new SelectedJudgeReadinessProbe({
      resolveProvider: vi.fn(async () => "claude-cli" as const),
      registry,
      resolveWorkspaceRoot: () => workspaceRoot,
      runner,
    });

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(status.state).toBe("ready");
    expect(status.label).toBe("Claude judge");
    expect(JSON.stringify(status)).not.toContain("/Users/secret");
    expect(status.details).not.toHaveProperty("version");
  });
});
