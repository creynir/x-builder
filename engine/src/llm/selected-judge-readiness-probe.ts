import {
  subsystemStatusSchema,
  type JudgeProviderId,
  type SubsystemStatus,
} from "@x-builder/shared";

import { CliReadinessProbe, type ProviderReadinessSpec } from "./cli-readiness-probe.js";
import type { ProcessRunner } from "./process-runner.js";

// The probe consumes only the readiness-relevant slice of a registry entry, so
// the full provider registry (which also carries createProvider) satisfies it.
export type JudgeReadinessRegistryEntry = {
  id: JudgeProviderId;
  judgeLabel: string;
  readiness: ProviderReadinessSpec;
};

export type SelectedJudgeReadinessProbeOptions = {
  resolveProvider: () => Promise<JudgeProviderId>;
  registry: readonly JudgeReadinessRegistryEntry[];
  resolveWorkspaceRoot: () => string | null;
  runner: ProcessRunner;
  executionTimeoutMs?: number;
};

// Provider-agnostic fallback label for slots that cannot name a provider: when
// no registry entry matches the selected id there is no catalog label to use.
const fallbackJudgeLabel = "Judge";

export class SelectedJudgeReadinessProbe {
  private readonly resolveProvider: () => Promise<JudgeProviderId>;
  private readonly registry: readonly JudgeReadinessRegistryEntry[];
  private readonly resolveWorkspaceRoot: () => string | null;
  private readonly runner: ProcessRunner;
  private readonly executionTimeoutMs?: number;

  constructor(options: SelectedJudgeReadinessProbeOptions) {
    this.resolveProvider = options.resolveProvider;
    this.registry = options.registry;
    this.resolveWorkspaceRoot = options.resolveWorkspaceRoot;
    this.runner = options.runner;
    this.executionTimeoutMs = options.executionTimeoutMs;
  }

  async check(): Promise<SubsystemStatus> {
    const providerId = await this.resolveProvider();
    const entry = this.registry.find((candidate) => candidate.id === providerId);

    if (!entry) {
      return unavailable(fallbackJudgeLabel, {
        message: "Judge provider is not available in this build.",
      });
    }

    const workspaceRoot = this.resolveWorkspaceRoot();

    if (!workspaceRoot) {
      return unavailable(entry.judgeLabel, {
        message: "Workspace root could not be resolved.",
        details: {
          reason: "workspace_root_unresolved",
        },
      });
    }

    const probe = new CliReadinessProbe({
      spec: entry.readiness,
      runner: this.runner,
      workspaceRoot,
      ...(this.executionTimeoutMs !== undefined
        ? { executionTimeoutMs: this.executionTimeoutMs }
        : {}),
    });

    return probe.check();
  }
}

const unavailable = (
  label: string,
  overrides: Partial<Pick<SubsystemStatus, "message" | "details">>,
): SubsystemStatus =>
  subsystemStatusSchema.parse({
    state: "unavailable",
    label,
    checkedAt: new Date().toISOString(),
    retryable: true,
    details: {},
    ...overrides,
  });
