import type { CalibrationRow } from "./schema.js";

// The engine is INJECTED (dependency inversion): runPredictor never imports the
// real deterministic engine. A caller supplies an `engine` function mapping a
// row to its prediction; the bin script wires the real `analyzeDraftText`, the
// tests wire a deterministic fake. An optional `judge` function produces the
// judged-quality prediction variant for the same row.
export type RowEngine<P> = (row: CalibrationRow) => P;

export type PredictorOptions<P> = {
  engine: RowEngine<P>;
  judge?: RowEngine<P>;
};

export type PredictedRow<P> = CalibrationRow & {
  prediction: P;
  judgePrediction?: P;
};

/**
 * Run the injected engine over every row, storing each prediction back on a
 * predicted row. When a judge is injected, also store the judged variant. The
 * engine is called exactly once per row (and the judge, when present, once per
 * row).
 */
export function runPredictor<P>(
  rows: CalibrationRow[],
  opts: PredictorOptions<P>,
): PredictedRow<P>[] {
  return rows.map((row) => {
    const prediction = opts.engine(row);
    if (opts.judge === undefined) {
      return { ...row, prediction };
    }
    return { ...row, prediction, judgePrediction: opts.judge(row) };
  });
}
