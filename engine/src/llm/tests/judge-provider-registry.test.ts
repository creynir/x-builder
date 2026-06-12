import { describe, expect, it, vi } from "vitest";
import { judgeProviderLabels } from "@x-builder/shared";

import type { LlmProvider } from "../structured-llm-service.js";
import type { ProcessRunner } from "../process-runner.js";

type ProviderReadinessSpec = {
  command: string;
  adapter: string;
  label: string;
  sandbox: string;
};

type JudgeProviderRegistryEntry = {
  id: string;
  judgeLabel: string;
  readiness: ProviderReadinessSpec;
  createProvider: (options: { runner: ProcessRunner; workspaceRoot: string }) => LlmProvider<unknown>;
};

async function loadJudgeProviderRegistry(): Promise<readonly JudgeProviderRegistryEntry[]> {
  const module = (await import("../judge-provider-registry.js")) as {
    judgeProviderRegistry: readonly JudgeProviderRegistryEntry[];
  };

  return module.judgeProviderRegistry;
}

const fakeRunner = (): ProcessRunner =>
  ({
    run: vi.fn(async () => {
      throw new Error("The registry test must not spawn a real process.");
    }),
  }) as unknown as ProcessRunner;

describe("judge provider registry", () => {
  it("registers both the codex-cli and claude-cli providers", async () => {
    const registry = await loadJudgeProviderRegistry();

    // Membership, not an exact set: cursor-cli arrives in a later ticket, so the
    // registry must CONTAIN these ids without pinning "exactly these two".
    const ids = registry.map((entry) => entry.id);
    expect(ids).toContain("codex-cli");
    expect(ids).toContain("claude-cli");
  });

  it("creates a codex provider whose id matches the registered codex entry", async () => {
    const registry = await loadJudgeProviderRegistry();
    const codexEntry = registry.find((entry) => entry.id === "codex-cli");

    if (codexEntry === undefined) {
      throw new Error("Expected a codex-cli entry in the judge provider registry.");
    }

    const provider = codexEntry.createProvider({
      runner: fakeRunner(),
      workspaceRoot: "/tmp/x-builder-registry-workspace",
    });

    expect(provider.id).toBe("codex-cli");
  });

  it("creates a claude provider whose id matches the registered claude entry", async () => {
    const registry = await loadJudgeProviderRegistry();
    const claudeEntry = registry.find((entry) => entry.id === "claude-cli");

    if (claudeEntry === undefined) {
      throw new Error("Expected a claude-cli entry in the judge provider registry.");
    }

    const provider = claudeEntry.createProvider({
      runner: fakeRunner(),
      workspaceRoot: "/tmp/x-builder-registry-workspace",
    });

    expect(provider.id).toBe("claude-cli");
  });

  it("labels the claude entry from the shared catalog and probes claude with a tools-disabled sandbox", async () => {
    const registry = await loadJudgeProviderRegistry();
    const claudeEntry = registry.find((entry) => entry.id === "claude-cli");

    if (claudeEntry === undefined) {
      throw new Error("Expected a claude-cli entry in the judge provider registry.");
    }

    expect(claudeEntry.judgeLabel).toBe(judgeProviderLabels["claude-cli"]);
    expect(claudeEntry.judgeLabel).toBe("Claude judge");
    expect(claudeEntry.readiness).toMatchObject({
      command: "claude",
      adapter: "claude-cli",
      label: judgeProviderLabels["claude-cli"],
      sandbox: "tools-disabled",
    });
  });
});
