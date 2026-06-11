import { judgeProviderLabels, type JudgeProviderId } from "@x-builder/shared";

import type { ProviderReadinessSpec } from "./cli-readiness-probe.js";
import { CodexCliProvider } from "./codex-cli-provider.js";
import type { ProcessRunner } from "./process-runner.js";
import type { LlmProvider } from "./structured-llm-service.js";

export type JudgeProviderRegistryEntry = {
  id: JudgeProviderId;
  judgeLabel: string;
  readiness: ProviderReadinessSpec;
  createProvider: (options: { runner: ProcessRunner; workspaceRoot: string }) => LlmProvider<unknown>;
};

// The single per-provider wiring point. Only codex is registered in the first
// extension ticket; Claude/Cursor arrive in later tickets. Labels come from the
// shared catalog — the engine declares no provider label strings.
export const judgeProviderRegistry: readonly JudgeProviderRegistryEntry[] = [
  {
    id: "codex-cli",
    judgeLabel: judgeProviderLabels["codex-cli"],
    readiness: {
      command: "codex",
      adapter: "codex-cli",
      label: judgeProviderLabels["codex-cli"],
      sandbox: "read-only",
    },
    createProvider: ({ runner, workspaceRoot }) => new CodexCliProvider({ runner, workspaceRoot }),
  },
];
