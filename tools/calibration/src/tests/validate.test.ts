import { describe, expect, it } from "vitest";

import { CalibrationRowSchema } from "../schema.js";
import { validateLeaveOneAccountOut } from "../validate.js";
import { loadRowsFixture } from "./fixture-loader.js";

type Row = ReturnType<typeof CalibrationRowSchema.parse>;

function loadTypedRows(fileName: string): Row[] {
  return loadRowsFixture(fileName).map((raw) => CalibrationRowSchema.parse(raw));
}

// ---------------------------------------------------------------------------
// AC5 — leave-one-account-out Spearman + AUC, hand-computed mechanics.
//
// RHO fixture (loao-rho-rows.jsonl): each account is a SINGLE format, so the
// held-out format's multiplier is a single positive constant and the predicted
// impressions rank == trailing_median rank (magnitude-independent). Spearman of
// the held-out account therefore reduces to Spearman(trailing_median, impressions):
//
//   acct_a (hot_take):  tm 100,200,300,400,500  ->  ranks 1,2,3,4,5
//                       imp 150,100,250,200,300  ->  ranks 2,1,4,3,5
//                       d = (1-2),(2-1),(3-4),(4-3),(5-5) = -1,1,-1,1,0
//                       sum d^2 = 1+1+1+1+0 = 4
//                       rho = 1 - 6*4 / (5*(25-1)) = 1 - 24/120 = 0.8
//   acct_b (wisdom):    tm 100,200,300,400,500  ->  ranks 1,2,3,4,5
//                       imp 150,100,200,250,300  ->  ranks 2,1,3,4,5
//                       d = -1,1,0,0,0 ; sum d^2 = 2
//                       rho = 1 - 6*2 / 120 = 1 - 12/120 = 0.9
//   meanRho = (0.8 + 0.9) / 2 = 0.85
//
// AUC fixture (loao-auc-rows.jsonl): every per-format ratio is 2.0, so every
// fold fits multiplier 2.0 (predicted = 2.0*tm). The held-out pEscape is the
// trained escape fraction of that format: hot_take = 1/3, wisdom = 2/3 in BOTH
// folds. Pooled held-out (pEscape, label) over both folds:
//   hot_take rows  (pEscape 1/3): labels F,F,T (acct_a) , F,T,F (acct_b)
//   wisdom rows    (pEscape 2/3): labels T,T,F (acct_a) , T,F,T (acct_b)
//   => positives n=6, negatives n=6.
//   Mann-Whitney AUC = P(pEscape(pos) > pEscape(neg)) with the two score levels:
//   positives at 2/3: 4 ; positives at 1/3: 2 ; negatives at 2/3: 2 ; negatives at 1/3: 4
//     pos(2/3) beats neg(1/3): 4*4 = 16 ; ties pos(2/3)=neg(2/3): 4*2 -> 0.5 each = 4
//     pos(1/3) beats neg(1/3): 0 ; ties pos(1/3)=neg(1/3): 2*4 -> 0.5 each = 4
//     pos(1/3) vs neg(2/3): loses -> 0
//   wins = 16 + 4 + 4 = 24 ; total pairs = 6*6 = 36 ; AUC = 24/36 = 2/3
// ---------------------------------------------------------------------------

describe("validateLeaveOneAccountOut reports hand-computable Spearman and AUC mechanics", () => {
  it("computes the per-held-out-account Spearman rho", () => {
    const rows = loadTypedRows("loao-rho-rows.jsonl");

    const report = validateLeaveOneAccountOut(rows);

    expect(report.rhoPerAccount.acct_a).toBeCloseTo(0.8, 10);
    expect(report.rhoPerAccount.acct_b).toBeCloseTo(0.9, 10);
  });

  it("computes meanRho as the mean of the per-account rho values", () => {
    const rows = loadTypedRows("loao-rho-rows.jsonl");

    const report = validateLeaveOneAccountOut(rows);

    expect(report.meanRho).toBeCloseTo(0.85, 10);
  });

  it("computes the pooled escape AUC via Mann-Whitney", () => {
    const rows = loadTypedRows("loao-auc-rows.jsonl");

    const report = validateLeaveOneAccountOut(rows);

    expect(report.escapeAuc).toBeCloseTo(2 / 3, 10);
  });

  it("excludes accounts with fewer than 14 days of posts from the escape fit", () => {
    // Every row here has a null escape_label (the < 14-day window case), so no
    // positives/negatives exist for the escape fit. The AUC must report null
    // (no escape pairs) rather than fabricating a value or throwing.
    const rows = loadTypedRows("loao-rho-rows.jsonl").map((row) => ({
      ...row,
      escape_label: null,
    }));

    const report = validateLeaveOneAccountOut(rows);

    expect(report.escapeAuc).toBeNull();
  });
});
