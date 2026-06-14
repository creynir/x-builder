import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// STATIC POLICY: the deleted legacy reach mirror must never reappear anywhere in
// the prediction path. The transitional `rangeLow` / `rangeHigh` / `midpoint` /
// `confidence` reach fields (and the 0-10 mirror) were removed from the schema,
// the engine analyzer types + estimator + view-model + service, and the client
// prediction surface. A future regression that re-adds a compatibility shim
// (a re-declared field, a derived mirror, a `.passthrough()` re-admitting one of
// these keys) MUST fail this test.
//
// This is intentionally a SOURCE SCAN, not a runtime assertion: a shim could be
// dormant (only emitted under a flag) yet still be present in the build, and a
// runtime-only check would miss it. The scan reads REPO-OWNED source files (never
// runtime/user files) and fails fast.
//
// Falsifiability: comments are stripped before scanning (so the legitimate
// `midpoint` mentions inside prediction-estimator.ts documentation do NOT trip
// the policy), but a re-added field declaration / property access survives
// comment-stripping and is flagged. Were any of these files to re-introduce
// e.g. `midpoint: prediction.predictedMidImpressions` or `prediction.rangeLow`,
// this test would FAIL.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// The prediction-path source files across shared + engine + client. These are
// every non-test file that defines or maps the engagement-prediction shape — the
// exact surface a legacy mirror would have to reappear in.
const predictionPathFiles = [
  "shared/src/schemas/deterministic-analysis.ts",
  "engine/src/deterministic/types.ts",
  "engine/src/deterministic/prediction-estimator.ts",
  "engine/src/deterministic/prediction-view-model.ts",
  "engine/src/deterministic/deterministic-analysis-service.ts",
  "engine/src/deterministic/const/scoring-weights.ts",
  "client/src/features/writer/deterministic/components.tsx",
] as const;

// The deleted legacy prediction-mirror field names. `confidence` and `midpoint`
// were prediction fields here (the judge verdict's own `confidence` lives in the
// judge schema / writer-page, which are NOT in the scanned prediction-path set).
const legacyFieldNames = ["rangeLow", "rangeHigh", "midpoint", "confidence"] as const;

// Removes line comments, block comments, and JSX `{/* ... */}` comments so that a
// legitimate documentation mention of a banned word does not register as a real
// field occurrence. A re-added field declaration or property access is code, not
// a comment, so it survives this strip.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

// Matches a banned name only where it would be a real field/identifier: as an
// object key (`name:`), a property access (`.name`), a quoted key (`"name"` /
// `'name'`), or a bare identifier token. Word boundaries keep `midpoint` from
// matching e.g. `midpointed` and avoid false hits inside longer identifiers.
function fieldOccurrences(code: string, name: string): number {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`, "g");
  return (code.match(pattern) ?? []).length;
}

describe("no legacy reach mirror in the prediction path (static policy)", () => {
  it("scans real, readable prediction-path source files", () => {
    // Guard against a vacuous pass: every listed file must exist and be non-empty,
    // so a moved/renamed file fails loudly rather than silently skipping the scan.
    for (const relativePath of predictionPathFiles) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source.length, `${relativePath} must be a non-empty source file`).toBeGreaterThan(0);
    }
  });

  it("finds zero legacy mirror field occurrences across the prediction path", () => {
    const violations: string[] = [];

    for (const relativePath of predictionPathFiles) {
      const code = stripComments(readFileSync(join(repoRoot, relativePath), "utf8"));

      for (const name of legacyFieldNames) {
        const count = fieldOccurrences(code, name);
        if (count > 0) {
          violations.push(`${relativePath}: ${name} (x${count})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // Proves the scan is not vacuous: a synthetic shim string IS detected by the
  // same field-occurrence matcher the policy uses. This is the falsifiability
  // anchor — if the matcher silently failed to see a re-added field, the policy
  // above would be meaningless.
  it("detects a re-added legacy mirror field via the field-occurrence matcher", () => {
    const reAddedShim = `
      // a regression re-introduces the deleted mirror
      const prediction = {
        status: "available" as const,
        rangeLow: stallRange.low,
        rangeHigh: stallRange.high,
        midpoint: predictedMidImpressions,
        confidence: 0.5,
      };
    `;
    const code = stripComments(reAddedShim);

    for (const name of legacyFieldNames) {
      expect(fieldOccurrences(code, name), `matcher must see re-added ${name}`).toBeGreaterThan(0);
    }
  });

  // Proves comment-stripping does NOT hide a real re-added field: a banned word in
  // a comment is ignored, but the same word as an actual field on the next line is
  // still caught.
  it("ignores a banned word in a comment but catches it as a real field", () => {
    const mixed = `
      // never re-add midpoint to the prediction
      const prediction = { midpoint: 1 };
    `;
    const code = stripComments(mixed);

    // The comment mention was stripped; only the real field remains -> exactly 1.
    expect(fieldOccurrences(code, "midpoint")).toBe(1);
  });
});
