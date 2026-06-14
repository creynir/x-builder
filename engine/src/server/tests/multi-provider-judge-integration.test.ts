import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiErrorSchema,
  judgeDraftResponseSchema,
  judgeProviderIdSchema,
  judgeProviderLabels,
  type AppSettings,
  type JudgeProviderId,
} from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import { judgeProviderRegistry } from "../../llm/judge-provider-registry";
import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner,
} from "../../llm/process-runner";
import { JsonFileAppSettingsRepository } from "../settings-repository";
import { buildServer, createDefaultJudgeDraftService } from "../server";

// Cross-cutting integration coverage for the multi-provider judge backend.
// Everything is driven through the REAL modules (settings repo -> resolver ->
// JudgeDraftService -> StructuredLlmService -> the selected provider) over a
// Fastify inject, mocking ONLY the process boundary with a fake ProcessRunner.
// No CLI is ever spawned and only temp-root settings repositories are touched.

const generalizedJudgeFailedMessage = "The judge could not score this draft. Try again.";

// A verdict-shaped model output (overall 78 -> derived band "slight_rework").
// Every provider's success fixture/stdout below carries this exact verdict so
// the judged response is identical regardless of which provider routed it.
const judgeModelOutput = {
  scores: {
    overall: 78,
    replies: 80,
    profileClicks: 72,
    impressions: 65,
    bookmarkValue: 60,
    dwellProxy: 70,
    voiceMatch: 85,
    negativeRisk: 10,
    answerEffort: 55,
    strangerAnswerability: 48,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: null,
  },
  confidence: "medium",
  headline: "Strong hook, weak closer.",
  strengths: ["Opens with a concrete claim"],
  improvements: ["Trim the middle paragraph"],
} as const;

// Per-provider success stdout, schema-shaped to each CLI's real output contract:
// codex emits a single JSON object; claude wraps it in a result envelope under
// structured_output; cursor returns it as a JSON-string `result`.
const codexSuccessStdout = `${JSON.stringify(judgeModelOutput)}\n`;
const claudeSuccessStdout = `${JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "",
  structured_output: judgeModelOutput,
})}\n`;
const cursorSuccessStdout = `${JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: JSON.stringify(judgeModelOutput),
})}\n`;

const successStdoutByProvider: Record<JudgeProviderId, string> = {
  "codex-cli": codexSuccessStdout,
  "claude-cli": claudeSuccessStdout,
  "cursor-cli": cursorSuccessStdout,
};

// The CLI command each provider id spawns through the runner.
const commandByProvider: Record<JudgeProviderId, string> = {
  "codex-cli": "codex",
  "claude-cli": "claude",
  "cursor-cli": "cursor-agent",
};

// The settings model key each provider id reads its configured model from.
const modelKeyByProvider: Record<JudgeProviderId, keyof AppSettings> = {
  "codex-cli": "codexModel",
  "claude-cli": "claudeModel",
  "cursor-cli": "cursorModel",
};

// The model flag each provider appends to its argv when a model is configured.
const modelFlagByProvider: Record<JudgeProviderId, string> = {
  "codex-cli": "-m",
  "claude-cli": "--model",
  "cursor-cli": "--model",
};

const allProviderIds = judgeProviderIdSchema.options;

type CapturedRun = {
  command: string;
  args: readonly string[];
  options: ProcessRunOptions;
};

type FakeProcessRunner = ProcessRunner & {
  calls: CapturedRun[];
};

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

const parseJson = (payload: string): unknown => JSON.parse(payload);

const successProcessResult = (stdout: string, stderr = ""): ProcessRunResult => ({
  status: "success",
  stdout,
  stderr,
  exitCode: 0,
  signal: null,
  durationMs: 11,
  stdoutBytes: byteLength(stdout),
  stderrBytes: byteLength(stderr),
});

const fakeRunner = (
  handler: (call: CapturedRun) => ProcessRunResult | Promise<ProcessRunResult>,
): FakeProcessRunner => {
  const calls: CapturedRun[] = [];

  return {
    calls,
    run: vi.fn(async (command, args, options) => {
      const call: CapturedRun = { command, args: [...args], options };
      calls.push(call);

      return handler(call);
    }),
  } as FakeProcessRunner;
};

// A success runner that returns the success stdout matching whichever CLI was
// invoked, so a single runner serves any selected provider.
const successRunnerForAnyProvider = (): FakeProcessRunner =>
  fakeRunner((call) => {
    const provider = (Object.keys(commandByProvider) as JudgeProviderId[]).find(
      (id) => commandByProvider[id] === call.command,
    );

    if (!provider) {
      throw new Error(`Unexpected command spawned by the judge path: ${call.command}`);
    }

    return successProcessResult(successStdoutByProvider[provider]);
  });

const baseSettings = (root: string, overrides: Partial<AppSettings>): AppSettings =>
  ({
    engineBaseUrl: "http://127.0.0.1:4173",
    storagePath: join(root, "storage"),
    judgeProvider: "codex-cli",
    showDeterministicDetails: true,
    ...overrides,
  }) as AppSettings;

// Builds a wired server end-to-end: a real temp-root settings repository pinned
// to `root`, a git workspace at `root` so a workspace root resolves, the REAL
// createDefaultJudgeDraftService (resolver + per-call model + provider map), and
// the fake runner as the only mocked seam.
const withWiredServer = async <T>(
  options: {
    settings?: Partial<AppSettings>;
    persist?: boolean;
    runner?: FakeProcessRunner;
  },
  run: (context: {
    app: ReturnType<typeof buildServer>;
    runner: FakeProcessRunner;
    settingsRepository: JsonFileAppSettingsRepository;
    root: string;
  }) => Promise<T>,
): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-multi-provider-"));

  try {
    await mkdir(join(root, ".git"), { recursive: true });

    const settingsRepository = new JsonFileAppSettingsRepository({ root });

    if (options.persist !== false) {
      await settingsRepository.save(baseSettings(root, options.settings ?? {}));
    }

    const runner = options.runner ?? successRunnerForAnyProvider();
    const judgeDraftService = createDefaultJudgeDraftService({
      startupCwd: root,
      runner,
      settingsRepository,
    } as Parameters<typeof createDefaultJudgeDraftService>[0]);
    const app = buildServer({ judgeDraftService, settingsRepository });

    try {
      return await run({ app, runner, settingsRepository, root });
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const patchProvider = async (
  app: ReturnType<typeof buildServer>,
  root: string,
  provider: JudgeProviderId,
  overrides: Partial<AppSettings> = {},
): Promise<void> => {
  const response = await app.inject({
    method: "PATCH",
    url: "/settings",
    payload: baseSettings(root, { judgeProvider: provider, ...overrides }),
  });

  expect(response.statusCode).toBe(200);
};

const judge = (app: ReturnType<typeof buildServer>, text: string) =>
  app.inject({ method: "POST", url: "/drafts/judge", payload: { text } });

// Build a single provider's argv via its registry createProvider + a fake runner,
// driven through one real judge call so the model option flows from settings.
const buildArgvForProvider = async (
  provider: JudgeProviderId,
  options: { model?: string } = {},
): Promise<readonly string[]> => {
  let captured: readonly string[] | undefined;

  await withWiredServer(
    {
      settings: {
        judgeProvider: provider,
        ...(options.model !== undefined ? { [modelKeyByProvider[provider]]: options.model } : {}),
      },
    },
    async ({ app, runner }) => {
      const response = await judge(app, `Argv capture draft for ${provider}.`);
      expect(response.statusCode).toBe(200);
      expect(runner.run).toHaveBeenCalledOnce();
      captured = runner.calls[0]?.args;
    },
  );

  if (!captured) {
    throw new Error(`Expected the fake runner to capture argv for ${provider}.`);
  }

  return captured;
};

describe("multi-provider judge backend — user flows", () => {
  // FLOW 1: per-provider routing through the full path.
  it("routes a judge request to the distinct argv shape of each selected provider", async () => {
    await withWiredServer({}, async ({ app, runner, root }) => {
      // codex: exec --output-schema form.
      await patchProvider(app, root, "codex-cli");
      const codexResponse = await judge(app, "A draft routed to codex.");
      expect(codexResponse.statusCode).toBe(200);
      expect(judgeDraftResponseSchema.parse(parseJson(codexResponse.body)).model).toBe("codex-cli");
      const codexCall = runner.calls.at(-1)!;
      expect(codexCall.command).toBe("codex");
      expect(codexCall.args).toContain("exec");
      expect(codexCall.args).toContain("--output-schema");
      expect(codexCall.args).toContain("--sandbox");
      expect(codexCall.args).not.toContain("--mode");
      expect(codexCall.args).not.toContain("--json-schema");

      // claude: -p --json-schema --tools "" form.
      await patchProvider(app, root, "claude-cli");
      const claudeResponse = await judge(app, "A draft routed to claude.");
      expect(claudeResponse.statusCode).toBe(200);
      expect(judgeDraftResponseSchema.parse(parseJson(claudeResponse.body)).model).toBe(
        "claude-cli",
      );
      const claudeCall = runner.calls.at(-1)!;
      expect(claudeCall.command).toBe("claude");
      expect(claudeCall.args).toContain("--json-schema");
      const claudeToolsIndex = claudeCall.args.indexOf("--tools");
      expect(claudeToolsIndex).toBeGreaterThanOrEqual(0);
      expect(claudeCall.args[claudeToolsIndex + 1]).toBe("");
      expect(claudeCall.args).not.toContain("exec");
      expect(claudeCall.args).not.toContain("--output-schema");

      // cursor: -p --mode ask --sandbox enabled form with empty stdin.
      await patchProvider(app, root, "cursor-cli");
      const cursorResponse = await judge(app, "A draft routed to cursor.");
      expect(cursorResponse.statusCode).toBe(200);
      expect(judgeDraftResponseSchema.parse(parseJson(cursorResponse.body)).model).toBe(
        "cursor-cli",
      );
      const cursorCall = runner.calls.at(-1)!;
      expect(cursorCall.command).toBe("cursor-agent");
      const cursorModeIndex = cursorCall.args.indexOf("--mode");
      expect(cursorCall.args[cursorModeIndex + 1]).toBe("ask");
      const cursorSandboxIndex = cursorCall.args.indexOf("--sandbox");
      expect(cursorCall.args[cursorSandboxIndex + 1]).toBe("enabled");
      expect(cursorCall.options.stdin).toBe("");
      expect(cursorCall.args).not.toContain("exec");
    });
  });

  // FLOW 3 (judge side): a settings file that fails to load falls back to codex
  // end-to-end. The status side of flow 3 lives in the readiness sibling suite.
  it("falls back to the codex provider end-to-end when the settings file fails to load", async () => {
    await withWiredServer({ persist: false }, async ({ app, runner, root }) => {
      // Write a corrupt settings file the repository cannot parse; the resolver
      // (and model resolver) must both swallow the failure and pick codex.
      await rm(join(root, "settings.json"), { force: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(root, "settings.json"), "{ not valid json", "utf8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const response = await judge(app, "A draft judged after a corrupt settings file.");

        expect(response.statusCode).toBe(200);
        expect(runner.run).toHaveBeenCalledOnce();
        const body = judgeDraftResponseSchema.parse(parseJson(response.body));
        expect(body.model).toBe("codex-cli");
        expect(runner.calls[0]?.command).toBe("codex");
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});

describe("multi-provider judge backend — per-provider failure-mode HTTP mapping", () => {
  // FLOW 4: each provider's failure modes map through the fake runner to the
  // documented HTTP code with the generalized copy and no output leakage.
  const stdoutSentinel = "STDOUT_SENTINEL_DO_NOT_LEAK";
  const stderrSentinel = "STDERR_SENTINEL_DO_NOT_LEAK";

  const timeoutResult = (): ProcessRunResult => ({
    status: "failed",
    code: "request_timeout",
    retryable: true,
    timedOut: true,
    stdout: stdoutSentinel,
    stderr: stderrSentinel,
    exitCode: null,
    signal: null,
    durationMs: 12_345,
    stdoutBytes: byteLength(stdoutSentinel),
    stderrBytes: byteLength(stderrSentinel),
  });

  const nonzeroExitResult = (): ProcessRunResult => ({
    status: "failed",
    code: "nonzero_exit",
    retryable: false,
    stdout: stdoutSentinel,
    stderr: stderrSentinel,
    exitCode: 1,
    signal: null,
    durationMs: 8,
    stdoutBytes: byteLength(stdoutSentinel),
    stderrBytes: byteLength(stderrSentinel),
  });

  const oversizedResult = (): ProcessRunResult => ({
    status: "failed",
    code: "output_too_large",
    retryable: false,
    stream: "stdout",
    stdout: stdoutSentinel,
    stderr: stderrSentinel,
    exitCode: null,
    signal: null,
    durationMs: 9,
    stdoutBytes: 5_000_000,
    stderrBytes: byteLength(stderrSentinel),
  });

  // Malformed (non-JSON) stdout on a successful exit -> invalid_provider_response.
  const malformedStdoutResult = (): ProcessRunResult =>
    successProcessResult(`${stdoutSentinel} this is not json at all`, stderrSentinel);

  // Schema-shaped JSON that nonetheless fails the verdict parser (scores out of
  // range) -> structured_output_invalid for codex/claude/cursor success paths.
  const schemaMismatchStdoutByProvider: Record<JudgeProviderId, string> = {
    "codex-cli": `${JSON.stringify({ ...judgeModelOutput, scores: { ...judgeModelOutput.scores, replies: 999 } })}\n`,
    "claude-cli": `${JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      structured_output: { ...judgeModelOutput, scores: { ...judgeModelOutput.scores, replies: 999 } },
    })}\n`,
    "cursor-cli": `${JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: JSON.stringify({ ...judgeModelOutput, scores: { ...judgeModelOutput.scores, replies: 999 } }),
    })}\n`,
  };

  it.each(allProviderIds)(
    "maps a retryable timeout to a 503 judge_failed for %s",
    async (provider) => {
      const runner = fakeRunner(() => timeoutResult());

      await withWiredServer({ settings: { judgeProvider: provider }, runner }, async ({ app }) => {
        const response = await judge(app, "A draft that keeps timing out.");

        expect(response.statusCode).toBe(503);
        const error = apiErrorSchema.parse(parseJson(response.body));
        expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: true });
        expect(error.message).toBe(generalizedJudgeFailedMessage);
        // The default judge contract runs a single attempt (attempts: 1); the
        // retryable failure surfaces as 503 without a re-run on this path. (The
        // bounded retry ceiling itself is covered by the structured-llm-service
        // suite, which exercises attempts: 2.)
        expect(runner.run).toHaveBeenCalledOnce();
        expect(response.body).not.toContain(stdoutSentinel);
        expect(response.body).not.toContain(stderrSentinel);
      });
    },
  );

  it.each(allProviderIds)(
    "maps a non-retryable nonzero exit to a 500 judge_failed for %s",
    async (provider) => {
      const runner = fakeRunner(() => nonzeroExitResult());

      await withWiredServer({ settings: { judgeProvider: provider }, runner }, async ({ app }) => {
        const response = await judge(app, "A draft whose CLI exits nonzero.");

        expect(response.statusCode).toBe(500);
        const error = apiErrorSchema.parse(parseJson(response.body));
        expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: false });
        expect(error.message).toBe(generalizedJudgeFailedMessage);
        // Non-retryable: a single attempt, no bounded retry.
        expect(runner.run).toHaveBeenCalledOnce();
        expect(response.body).not.toContain(stdoutSentinel);
        expect(response.body).not.toContain(stderrSentinel);
      });
    },
  );

  it.each(allProviderIds)(
    "maps oversized output to a 500 judge_failed for %s",
    async (provider) => {
      const runner = fakeRunner(() => oversizedResult());

      await withWiredServer({ settings: { judgeProvider: provider }, runner }, async ({ app }) => {
        const response = await judge(app, "A draft whose CLI floods stdout.");

        expect(response.statusCode).toBe(500);
        const error = apiErrorSchema.parse(parseJson(response.body));
        expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: false });
        expect(error.message).toBe(generalizedJudgeFailedMessage);
        expect(response.body).not.toContain(stdoutSentinel);
        expect(response.body).not.toContain(stderrSentinel);
      });
    },
  );

  it.each(allProviderIds)(
    "maps malformed stdout to a 500 judge_failed for %s",
    async (provider) => {
      const runner = fakeRunner(() => malformedStdoutResult());

      await withWiredServer({ settings: { judgeProvider: provider }, runner }, async ({ app }) => {
        const response = await judge(app, "A draft whose CLI returns garbage stdout.");

        expect(response.statusCode).toBe(500);
        const error = apiErrorSchema.parse(parseJson(response.body));
        expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: false });
        expect(error.message).toBe(generalizedJudgeFailedMessage);
        expect(response.body).not.toContain(stdoutSentinel);
        expect(response.body).not.toContain(stderrSentinel);
      });
    },
  );

  it.each(allProviderIds)(
    "maps schema-mismatch output to a 500 judge_failed for %s",
    async (provider) => {
      const runner = fakeRunner(() =>
        successProcessResult(schemaMismatchStdoutByProvider[provider]),
      );

      await withWiredServer({ settings: { judgeProvider: provider }, runner }, async ({ app }) => {
        const response = await judge(app, "A draft whose verdict violates the schema.");

        expect(response.statusCode).toBe(500);
        const error = apiErrorSchema.parse(parseJson(response.body));
        expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: false });
        expect(error.message).toBe(generalizedJudgeFailedMessage);
      });
    },
  );
});

describe("multi-provider judge backend — architectural invariants", () => {
  // INVARIANT 1: registry completeness. Falsifiable: a missing or partial entry
  // (no createProvider or no readiness spec) for any enum value fails this.
  it("has a complete registry entry (factory + readiness) for every provider id in the enum", () => {
    for (const id of allProviderIds) {
      const entry = judgeProviderRegistry.find((candidate) => candidate.id === id);

      expect(entry, `registry must contain an entry for ${id}`).toBeDefined();
      expect(typeof entry?.createProvider).toBe("function");
      expect(entry?.readiness).toBeDefined();
      expect(entry?.readiness.command.length).toBeGreaterThan(0);
      expect(entry?.readiness.adapter).toBe(id);
    }

    // The registry carries no id outside the enum either.
    expect(judgeProviderRegistry.map((entry) => entry.id).sort()).toEqual([...allProviderIds].sort());
  });

  // INVARIANT 2: read-only argv. Falsifiable: a write/shell-granting flag, or a
  // missing read-only marker for any provider, fails this.
  it("never builds write- or shell-granting argv and always carries each provider's read-only marker", async () => {
    const writeOrShellFlags = [
      "--write",
      "--allow-write",
      "--dangerously-skip-permissions",
      "--full-auto",
      "--shell",
      "--exec-shell",
      "--yolo",
      "--sandbox=danger-full-access",
    ];

    for (const provider of allProviderIds) {
      const args = await buildArgvForProvider(provider);

      for (const flag of writeOrShellFlags) {
        expect(args, `${provider} argv must not contain ${flag}`).not.toContain(flag);
      }
    }

    const codexArgs = await buildArgvForProvider("codex-cli");
    const codexSandboxIndex = codexArgs.indexOf("--sandbox");
    expect(codexSandboxIndex).toBeGreaterThanOrEqual(0);
    expect(codexArgs[codexSandboxIndex + 1]).toBe("read-only");

    const claudeArgs = await buildArgvForProvider("claude-cli");
    const claudeToolsIndex = claudeArgs.indexOf("--tools");
    expect(claudeToolsIndex).toBeGreaterThanOrEqual(0);
    expect(claudeArgs[claudeToolsIndex + 1]).toBe("");

    const cursorArgs = await buildArgvForProvider("cursor-cli");
    expect(cursorArgs).toContain("--mode");
    expect(cursorArgs[cursorArgs.indexOf("--mode") + 1]).toBe("ask");
    expect(cursorArgs).toContain("--sandbox");
    expect(cursorArgs[cursorArgs.indexOf("--sandbox") + 1]).toBe("enabled");
  });

  // INVARIANT 3: no secret/output leakage on any failure path. Falsifiable: a
  // leaked stdout/stderr/env sentinel in serialized failure details fails this.
  it("never leaks stdout, stderr, or env values in failure details for any provider", async () => {
    const stdoutSentinel = "FAILURE_STDOUT_SENTINEL_DO_NOT_LEAK";
    const stderrSentinel = "FAILURE_STDERR_SENTINEL_DO_NOT_LEAK";
    const envSentinel = "ENV_API_KEY_SENTINEL_DO_NOT_LEAK";
    process.env.X_BUILDER_FAKE_SECRET = envSentinel;

    try {
      for (const provider of allProviderIds) {
        // Exercise both a process-level failure (nonzero exit carrying sentinels)
        // and a parser-level failure (malformed stdout carrying a sentinel).
        const processFailureRunner = fakeRunner(() => ({
          status: "failed",
          code: "nonzero_exit",
          retryable: false,
          stdout: `${stdoutSentinel} ${envSentinel}`,
          stderr: `${stderrSentinel} ${envSentinel}`,
          exitCode: 1,
          signal: null,
          durationMs: 6,
          stdoutBytes: 64,
          stderrBytes: 64,
          details: { leakedStdout: stdoutSentinel, leakedStderr: stderrSentinel },
        }));

        await withWiredServer(
          { settings: { judgeProvider: provider }, runner: processFailureRunner },
          async ({ app }) => {
            const response = await judge(app, "A failing draft that must not leak.");

            expect(response.statusCode).toBe(500);
            expect(response.body).not.toContain(stdoutSentinel);
            expect(response.body).not.toContain(stderrSentinel);
            expect(response.body).not.toContain(envSentinel);
          },
        );

        const parserFailureRunner = fakeRunner(() =>
          successProcessResult(`${stdoutSentinel} not-json ${envSentinel}`, `${stderrSentinel}`),
        );

        await withWiredServer(
          { settings: { judgeProvider: provider }, runner: parserFailureRunner },
          async ({ app }) => {
            const response = await judge(app, "A malformed draft that must not leak.");

            expect(response.statusCode).toBe(500);
            expect(response.body).not.toContain(stdoutSentinel);
            expect(response.body).not.toContain(stderrSentinel);
            expect(response.body).not.toContain(envSentinel);
          },
        );
      }
    } finally {
      delete process.env.X_BUILDER_FAKE_SECRET;
    }
  });

  // INVARIANT 6: model flag iff configured. Falsifiable: a stray model flag with
  // no model configured, or a missing/wrong flag when one is, fails this.
  it("emits each provider's model flag if and only if a non-empty model is configured", async () => {
    for (const provider of allProviderIds) {
      const flag = modelFlagByProvider[provider];

      const withoutModel = await buildArgvForProvider(provider);
      expect(withoutModel, `${provider} must not carry ${flag} with no model configured`).not.toContain(
        flag,
      );

      const withModel = await buildArgvForProvider(provider, { model: `model-for-${provider}` });
      const flagIndex = withModel.indexOf(flag);
      expect(flagIndex, `${provider} must carry ${flag} when a model is configured`).toBeGreaterThanOrEqual(
        0,
      );
      expect(withModel[flagIndex + 1]).toBe(`model-for-${provider}`);
      // Exactly one model flag emitted.
      expect(withModel.filter((arg) => arg === flag)).toHaveLength(1);
    }
  });

  // Label single-source is asserted directly against the registry here (it does
  // not require the runner); the readiness-label half lives in the sibling suite.
  it("sources every registry judgeLabel from the shared label catalog", () => {
    for (const entry of judgeProviderRegistry) {
      expect(entry.judgeLabel).toBe(judgeProviderLabels[entry.id]);
      expect(entry.readiness.label).toBe(judgeProviderLabels[entry.id]);
    }
  });
});
