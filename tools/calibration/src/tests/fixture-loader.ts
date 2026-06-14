import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Test-owned loader for the synthetic JSONL row fixtures. The fit/validate
// functions are pure over CalibrationRow[], so the rows fixtures are parsed
// here and handed straight to those functions. No network, no real corpus,
// no developer-local files — every byte ships in-repo under tests/fixtures.
export function loadRowsFixture(fileName: string): unknown[] {
  const fixtureUrl = new URL(`./fixtures/${fileName}`, import.meta.url);
  const raw = readFileSync(fileURLToPath(fixtureUrl), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}
