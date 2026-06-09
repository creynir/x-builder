import { describe, expect, it } from "vitest";

import { evaluateDraftVoice } from "../voice-score";
import type { VoiceCheck } from "../voice-check";
import {
  bannedClaimPattern,
  enrichedTextCheckIds,
  findCheck,
} from "./test-helpers";

function scoreValueFromReturnedChecks(checks: readonly VoiceCheck[]): number {
  const nonQualityChecks = checks.filter((check) => check.kind !== "quality");
  const qualityChecks = checks.filter((check) => check.kind === "quality");
  const nonQualityPoints = nonQualityChecks.reduce((sum, check) => {
    if (check.status === "pass") {
      return sum + 1;
    }

    if (check.status === "warn") {
      return sum + 0.5;
    }

    return sum;
  }, 0);
  const nonQualityScore =
    nonQualityChecks.length === 0
      ? 100
      : Math.round((nonQualityPoints / nonQualityChecks.length) * 100);
  const qualityPasses = qualityChecks.filter((check) => check.status === "pass").length;
  const qualityScore =
    qualityChecks.length === 0
      ? 100
      : Math.round(40 + (qualityPasses / qualityChecks.length) * 60);

  return Math.min(nonQualityScore, qualityScore);
}

describe("voice-score", () => {
  it("exposes quality signal checks through the canonical score", () => {
    const score = evaluateDraftVoice(
      [
        "Builders, I shipped a 14 day onboarding test and learned one thing:",
        "",
        "Specific setup screens beat clever copy when users need to finish their first run.",
        "",
        "Which setup step would you remove first: profile import or workspace invite?",
      ].join("\n"),
    );

    expect(score.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([...enrichedTextCheckIds]),
    );

    for (const id of enrichedTextCheckIds) {
      expect(Object.keys(findCheck(score.checks, id)).sort()).toEqual(
        expect.arrayContaining(["id", "kind", "label", "status"]),
      );
    }
  });

  it("keeps quality labels in writing language without ranking or data claims", () => {
    const texts = [
      "This changed everything. Nobody talks about this enough.",
      "Everyone should always remove friction because it is the only way to grow.",
      "I wrote the full teardown here: https://example.com/onboarding",
      "Thanks @maya @lee @sam for the launch notes and signup teardown.",
      "Builders, I shipped a 14 day onboarding test. Which setup step would you remove first?",
    ];
    const labels = texts.flatMap((text) =>
      evaluateDraftVoice(text).checks
        .filter((check) => enrichedTextCheckIds.includes(check.id as (typeof enrichedTextCheckIds)[number]))
        .map((check) => check.label),
    );

    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toEqual(
      expect.arrayContaining([expect.stringMatching(bannedClaimPattern)]),
    );
  });

  it("supports disabled checks and injected variety checks", () => {
    const varietyCheck: VoiceCheck = {
      id: "variety_recent_format",
      label: "Recent format variety",
      status: "warn",
    };
    const score = evaluateDraftVoice("Hot take: specific beats clever every time", {
      enabled: {
        hashtags: false,
      },
      varietyCheck,
    });

    expect(score.checks.some((check) => check.id === "hashtags")).toBe(false);
    expect(score.checks).toEqual(expect.arrayContaining([varietyCheck]));
  });

  it("keeps the public score explainable from returned checks when variety is injected", () => {
    const text = [
      "This changed everything. What should we ship? Why now? Should pricing change? Who owns docs?",
      "",
      "Also read https://example.com/a and https://example.com/b",
      "",
      "Thanks @maya @lee @sam @jo",
    ].join("\n");
    const varietyCheck: VoiceCheck = {
      id: "variety_recent_format",
      label: "Recent format variety",
      status: "pass",
    };
    const scoreWithoutVariety = evaluateDraftVoice(text);
    const scoreWithVariety = evaluateDraftVoice(text, { varietyCheck });

    expect(scoreWithoutVariety.value).toBe(scoreValueFromReturnedChecks(scoreWithoutVariety.checks));
    expect(scoreWithVariety.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["variety_recent_format", ...enrichedTextCheckIds]),
    );
    expect(scoreWithVariety.value).toBe(scoreValueFromReturnedChecks(scoreWithVariety.checks));
    expect(scoreWithVariety.value).toBe(scoreWithoutVariety.value);
  });
});
