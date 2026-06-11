import { describe, expect, it, vi } from "vitest";

import type { LlmProvider } from "../structured-llm-service.js";
import type { ProcessRunner } from "../process-runner.js";

type JudgeProviderRegistryEntry = {
  id: string;
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
  it("registers only the codex-cli provider in the first extension ticket", async () => {
    const registry = await loadJudgeProviderRegistry();

    expect(registry.map((entry) => entry.id)).toEqual(["codex-cli"]);
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
});
