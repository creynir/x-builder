import { fitReachConstants } from "./fit.js";
import type { FormatReachWeights } from "./fit.js";
import type { CalibrationRow } from "./schema.js";

export type ValidationReport = {
  rhoPerAccount: Record<string, number>;
  meanRho: number;
  escapeAuc: number | null;
};

// Average (fractional) ranks. Tied values share the mean of the ranks they
// span, so Spearman computed as Pearson over these ranks is correct under ties.
function rankTransform(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]?.value === indexed[i]?.value) {
      j += 1;
    }
    // Ranks are 1-based; tied block [i..j] shares the mean rank.
    const meanRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) {
      const entry = indexed[k];
      if (entry !== undefined) {
        ranks[entry.index] = meanRank;
      }
    }
    i = j + 1;
  }
  return ranks;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) {
    return 0;
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i] ?? 0;
    sumY += ys[i] ?? 0;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) {
    return 0;
  }
  return cov / Math.sqrt(varX * varY);
}

// Spearman rank correlation = Pearson over rank-transformed inputs. Hand-rolled
// (no stats library): rank-transform both series, then Pearson.
function spearman(xs: number[], ys: number[]): number {
  return pearson(rankTransform(xs), rankTransform(ys));
}

// Mann-Whitney AUC with ½-credit for ties: P(score(pos) > score(neg)), counting
// each tie as half a win. Hand-rolled pair comparison (no stats library).
function mannWhitneyAuc(positives: number[], negatives: number[]): number | null {
  if (positives.length === 0 || negatives.length === 0) {
    return null;
  }
  let wins = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos > neg) {
        wins += 1;
      } else if (pos === neg) {
        wins += 0.5;
      }
    }
  }
  return wins / (positives.length * negatives.length);
}

// Look up a fitted format's weights by its (string) detected_format without an
// unsafe cast: the reach table is iterated as entries, so an arbitrary string
// key resolves to the matching weights or undefined.
function fittedWeights(
  constants: { formatReachTable: Record<string, FormatReachWeights> },
  format: string,
): FormatReachWeights | undefined {
  return constants.formatReachTable[format];
}

function uniqueAccounts(rows: CalibrationRow[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    if (!seen.has(row.account)) {
      seen.add(row.account);
      order.push(row.account);
    }
  }
  return order;
}

/**
 * Leave-one-account-out validation. For each account, fit on every OTHER
 * account, then score the held-out account: Spearman rho of fitted-predicted
 * vs. actual impressions (predicted = held-out format's fitted multiplier ×
 * trailing median), and a pooled escape AUC of the trained per-format escape
 * fraction vs. the escape label. REPORT ONLY — no threshold gate. AUC is null
 * when no labeled escape rows exist.
 */
export function validateLeaveOneAccountOut(rows: CalibrationRow[]): ValidationReport {
  const accounts = uniqueAccounts(rows);
  const rhoPerAccount: Record<string, number> = {};

  const pooledPositives: number[] = [];
  const pooledNegatives: number[] = [];

  for (const heldOut of accounts) {
    const trainRows = rows.filter((row) => row.account !== heldOut);
    const testRows = rows.filter((row) => row.account === heldOut);
    const constants = fitReachConstants(trainRows);

    // Spearman: rank held-out actual impressions vs. fitted predicted reach.
    const rankable = testRows.filter((row) => row.trailing_median_imps !== null);
    if (rankable.length >= 2) {
      const predicted: number[] = [];
      const actual: number[] = [];
      for (const row of rankable) {
        const trailingMedian = row.trailing_median_imps ?? 0;
        const weights = fittedWeights(constants, row.detected_format);
        const multiplier = weights?.p50Multiplier ?? 1;
        predicted.push(multiplier * trailingMedian);
        actual.push(row.impressions);
      }
      rhoPerAccount[heldOut] = spearman(predicted, actual);
    }

    // AUC: pooled trained per-format escape fraction vs. the held-out label.
    for (const row of testRows) {
      if (row.escape_label === null) {
        continue;
      }
      const weights = fittedWeights(constants, row.detected_format);
      const pEscape = weights?.escapeProbability ?? 0;
      if (row.escape_label) {
        pooledPositives.push(pEscape);
      } else {
        pooledNegatives.push(pEscape);
      }
    }
  }

  const rhoValues = Object.values(rhoPerAccount);
  const meanRho =
    rhoValues.length === 0
      ? 0
      : rhoValues.reduce((sum, value) => sum + value, 0) / rhoValues.length;

  const escapeAuc = mannWhitneyAuc(pooledPositives, pooledNegatives);

  return { rhoPerAccount, meanRho, escapeAuc };
}
