import { describe, expect, it, vi } from "vitest";

import { CalibrationRowSchema } from "../schema.js";
import { runPredictor } from "../predictor.js";
import { loadRowsFixture } from "./fixture-loader.js";

// Parse the synthetic rows fixture through the schema into typed rows.
function loadTypedRows(fileName: string): ReturnType<typeof CalibrationRowSchema.parse>[] {
  return loadRowsFixture(fileName).map((raw) => CalibrationRowSchema.parse(raw));
}

// A deterministic fake engine. runPredictor injects the engine via opts (DI),
// so the real deterministic engine is never required here — the test asserts
// the runner's plumbing: one call per row, prediction stored back on the row.
function makeFakeEngine() {
  return vi.fn((row: { text: string; trailing_median_imps: number | null }) => ({
    predictedMidImpressions: (row.trailing_median_imps ?? 0) * 2,
    escapeProbability: 0.25,
    expectedReplies: 1,
  }));
}

describe("runPredictor runs the injected engine over every row", () => {
  it("calls the injected engine exactly once per row", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    const engine = makeFakeEngine();

    runPredictor(rows, { engine });

    expect(engine).toHaveBeenCalledTimes(rows.length);
  });

  it("stores the engine prediction on each predicted row", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    const engine = makeFakeEngine();

    const predicted = runPredictor(rows, { engine });

    expect(predicted).toHaveLength(rows.length);
    const first = predicted[0];
    const firstRow = rows[0];
    expect(first).toBeDefined();
    expect(firstRow).toBeDefined();
    const expectedMid = (firstRow?.trailing_median_imps ?? 0) * 2;
    expect(first?.prediction.predictedMidImpressions).toBe(expectedMid);
  });

  it("stores the judge prediction variant when a judge is injected", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    const engine = makeFakeEngine();
    const judge = vi.fn((row: { trailing_median_imps: number | null }) => ({
      predictedMidImpressions: (row.trailing_median_imps ?? 0) * 3,
      escapeProbability: 0.4,
      expectedReplies: 2,
    }));

    const predicted = runPredictor(rows, { engine, judge });

    expect(judge).toHaveBeenCalledTimes(rows.length);
    const first = predicted[0];
    const firstRow = rows[0];
    expect(first?.judgePrediction?.predictedMidImpressions).toBe(
      (firstRow?.trailing_median_imps ?? 0) * 3,
    );
  });

  it("omits the judge variant when no judge is injected", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    const engine = makeFakeEngine();

    const predicted = runPredictor(rows, { engine });

    const first = predicted[0];
    // Guard against a vacuous pass on an undefined row: the row exists and
    // carries a deterministic prediction, but no judge variant.
    expect(first?.prediction).toBeDefined();
    expect(first?.judgePrediction).toBeUndefined();
  });
});
