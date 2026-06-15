#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import { fitReachConstants } from "../fit.js";
import { CalibrationRowSchema } from "../schema.js";
import type { CalibrationRow } from "../schema.js";

// x-cal-fit <rows.jsonl> [out-reach-model-weights.ts]
//
// Reads normalized CalibrationRow JSONL, fits per-format reach constants
// (geometric-median multipliers, empirical escape fractions, median reply
// rates, link penalty), and writes the generated constants source file. With no
// output path the generated file contents are printed to stdout. Formats absent
// from the corpus keep their seed placeholder and are logged as not refit.

function loadRows(path: string): CalibrationRow[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => CalibrationRowSchema.parse(JSON.parse(line)));
}

function main(): void {
  const [, , inputPath, outputPath] = process.argv;
  if (inputPath === undefined) {
    console.error("usage: x-cal-fit <rows.jsonl> [out-reach-model-weights.ts]");
    process.exitCode = 1;
    return;
  }

  const rows = loadRows(inputPath);
  const constants = fitReachConstants(rows);

  if (outputPath === undefined) {
    process.stdout.write(constants.fileContents);
  } else {
    writeFileSync(outputPath, constants.fileContents, "utf8");
    console.log(`fit ${rows.length} rows -> ${outputPath}`);
  }
}

main();
