import { readFileSync, writeFileSync } from "node:fs";

import { normalizeExportToRows } from "../normalize.js";
import type { NormalizeOptions, RawExport } from "../normalize.js";
import type { CalibrationRow } from "../schema.js";

// x-cal-normalize <raw-export.json> [out-rows.jsonl]
//
// Reads a developer-supplied raw account export (a single RawExport object or an
// array of them, optionally wrapped as { exports, pinnedIds }), normalizes every
// account to CalibrationRow[], and writes the rows as JSONL. With no output path
// the rows are printed to stdout. The corpus is supplied at runtime — it is not
// shipped in the repo.

type CorpusFile =
  | RawExport
  | RawExport[]
  | { exports: RawExport[]; pinnedIds?: NormalizeOptions["pinnedIds"] };

function parseCorpus(raw: string): {
  exports: RawExport[];
  pinnedIds: NormalizeOptions["pinnedIds"];
} {
  const parsed = JSON.parse(raw) as CorpusFile;
  if (Array.isArray(parsed)) {
    return { exports: parsed, pinnedIds: {} };
  }
  if ("exports" in parsed) {
    return { exports: parsed.exports, pinnedIds: parsed.pinnedIds ?? {} };
  }
  return { exports: [parsed], pinnedIds: {} };
}

function main(): void {
  const [, , inputPath, outputPath] = process.argv;
  if (inputPath === undefined) {
    console.error("usage: x-cal-normalize <raw-export.json> [out-rows.jsonl]");
    process.exitCode = 1;
    return;
  }

  const { exports, pinnedIds } = parseCorpus(readFileSync(inputPath, "utf8"));
  const rows: CalibrationRow[] = [];
  for (const rawExport of exports) {
    rows.push(...normalizeExportToRows(rawExport, { pinnedIds }));
  }

  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");
  if (outputPath === undefined) {
    process.stdout.write(`${jsonl}\n`);
  } else {
    writeFileSync(outputPath, `${jsonl}\n`, "utf8");
    console.log(`normalized ${rows.length} rows -> ${outputPath}`);
  }
}

main();
