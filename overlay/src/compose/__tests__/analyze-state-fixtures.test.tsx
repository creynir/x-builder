// @x-builder/overlay — AnalyzeState fixture-validity test
//
// These fixtures (`overlay/src/testing/analyze-state.ts`) feed the
// StaticEngineColumn suite. The whole value of those tests rests on the fixtures
// being VALID instances of the real shared schema — an informal fixture (the old
// `score:{value:72}` / `postCoach:{flagged:[…]}` string-array / tuple-range
// shape) would render fine in a presentational test yet never parse, so the
// suite would be silently testing a shape the engine never emits.
//
// This test re-parses each fixture variant against the real
// `analyzedPostItemSchema` / `engagementPredictionSchema`. It depends ONLY on the
// fixtures + the shipped schema — NOT on the unbuilt `StaticEngineColumn` /
// `ScoreBar` impl — so it PASSES immediately and pins the fixtures to the schema
// forever after.

import { describe, expect, it } from "vitest";

import {
  analyzedPostItemSchema,
  engagementPredictionSchema,
} from "@x-builder/shared";

import {
  failedState,
  missingFollowersPrediction,
  missingFollowersResult,
  readyResult,
  scoringState,
} from "../../testing/analyze-state";

describe("AnalyzeState fixtures — schema validity", () => {
  it("readyResult parses as a scored AnalyzedPostItem", () => {
    const parsed = analyzedPostItemSchema.parse(readyResult);
    expect(parsed.status).toBe("scored");
  });

  it("readyResult.prediction parses as an available EngagementPrediction", () => {
    const parsed = engagementPredictionSchema.parse(readyResult.prediction);
    expect(parsed.status).toBe("available");
  });

  it("readyResult.postCoach is the ready discriminated variant with object-form check lists", () => {
    // Guard against the old wrong shape: the lists must be VoiceCheck objects,
    // never string arrays, and the union tag must be "ready".
    if (readyResult.postCoach.state !== "ready") {
      throw new Error("readyResult.postCoach must be the ready variant.");
    }
    const coach = readyResult.postCoach;
    expect(coach.failed.every((c) => typeof c === "object" && "status" in c)).toBe(true);
    expect(coach.warned.every((c) => typeof c === "object" && "status" in c)).toBe(true);
    expect(coach.passed.every((c) => typeof c === "object" && "status" in c)).toBe(true);
    expect(coach.failed[0]?.status).toBe("fail");
    expect(coach.warned[0]?.status).toBe("warn");
    expect(coach.passed[0]?.status).toBe("pass");
  });

  it("readyResult.prediction reach ranges are {low,high} objects, not tuples, with no midpoint", () => {
    if (readyResult.prediction.status !== "available") {
      throw new Error("readyResult.prediction must be available.");
    }
    const prediction = readyResult.prediction;
    expect(prediction.stallRange).toEqual({ low: 120, high: 276 });
    expect(prediction.escapeRange).toEqual({ low: 570, high: 2280 });
    expect(Array.isArray(prediction.stallRange)).toBe(false);
    expect(prediction).not.toHaveProperty("midpoint");
    expect(typeof prediction.predictedMidImpressions).toBe("number");
  });

  it("readyResult.cooldown parses (warming) as part of the scored item", () => {
    const parsed = analyzedPostItemSchema.parse(readyResult);
    if (parsed.status !== "scored") throw new Error("Expected scored item.");
    expect(parsed.cooldown?.status).toBe("warming");
  });

  it("missingFollowersResult parses with a disabled missing-followers prediction", () => {
    const parsed = analyzedPostItemSchema.parse(missingFollowersResult);
    expect(parsed.status).toBe("scored");
    if (parsed.status !== "scored") throw new Error("Expected scored item.");
    expect(parsed.prediction.status).toBe("disabled");
  });

  it("missingFollowersPrediction parses as a disabled EngagementPrediction with a non-empty message", () => {
    const parsed = engagementPredictionSchema.parse(missingFollowersPrediction);
    expect(parsed.status).toBe("disabled");
    if (parsed.status !== "disabled") throw new Error("Expected disabled prediction.");
    expect(parsed.reason).toBe("missing_followers");
    expect(parsed.message.length).toBeGreaterThan(0);
  });

  it("scoring and failed states carry their discriminated status with no result payload", () => {
    expect(scoringState).toEqual({ status: "scoring" });
    expect(failedState).toEqual({ status: "failed", error: "analyze_failed" });
  });
});
