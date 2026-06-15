#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import { analyzeDraftText } from "@x-builder/engine";
import type { EngagementPrediction } from "@x-builder/engine";

import { runPredictor } from "../predictor.js";
import type { RowEngine } from "../predictor.js";
import { CalibrationRowSchema } from "../schema.js";
import type { CalibrationRow } from "../schema.js";

// x-cal-predict <rows.jsonl> [out-predicted.jsonl]
//
// Reads normalized CalibrationRow JSONL, runs the REAL deterministic engine over
// every row via runPredictor (the DI seam: analyzeDraftText is injected as the
// engine), and writes one predicted row per input row as JSONL. With no output
// path the predicted rows are printed to stdout.

function loadRows(path: string): CalibrationRow[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => CalibrationRowSchema.parse(JSON.parse(line)));
}

// Adapter wiring the real engine into the row-engine DI seam: map a calibration
// row's stored signals onto analyzeDraftText's options and return its prediction.
const engine: RowEngine<EngagementPrediction | null> = (row) =>
  analyzeDraftText(row.text, {
    followers: row.followers_at_post,
    ...(row.trailing_median_imps !== null
      ? { trailingMedianImpressions: row.trailing_median_imps }
      : {}),
    hasExternalLink: row.has_external_link ?? false,
  }).prediction;

function main(): void {
  const [, , inputPath, outputPath] = process.argv;
  if (inputPath === undefined) {
    console.error("usage: x-cal-predict <rows.jsonl> [out-predicted.jsonl]");
    process.exitCode = 1;
    return;
  }

  const rows = loadRows(inputPath);
  const predicted = runPredictor(rows, { engine });

  const jsonl = predicted.map((row) => JSON.stringify(row)).join("\n");
  if (outputPath === undefined) {
    process.stdout.write(`${jsonl}\n`);
  } else {
    writeFileSync(outputPath, `${jsonl}\n`, "utf8");
    console.log(`predicted ${predicted.length} rows -> ${outputPath}`);
  }
}

main();
