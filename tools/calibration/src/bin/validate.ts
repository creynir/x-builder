import { readFileSync } from "node:fs";

import { CalibrationRowSchema } from "../schema.js";
import type { CalibrationRow } from "../schema.js";
import { validateLeaveOneAccountOut } from "../validate.js";

// x-cal-validate <rows.jsonl>
//
// Reads normalized CalibrationRow JSONL, runs leave-one-account-out validation
// (per-account Spearman rho of fitted reach vs. actual impressions, plus a
// pooled escape AUC via Mann-Whitney), and prints the report to stdout. This is
// a REPORT — there is no threshold gate.

function loadRows(path: string): CalibrationRow[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => CalibrationRowSchema.parse(JSON.parse(line)));
}

function main(): void {
  const [, , inputPath] = process.argv;
  if (inputPath === undefined) {
    console.error("usage: x-cal-validate <rows.jsonl>");
    process.exitCode = 1;
    return;
  }

  const rows = loadRows(inputPath);
  const report = validateLeaveOneAccountOut(rows);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
