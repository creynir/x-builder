import { describe, expect, it, vi } from "vitest";

import { CalibrationRowSchema } from "../schema.js";
import { fitReachConstants } from "../fit.js";
import { loadRowsFixture } from "./fixture-loader.js";

type Row = ReturnType<typeof CalibrationRowSchema.parse>;

function loadTypedRows(fileName: string): Row[] {
  return loadRowsFixture(fileName).map((raw) => CalibrationRowSchema.parse(raw));
}

// ---------------------------------------------------------------------------
// Planted values in bimodal-rows.jsonl (hand-computed; arithmetic in the
// Test Intent Matrix). Each format has a STALL cluster + a SEPARATE escape
// cluster (bimodal — not a Gaussian around a midpoint).
//
//   hot_take          ratios {0.5,1.0,2.0,6.0,9.0} -> geom-median(1-D)=median=2.0
//                     escapes (ratio>3): 6,9 -> 2/5 = 0.4
//                     reply/imp {0.01,0.02,0.03,0.04,0.05} -> median 0.03
//   wisdom_one_liner  ratios {0.8,1.0,1.5,5.0,8.0} -> median=1.5
//                     escapes: 5,8 -> 2/5 = 0.4 ; reply/imp median 0.006
//   story             ratios {0.4,0.7,1.0,4.0,7.0} -> median=1.0
//                     escapes: 4,7 -> 2/5 = 0.4 ; reply/imp median 0.004
// ---------------------------------------------------------------------------

describe("fitReachConstants aggregates per-format constants from the bimodal corpus", () => {
  it("refits the format multiplier to the geometric median of the planted ratios", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");

    const constants = fitReachConstants(rows);

    expect(constants.formatReachTable.hot_take?.p50Multiplier).toBeCloseTo(2.0, 10);
    expect(constants.formatReachTable.wisdom_one_liner?.p50Multiplier).toBeCloseTo(1.5, 10);
    expect(constants.formatReachTable.story?.p50Multiplier).toBeCloseTo(1.0, 10);
  });

  it("refits escapeProbability to the empirical planted escape fraction", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");

    const constants = fitReachConstants(rows);

    expect(constants.formatReachTable.hot_take?.escapeProbability).toBeCloseTo(0.4, 10);
    expect(constants.formatReachTable.wisdom_one_liner?.escapeProbability).toBeCloseTo(0.4, 10);
    expect(constants.formatReachTable.story?.escapeProbability).toBeCloseTo(0.4, 10);
  });

  it("refits the reply rate to the median of replies/impressions per format", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");

    const constants = fitReachConstants(rows);

    expect(constants.replyRateTable.hot_take).toBeCloseTo(0.03, 10);
    expect(constants.replyRateTable.wisdom_one_liner).toBeCloseTo(0.006, 10);
    expect(constants.replyRateTable.story).toBeCloseTo(0.004, 10);
  });

  it("excludes null-median rows from the multiplier fit", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    const firstHot = rows.find((r) => r.detected_format === "hot_take");
    if (firstHot === undefined) {
      throw new Error("fixture precondition: expected a hot_take row");
    }
    // A null-trailing-median row carries no ratio; including it would shift the
    // geometric median off 2.0. The fit must drop it and stay at 2.0.
    const polluted: Row[] = [
      ...rows,
      { ...firstHot, postId: "nullmed", trailing_median_imps: null, escape_label: null },
    ];

    const constants = fitReachConstants(polluted);

    expect(constants.formatReachTable.hot_take?.p50Multiplier).toBeCloseTo(2.0, 10);
  });

  it("excludes has_external_link null rows from the link-penalty fit", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    const linkRow = rows.find((r) => r.detected_format === "hot_take");
    if (linkRow === undefined) {
      throw new Error("fixture precondition: expected a hot_take row");
    }
    const withTcoAmbiguous: Row[] = [
      ...rows,
      { ...linkRow, postId: "tco_ambig", has_external_link: null },
    ];

    const constants = fitReachConstants(withTcoAmbiguous);
    const baseline = fitReachConstants(rows);

    // Guard against a vacuous undefined === undefined pass: the link penalty
    // must be a real fitted number...
    expect(typeof baseline.linkPenalty).toBe("number");
    // ...and the t.co-ambiguous row (has_external_link === null) must not move
    // it — the link-penalty fit excludes null-link rows.
    expect(constants.linkPenalty).toBe(baseline.linkPenalty);
  });

  it("leaves a zero-row format placeholder unchanged and logs that it was not refit", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");
    // The corpus contains no `cta_farm` rows.
    expect(rows.some((r) => r.detected_format === "cta_farm")).toBe(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const constants = fitReachConstants(rows);

    const ctaFarm = constants.formatReachTable.cta_farm;
    expect(ctaFarm).toBeDefined();
    // Placeholder from the live reach table (3.0) must survive untouched — no
    // silent zero — and the skip must be logged.
    expect(ctaFarm?.p50Multiplier).toBe(3.0);
    const loggedCtaFarm = warn.mock.calls.some((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("cta_farm")),
    );
    expect(loggedCtaFarm).toBe(true);
    warn.mockRestore();
  });

  it("does not throw on an empty corpus", () => {
    const constants = fitReachConstants([]);

    // Empty corpus refits nothing; placeholders remain intact.
    expect(constants.formatReachTable.hot_take?.p50Multiplier).toBe(1.1);
  });
});

describe("fitReachConstants emits a generated constants file with a dated, sized header", () => {
  it("includes the fit date and corpus size in the file header comment", () => {
    const rows = loadTypedRows("bimodal-rows.jsonl");

    const constants = fitReachConstants(rows);

    const header = constants.fileContents;
    expect(typeof header).toBe("string");
    // The header carries the corpus row count...
    expect(header).toContain(String(rows.length));
    // ...and the fit date (ISO yyyy-mm-dd).
    expect(header).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
