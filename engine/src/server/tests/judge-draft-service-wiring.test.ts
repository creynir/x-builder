import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { judgeDraftResponseSchema, type AppSettings } from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner,
} from "../../llm/process-runner";
import { JsonFileAppSettingsRepository } from "../settings-repository";
import { buildServer, createDefaultJudgeDraftService } from "../server";

type CapturedRun = {
  command: string;
  args: readonly string[];
  options: ProcessRunOptions;
};

type FakeProcessRunner = ProcessRunner & {
  calls: CapturedRun[];
};

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
  },
  confidence: "medium",
  headline: "Strong hook, weak closer.",
  strengths: ["Opens with a concrete claim"],
  improvements: ["Trim the middle paragraph"],
};

const codexStdout = `${JSON.stringify(judgeModelOutput)}\n`;

const fakeCodexRunner = (): FakeProcessRunner => {
  const calls: CapturedRun[] = [];

  return {
    calls,
    run: vi.fn(async (command: string, args: readonly string[], options: ProcessRunOptions) => {
      calls.push({ command, args: [...args], options });

      const result: ProcessRunResult = {
        status: "success",
        stdout: codexStdout,
        stderr: "",
        exitCode: 0,
        signal: null,
        durationMs: 9,
        stdoutBytes: Buffer.byteLength(codexStdout, "utf8"),
        stderrBytes: 0,
      };

      return result;
    }),
  } as FakeProcessRunner;
};

const withGitWorkspace = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-judge-wiring-"));

  try {
    await mkdir(join(root, ".git"), { recursive: true });

    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const persistSettings = async (root: string, settings: AppSettings): Promise<void> => {
  const repository = new JsonFileAppSettingsRepository({ root });
  await repository.save(settings);
};

describe("default judge draft service wiring", () => {
  it("falls back to the codex provider and judges successfully when the settings file is unreadable", async () => {
    await withGitWorkspace(async (root) => {
      const settingsRoot = await mkdtemp(join(tmpdir(), "x-builder-judge-wiring-settings-"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        await writeFile(join(settingsRoot, "settings.json"), "{ not valid json", "utf8");
        const settingsRepository = new JsonFileAppSettingsRepository({ root: settingsRoot });
        const runner = fakeCodexRunner();
        const judgeDraftService = createDefaultJudgeDraftService({
          startupCwd: root,
          runner,
          settingsRepository,
        } as Parameters<typeof createDefaultJudgeDraftService>[0]);
        const app = buildServer({ judgeDraftService, settingsRepository });

        const response = await app.inject({
          method: "POST",
          url: "/drafts/judge",
          payload: { text: "A draft judged after a corrupt settings file." },
        });

        try {
          expect(response.statusCode).toBe(200);
          expect(runner.run).toHaveBeenCalledOnce();
          const body = judgeDraftResponseSchema.parse(JSON.parse(response.body));
          expect(body.model).toBe("codex-cli");
        } finally {
          await app.close();
        }
      } finally {
        errorSpy.mockRestore();
        await rm(settingsRoot, { recursive: true, force: true });
      }
    });
  });

  it("passes the configured codex model into the codex argv as -m <model>", async () => {
    await withGitWorkspace(async (root) => {
      const settingsRoot = await mkdtemp(join(tmpdir(), "x-builder-judge-wiring-settings-"));

      try {
        await persistSettings(settingsRoot, {
          engineBaseUrl: "http://127.0.0.1:4173",
          storagePath: join(settingsRoot, "storage"),
          judgeProvider: "codex-cli",
          codexModel: "gpt-5.2-codex",
          showDeterministicDetails: true,
        } as AppSettings);

        const settingsRepository = new JsonFileAppSettingsRepository({ root: settingsRoot });
        const runner = fakeCodexRunner();
        const judgeDraftService = createDefaultJudgeDraftService({
          startupCwd: root,
          runner,
          settingsRepository,
        } as Parameters<typeof createDefaultJudgeDraftService>[0]);
        const app = buildServer({ judgeDraftService, settingsRepository });

        const response = await app.inject({
          method: "POST",
          url: "/drafts/judge",
          payload: { text: "A draft judged with a configured codex model." },
        });

        try {
          expect(response.statusCode).toBe(200);
          expect(runner.run).toHaveBeenCalledOnce();
          const call = runner.calls[0]!;
          const modelIndex = call.args.indexOf("-m");
          expect(modelIndex).toBeGreaterThanOrEqual(0);
          expect(call.args[modelIndex + 1]).toBe("gpt-5.2-codex");
        } finally {
          await app.close();
        }
      } finally {
        await rm(settingsRoot, { recursive: true, force: true });
      }
    });
  });

  it("omits the -m flag from codex argv when no codex model is configured", async () => {
    await withGitWorkspace(async (root) => {
      const settingsRoot = await mkdtemp(join(tmpdir(), "x-builder-judge-wiring-settings-"));

      try {
        await persistSettings(settingsRoot, {
          engineBaseUrl: "http://127.0.0.1:4173",
          storagePath: join(settingsRoot, "storage"),
          judgeProvider: "codex-cli",
          showDeterministicDetails: true,
        } as AppSettings);

        const settingsRepository = new JsonFileAppSettingsRepository({ root: settingsRoot });
        const runner = fakeCodexRunner();
        const judgeDraftService = createDefaultJudgeDraftService({
          startupCwd: root,
          runner,
          settingsRepository,
        } as Parameters<typeof createDefaultJudgeDraftService>[0]);
        const app = buildServer({ judgeDraftService, settingsRepository });

        const response = await app.inject({
          method: "POST",
          url: "/drafts/judge",
          payload: { text: "A draft judged with no configured codex model." },
        });

        try {
          expect(response.statusCode).toBe(200);
          expect(runner.run).toHaveBeenCalledOnce();
          expect(runner.calls[0]!.args).not.toContain("-m");
        } finally {
          await app.close();
        }
      } finally {
        await rm(settingsRoot, { recursive: true, force: true });
      }
    });
  });
});
