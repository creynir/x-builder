import {
  analyzePostsResponseSchema,
  detectedPostFormatSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type DetectedPostFormat,
} from "@x-builder/shared";
import { describe, expect, it } from "vitest";

import { buildServer } from "../server";

// End-to-end classifier corpus over the REAL /posts/analyze route: each spec
// example string is analyzed through Fastify `inject` -> the real
// DeterministicAnalysisService -> the real classifyPostFormat cascade, and the
// `detectedFormat` on the parsed wire response must be the named PostFormat
// member. The named spec strings are the corpus rows the classifier owns; this
// suite asserts they map to their member THROUGH the route response (not just at
// the classifier unit boundary, which the format-classifier unit suite already
// covers). The only thing exercised is the real engine — no LLM, no stub.

const parseJson = (payload: string): unknown => JSON.parse(payload);

const parseAnalyze = (payload: string): AnalyzePostsResponse =>
  analyzePostsResponseSchema.parse(parseJson(payload));

const analyzePayload = (text: string): AnalyzePostsRequest => ({
  items: [
    {
      id: "candidate-1",
      text,
    },
  ],
  scoringContext: {},
  presentation: {
    postCoachMode: "preview",
  },
});

const expectScored = (
  item: AnalyzedPostItem | undefined,
): Extract<AnalyzedPostItem, { status: "scored" }> => {
  if (!item || item.status !== "scored") {
    throw new Error("Expected a scored deterministic analysis item.");
  }

  return item;
};

// Analyze one draft end-to-end through the real route and return the parsed
// (asserted-200) response.
const analyzeDraft = async (text: string): Promise<AnalyzePostsResponse> => {
  const app = buildServer();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/posts/analyze",
      payload: analyzePayload(text),
    });

    expect(response.statusCode).toBe(200);

    return parseAnalyze(response.body);
  } finally {
    await app.close();
  }
};

// Spec example strings pulled from the classifier cascade, each paired with the
// named PostFormat member its cascade step must select. The two headline rows the
// epic calls out by name — "drop your startup link" -> cta_farm and
// "Codex or Claude Code?" -> binary_choice — lead the table; the remaining named
// examples cover the other cascade members so the corpus rides the full route.
type CorpusRow = {
  name: string;
  text: string;
  expected: DetectedPostFormat;
};

const corpus: readonly CorpusRow[] = [
  { name: "cta imperative", text: "drop your startup link", expected: "cta_farm" },
  { name: "two-option inline question", text: "Codex or Claude Code?", expected: "binary_choice" },
  {
    name: "hot take prefix",
    text: "hot take: most dashboards are just procrastination with extra steps",
    expected: "hot_take",
  },
  {
    name: "genuine question prefix",
    text: "genuine question: why do agents fail at handoffs?",
    expected: "genuine_question",
  },
  {
    name: "tribal fill-in-the-blank",
    text: ["USA has ChatGPT", "China has DeepSeek", "Europe has?"].join("\n"),
    expected: "fill_blank_tribal",
  },
  {
    name: "windfall hypothetical",
    text: "You just sold your company for $100M. What's the first thing you do?",
    expected: "fantasy_question",
  },
  {
    name: "founder vocative question",
    text: "Founders, what's the one metric you check first thing every morning?",
    expected: "audience_question",
  },
  {
    name: "pure connect invite",
    text: "Always glad to meet other indie builders here. Let's connect.",
    expected: "connect",
  },
  {
    name: "second-person roast",
    text: "we all know that one founder who pivots every time the market so much as sneezes",
    expected: "recognition_roast",
  },
  {
    name: "numeric milestone",
    text: "I hit 10k followers in 73 days",
    expected: "milestone",
  },
  {
    name: "bulleted A/B list",
    text: ["Best stack for a solo founder:", "- Next.js + Postgres", "- Rails + SQLite"].join("\n"),
    expected: "ab_choice",
  },
  {
    name: "self-incriminating multi-clause question",
    text: "be honest, do you actually ship on weekends, or just tweet about it?",
    expected: "nuanced_question",
  },
  {
    name: "plain single-clause question",
    text: "What's your stack?",
    expected: "genuine_question",
  },
  {
    name: "advice one-liner",
    text: "Ship the uncomfortable version",
    expected: "wisdom_one_liner",
  },
];

describe("classifier corpus through the real /posts/analyze route", () => {
  it.each(corpus)(
    "analyzes $name end-to-end and reports detectedFormat $expected on the wire",
    async ({ text, expected }) => {
      const result = await analyzeDraft(text);
      const item = expectScored(result.items[0]);

      expect(item.detectedFormat).toBe(expected);
    },
  );

  // The two headline rows the epic names explicitly, asserted in isolation so a
  // regression on either is unambiguous in the report.
  it("maps the cta headline string to cta_farm through the route response", async () => {
    const result = await analyzeDraft("drop your startup link");

    expect(expectScored(result.items[0]).detectedFormat).toBe("cta_farm");
  });

  it("maps the binary-choice headline string to binary_choice through the route response", async () => {
    const result = await analyzeDraft("Codex or Claude Code?");

    expect(expectScored(result.items[0]).detectedFormat).toBe("binary_choice");
  });

  // The classifier never emits the deleted members for any corpus draft, observed
  // through the route response (the unit-level "never emits" guard is already
  // covered by the format-classifier suite; this asserts the same over the wire).
  it("never reports a deleted one_liner or goal_share detectedFormat for any corpus draft", async () => {
    const deleted = new Set<string>(["one_liner", "goal_share"]);

    for (const { text } of corpus) {
      const result = await analyzeDraft(text);
      expect(deleted.has(expectScored(result.items[0]).detectedFormat)).toBe(false);
    }
  });
});

// one_liner / goal_share are rejected AT THE ROUTE BOUNDARY. The shared unit
// suite already proves detectedPostFormatSchema rejects both members
// (deterministic-analyze.test.ts), and the format-classifier suite proves the
// cascade never emits them. The NEW assertion here is the END-TO-END path: a
// /posts/analyze RESPONSE carrying detectedFormat:"one_liner" is rejected by the
// route's response-contract guard before it can reach the wire as a 200 — so a
// re-added legacy member could not leak through analyze even if a service
// re-emitted it.
type AnalyzePostsFake = (request: AnalyzePostsRequest) => unknown;

type BuildServerAnalyzeOptions = Parameters<typeof buildServer>[0] & {
  analyzePosts?: AnalyzePostsFake;
};

describe("deleted detected-format members rejected at the analyze route boundary", () => {
  // Sanity: the shared schema rejects the deleted members. This pins the contract
  // the route's response guard relies on (cited from the shared unit suite; kept
  // here as the load-bearing precondition for the route-level assertion below).
  it("rejects one_liner and goal_share at the shared detected-format schema", () => {
    expect(detectedPostFormatSchema.safeParse("one_liner").success).toBe(false);
    expect(detectedPostFormatSchema.safeParse("goal_share").success).toBe(false);
  });

  it("does not emit a 200 when the service re-emits a deleted detectedFormat member", async () => {
    const reEmitDeletedFormat: AnalyzePostsFake = (request) => ({
      items: request.items.map((item) => ({
        status: "scored",
        id: item.id,
        text: item.text,
        sourceFormat: item.sourceFormat,
        // The deleted member forced back onto the scored item: the response
        // contract guard must reject this before it reaches the wire.
        detectedFormat: "one_liner",
        score: {
          value: 50,
          checks: [],
          learnings: [],
          engageability: { engageable: true, reason: "Ends with a question." },
        },
        postCoach: {
          state: "ready",
          title: "Post Coach",
          value: 50,
          badge: { label: "Ship it", tone: "ship", tooltip: "Solid post. Ship it." },
          target: 60,
          engageability: { engageable: true, reason: "Ends with a question." },
          failed: [],
          warned: [],
          passed: [],
          counts: { flagged: 0, nudges: 0, onPoint: 0 },
          expanded: false,
          previewMode: true,
          sections: [],
          learnings: [],
          learningCaveat: "Static rule check.",
          hiddenChecks: 0,
          helperText: "Signals, not verdicts.",
          footerText: "Static heuristic checks only.",
        },
        prediction: {
          status: "disabled",
          reason: "missing_followers",
          message: "Prediction needs follower count.",
        },
        heuristicLabel: "Heuristic rank, not prediction.",
        analyzedAt: "2026-06-07T12:00:00.000Z",
        analyzerVersion: "deterministic-v1",
      })),
    });

    const app = buildServer({ analyzePosts: reEmitDeletedFormat } as BuildServerAnalyzeOptions);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: analyzePayload("a draft the service mislabels with a deleted member"),
      });

      // The contract guard rejects the deleted member: this is NOT a clean 200,
      // and the deleted token never reaches the wire as a valid detectedFormat.
      expect(response.statusCode).not.toBe(200);
      expect(response.statusCode).toBeGreaterThanOrEqual(500);
      expect(() => parseAnalyze(response.body)).toThrow();
    } finally {
      await app.close();
    }
  });
});
