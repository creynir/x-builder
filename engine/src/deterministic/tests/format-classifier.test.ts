import { describe, expect, it } from "vitest";

import { classifyPostFormat } from "../format-classifier";
import type { PostFormat } from "../types";

// Each row maps a draft string to the format member the corrected first-match-wins
// cascade must select for it. The table doubles as living documentation of the
// cascade order: rows are grouped by the cascade step that should claim them, and
// every member (plus the headline regression and edge cases) appears at least once.
type CorpusExample = {
  name: string;
  text: string;
  expected: PostFormat;
};

const corpusExamples: readonly CorpusExample[] = [
  // 1. hot_take — explicit opinion prefixes.
  {
    name: "hot take prefix",
    text: "hot take: most dashboards are just procrastination with extra steps",
    expected: "hot_take",
  },
  {
    name: "unpopular opinion prefix",
    text: "unpopular opinion: standups are a status meeting in a trench coat",
    expected: "hot_take",
  },

  // 2. genuine_question (prefix) — explicit question prefix wins over the fallback.
  {
    name: "genuine question prefix",
    text: "genuine question: why do agents fail at handoffs?",
    expected: "genuine_question",
  },

  // 3. fill_blank_tribal — parallel "X has Y" lines with an incomplete final line.
  {
    name: "tribal fill-in-the-blank with trailing question",
    text: ["USA has ChatGPT", "China has DeepSeek", "Europe has?"].join("\n"),
    expected: "fill_blank_tribal",
  },
  {
    name: "tribal fill-in-the-blank with trailing ellipsis",
    text: ["Stripe is for payments", "Vercel is for hosting", "Your startup is for…"].join("\n"),
    expected: "fill_blank_tribal",
  },

  // 4. cta_farm — imperative + object, or a reciprocity offer.
  {
    name: "drop your startup link (headline regression: was one_liner)",
    text: "drop your startup link",
    expected: "cta_farm",
  },
  {
    name: "pitch me your company in one word",
    text: "pitch me your company in 1 word",
    expected: "cta_farm",
  },
  {
    name: "show me your homepage",
    text: "show me your homepage and I'll roast it",
    expected: "cta_farm",
  },
  {
    name: "reciprocity offer with no possessive object",
    text: "comment below and I'll rate your landing page out of 10",
    expected: "cta_farm",
  },

  // 5. fantasy_question — second-person hypothetical with a concrete stake.
  {
    name: "windfall hypothetical",
    text: "You just sold your company for $100M. What's the first thing you do?",
    expected: "fantasy_question",
  },
  {
    name: "hypothetical-multi-clause resolves fantasy before nuanced",
    text: "You just raised $5M. Do you hire fast, or stay lean and ship it yourself?",
    expected: "fantasy_question",
  },

  // 6. binary_choice — short "X or Y?" framing, distinct from a bulleted A/B list.
  {
    name: "two-option inline question",
    text: "Codex or Claude Code?",
    expected: "binary_choice",
  },

  // 7. audience_question — tribe vocative plus a quick question.
  {
    name: "founder vocative question",
    text: "Founders, what's the one metric you check first thing every morning?",
    expected: "audience_question",
  },

  // 8. connect — pure "let's connect" with no CTA object.
  {
    name: "pure connect invite",
    text: "Always glad to meet other indie builders here. Let's connect.",
    expected: "connect",
  },

  // 9. recognition_roast — observational humor about a recognizable subject, no advice.
  {
    name: "second-person roast",
    text: "we all know that one founder who pivots every time the market so much as sneezes",
    expected: "recognition_roast",
  },

  // 10. milestone — first person + number + (milestone noun OR goal phrase).
  {
    name: "numeric milestone",
    text: "I hit 10k followers in 73 days",
    expected: "milestone",
  },
  {
    name: "goal phrase milestone (rewritten from the legacy goal_share assertion)",
    text: "My goal is to ship 3 experiments by end of June",
    expected: "milestone",
  },

  // 11. story — three or more visible lines in first person.
  {
    name: "first-person multi-line story",
    text: [
      "I shipped a 14 day onboarding test last month.",
      "We removed workspace invites from the first run.",
      "New teams reached one useful result before admin setup, and activation climbed.",
    ].join("\n"),
    expected: "story",
  },

  // 12. ab_choice — bulleted list, no inline "X or Y?" question.
  {
    name: "bulleted A/B list",
    text: ["Best stack for a solo founder:", "- Next.js + Postgres", "- Rails + SQLite"].join("\n"),
    expected: "ab_choice",
  },

  // 13. nuanced_question — multi-clause / self-incriminating question.
  {
    name: "self-incriminating multi-clause question",
    text: "be honest, do you actually ship on weekends, or just tweet about it?",
    expected: "nuanced_question",
  },

  // 14. genuine_question (fallback) — easy single-clause question.
  {
    name: "plain single-clause question",
    text: "What's your stack?",
    expected: "genuine_question",
  },

  // 15. wisdom_one_liner — single advice/truth line (absorbs old one_liner advice).
  {
    name: "advice one-liner with no question or story",
    text: "Ship the uncomfortable version",
    expected: "wisdom_one_liner",
  },

  // 16. insight_share — multi-line statement that matches nothing earlier.
  {
    name: "multi-line observation fallback",
    text: ["The best onboarding flows feel invisible.", "Good defaults beat good tutorials."].join(
      "\n",
    ),
    expected: "insight_share",
  },

  // 17. other — empty input.
  {
    name: "empty input",
    text: "",
    expected: "other",
  },
];

describe("format classifier corrected cascade", () => {
  it.each(corpusExamples)(
    "classifies $name as $expected",
    ({ text, expected }) => {
      expect(classifyPostFormat(text)).toBe(expected);
    },
  );

  it("classifies a blank-only draft as other", () => {
    expect(classifyPostFormat("   \n  \t ")).toBe("other");
  });

  it("treats a bulleted A/B list as ab_choice rather than binary_choice", () => {
    const result = classifyPostFormat(
      ["Pineapple on pizza:", "- absolutely yes", "- never again"].join("\n"),
    );

    expect(result).toBe("ab_choice");
    expect(result).not.toBe("binary_choice");
  });

  it("resolves a hypothetical multi-clause question as fantasy_question before nuanced_question", () => {
    const result = classifyPostFormat(
      "You just inherited $250k. Do you reinvest it, or finally take the sabbatical?",
    );

    expect(result).toBe("fantasy_question");
    expect(result).not.toBe("nuanced_question");
  });

  it("never returns the deleted one_liner or goal_share members for any corpus draft", () => {
    const deleted = new Set(["one_liner", "goal_share"]);

    for (const { text } of corpusExamples) {
      expect(deleted.has(classifyPostFormat(text))).toBe(false);
    }
  });
});
