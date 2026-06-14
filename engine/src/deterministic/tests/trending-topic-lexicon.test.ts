import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  trendingTopicAsOf,
  trendingTopicBonusPerMatch,
  trendingTopicMaxBonus,
  trendingTopicTerms,
} from "../trending-topic-lexicon";

const lexiconSourcePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "trending-topic-lexicon.ts",
);

// The trending-topic lexicon is a calibrated, time-bounded list: its terms go
// stale, so the module carries an explicit "as of" date and per-match / cap
// bonus constants. These describe the lexicon contract; the reach effects are
// pinned in the computeReachModel suite.

describe("trendingTopicLexicon", () => {
  it("publishes a non-empty YYYY-MM-DD calibration date", () => {
    expect(typeof trendingTopicAsOf).toBe("string");
    expect(trendingTopicAsOf.length).toBeGreaterThan(0);
    expect(trendingTopicAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(trendingTopicAsOf))).toBe(false);
  });

  it("lists the current model/agent vocabulary as trending terms", () => {
    for (const term of ["claude", "codex", "gpt", "gemini", "agent", "agents"]) {
      expect(trendingTopicTerms).toContain(term);
    }
  });

  it("exposes the per-match bonus and the cap as calibrated constants", () => {
    expect(trendingTopicBonusPerMatch).toBe(0.15);
    expect(trendingTopicMaxBonus).toBe(0.4);
  });

  // Static policy: the source must flag that these terms expire, so the date is
  // treated as a calibration deadline rather than a fixed constant.
  it("flags in source that the trending entries expire and must be reviewed", () => {
    const source = readFileSync(lexiconSourcePath, "utf8");

    expect(source).toMatch(/CALIBRATE[\s\S]*entries EXPIRE/i);
  });
});
