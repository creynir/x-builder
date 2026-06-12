import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema, judgeDraftResponseSchema } from "@x-builder/shared";

import { CursorCliProvider } from "../../llm/cursor-cli-provider";
import { JudgeDraftService } from "../../llm/judge-draft-service";
import { StructuredLlmService } from "../../llm/structured-llm-service";
import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner,
} from "../../llm/process-runner";
import { buildServer } from "../server";

const generalizedJudgeFailedMessage = "The judge could not score this draft. Try again.";

const testDir = dirname(fileURLToPath(import.meta.url));
const cursorFixturesDir = join(testDir, "..", "..", "llm", "tests", "fixtures", "cursor-cli");
const workspaceRoot = "/tmp/x-builder-cursor-route-workspace";

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

const readCursorFixture = (name: string): Promise<string> =>
  readFile(join(cursorFixturesDir, name), "utf8");

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

const cursorJudgeService = (runner: FakeProcessRunner): JudgeDraftService =>
  new JudgeDraftService(
    new StructuredLlmService({
      providers: [new CursorCliProvider({ runner, workspaceRoot })],
    }),
    () => "cursor-cli",
  );

describe("POST /drafts/judge with the cursor provider", () => {
  it("returns a judged verdict tagged with the cursor-cli model from the JSON-string result envelope", async () => {
    const stdout = await readCursorFixture("judge-success-result-string.json");
    const runner = fakeRunner(() => successProcessResult(stdout));
    const app = buildServer({ judgeDraftService: cursorJudgeService(runner) });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft worth judging through cursor." },
      });

      expect(response.statusCode).toBe(200);
      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.model).toBe("cursor-cli");
      expect(body.verdict.verdict).toBe("slight_rework");
      expect(runner.run).toHaveBeenCalledOnce();
      expect(runner.calls[0]?.command).toBe("cursor-agent");
      // The hang-guarding empty stdin rides through the full route path.
      expect(runner.calls[0]?.options.stdin).toBe("");
    } finally {
      await app.close();
    }
  });

  it("judges successfully when the verdict rides as prose-wrapped JSON via the last-balanced-object scan", async () => {
    const judgeVerdict = {
      scores: {
        overall: 82,
        replies: 84,
        profileClicks: 76,
        impressions: 68,
        bookmarkValue: 63,
        dwellProxy: 73,
        voiceMatch: 88,
        negativeRisk: 9,
      },
      confidence: "high",
      headline: "Concrete hook, soft landing.",
      strengths: ["Specific proof beats generic claims."],
      improvements: ["Cut the closing question."],
    };
    const proseWrapped = [
      "Here is my assessment of the draft you shared.",
      "I weighed the hook, the evidence, and the closing line before scoring it.",
      JSON.stringify(judgeVerdict),
      "Let me know if you want a tighter rewrite of the opening sentence.",
    ].join("\n");
    const runner = fakeRunner(() => successProcessResult(proseWrapped));
    const app = buildServer({ judgeDraftService: cursorJudgeService(runner) });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft scored through a prose-wrapped result." },
      });

      expect(response.statusCode).toBe(200);
      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.model).toBe("cursor-cli");
      expect(body.verdict.verdict).toBe("slight_rework");
    } finally {
      await app.close();
    }
  });

  it("maps output with no JSON anywhere to a generic non-retryable judge_failed error", async () => {
    const stdout = await readCursorFixture("no-json-output.txt");
    const runner = fakeRunner(() => successProcessResult(stdout));
    const app = buildServer({ judgeDraftService: cursorJudgeService(runner) });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft the judge returns no JSON for." },
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: false });
      expect(error.message).toBe(generalizedJudgeFailedMessage);
    } finally {
      await app.close();
    }
  });
});
