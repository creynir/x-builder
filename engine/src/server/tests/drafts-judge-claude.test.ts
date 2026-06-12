import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  judgeDraftResponseSchema,
  type JudgeVerdict,
} from "@x-builder/shared";

import { ClaudeCliProvider } from "../../llm/claude-cli-provider";
import { JudgeDraftService } from "../../llm/judge-draft-service";
import {
  StructuredLlmService,
  type StructuredLlmProviderResult,
} from "../../llm/structured-llm-service";
import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner,
} from "../../llm/process-runner";
import { buildServer } from "../server";

const generalizedJudgeFailedMessage = "The judge could not score this draft. Try again.";

const testDir = dirname(fileURLToPath(import.meta.url));
const claudeFixturesDir = join(testDir, "..", "..", "llm", "tests", "fixtures", "claude-cli");
const workspaceRoot = "/tmp/x-builder-claude-route-workspace";

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

const readClaudeFixture = (name: string): Promise<string> =>
  readFile(join(claudeFixturesDir, name), "utf8");

const successProcessResult = (stdout: string): ProcessRunResult => ({
  status: "success",
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
  durationMs: 12,
  stdoutBytes: byteLength(stdout),
  stderrBytes: 0,
});

const fakeRunner = (
  handler: (call: CapturedRun) => ProcessRunResult | Promise<ProcessRunResult>,
): FakeProcessRunner => {
  const calls: CapturedRun[] = [];

  return {
    calls,
    run: vi.fn(async (command, args, options) => {
      const call = { command, args: [...args], options };
      calls.push(call);

      return handler(call);
    }),
  } as FakeProcessRunner;
};

const claudeJudgeService = (runner: FakeProcessRunner): JudgeDraftService =>
  new JudgeDraftService(
    new StructuredLlmService({
      providers: [new ClaudeCliProvider({ runner, workspaceRoot })],
    }),
    () => "claude-cli",
  );

describe("POST /drafts/judge with the claude provider", () => {
  it("returns a judged verdict tagged with the claude-cli model from the success envelope", async () => {
    const stdout = await readClaudeFixture("success-structured-output.json");
    const runner = fakeRunner(() => successProcessResult(stdout));
    const app = buildServer({ judgeDraftService: claudeJudgeService(runner) });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft worth judging through claude." },
      });

      expect(response.statusCode).toBe(200);
      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.model).toBe("claude-cli");
      expect(body.verdict.verdict).toBe("slight_rework");
      expect(runner.run).toHaveBeenCalledOnce();
      expect(runner.calls[0]?.command).toBe("claude");
    } finally {
      await app.close();
    }
  });

  it("maps an is_error envelope to a generic non-retryable judge_failed error", async () => {
    const stdout = await readClaudeFixture("provider-reported-error.json");
    const runner = fakeRunner(() => successProcessResult(stdout));
    const app = buildServer({ judgeDraftService: claudeJudgeService(runner) });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft the judge errors on." },
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: false });
      expect(error.message).toBe(generalizedJudgeFailedMessage);
    } finally {
      await app.close();
    }
  });

  it("judges successfully when the verdict rides a fenced json string result", async () => {
    const stdout = await readClaudeFixture("result-string-fenced.json");
    const runner = fakeRunner(() => successProcessResult(stdout));
    const app = buildServer({ judgeDraftService: claudeJudgeService(runner) });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft scored through a fenced result string." },
      });

      expect(response.statusCode).toBe(200);
      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.model).toBe("claude-cli");
      expect(body.verdict.verdict).toBe("slight_rework");
    } finally {
      await app.close();
    }
  });

  it("surfaces a retryable judge_failed 503 when the claude process keeps timing out", async () => {
    const runner = fakeRunner(() => ({
      status: "failed",
      code: "request_timeout",
      retryable: true,
      timedOut: true,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      durationMs: 12_345,
      stdoutBytes: 0,
      stderrBytes: 0,
    }));
    // attempts: 2 drives one bounded retry inside StructuredLlmService before the
    // retryable failure is returned; the judge service hands it to the route which
    // maps a retryable judge failure to 503.
    const judgeDraftService: JudgeDraftService = {
      judge: async (text: string) => {
        const result: StructuredLlmProviderResult<JudgeVerdict> =
          await new StructuredLlmService({
            providers: [new ClaudeCliProvider({ runner, workspaceRoot })],
          }).generateStructured({
            provider: "claude-cli",
            purpose: "candidate_judge",
            instructions: "Judge this draft and return structured output.",
            turns: [{ role: "user", content: text }],
            structuredOutput: {
              name: "draft_judge_verdict",
              schema: { type: "object" },
              parser: (value) => value as JudgeVerdict,
            },
            options: { attempts: 2 },
          });

        if (result.status === "failed") {
          return {
            status: "failed",
            retryable: result.retryable,
            code: result.code,
            message: result.message,
          };
        }

        throw new Error("Expected a failed result for the timeout retry test.");
      },
    } as unknown as JudgeDraftService;
    const app = buildServer({ judgeDraftService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft that keeps timing out." },
      });

      expect(response.statusCode).toBe(503);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: true });
      // Exactly one bounded retry: the runner is called twice, not once or thrice.
      expect(runner.run).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
});
