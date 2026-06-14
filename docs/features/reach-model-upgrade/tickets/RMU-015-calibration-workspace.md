---
status: done
---

# RMU-015: [CHORE] Add `@x-builder/calibration` workspace

## Goal

Create a new TS workspace package to host the calibration scaffold (RMU-016). Pure TS, runs
under Vitest like every other package. **No statistics dependency** — the fit is per-format
aggregation (geometric median / empirical fraction / median ratio) and Spearman + AUC are
hand-rolled, so no `numeric`/`ml`/regression library is added.

## Changes

- `tools/calibration/package.json` — name `@x-builder/calibration`; workspace deps `@x-builder/shared` and `@x-builder/engine`; devDeps `vitest` and `tsx` (for the CLI entrypoints) only. No stats library.
- `tools/calibration/tsconfig.json` — extends `tsconfig.base.json`.
- `bin` entrypoints (run via `tsx`) for the normalizer / predictor-runner / fit / validator scripts (implemented in RMU-016).
- Confirm `pnpm-workspace.yaml`'s `tools/*` glob already includes it (it does) — no workspace-config change expected.

## Verification

- `pnpm install` resolves the new package with no new third-party stats dependency in the lockfile diff.
- `pnpm --filter @x-builder/calibration typecheck` and `pnpm --filter @x-builder/calibration build` pass.
- `pnpm test` discovers the package's (initially empty) Vitest suite without error.
- `pnpm lint` passes for the new package.

## Pipeline Log

- 2026-06-14 — **Done.** [CHORE] lane (Green + Blue mechanical + gates; no Red/Yellow). Green (`99b0ab4`) created `tools/calibration/` — `package.json` (`@x-builder/calibration`, `workspace:*` deps on `@x-builder/engine`+`@x-builder/shared`, devDeps `tsx`/`typescript`/`vitest`, sibling-style scripts with `"test": "vitest run --passWithNoTests"`, and a `bin` map for `x-cal-normalize`/`x-cal-predict`/`x-cal-fit`/`x-cal-validate` → `./src/bin/*.ts` whose targets RMU-016 creates), `tsconfig.json` (extends `../../tsconfig.base.json`, adds only `outDir`/`rootDir`/`declaration` — inherits `strict`+`noUncheckedIndexedAccess`, no loosening), and `src/index.ts` (doc comment + `export {}` to satisfy tsc TS18003; no fabricated RMU-016 logic). No stats library added; `pnpm-workspace.yaml` untouched (already globs `tools/*`). Gates clean except one verified false-positive (the suppressions gate over-matches any tsconfig change — confirmed inherit-not-loosen). All 5 verification commands pass (install no-op, typecheck, build, empty-suite test exits 0, lint). Blue (Validate Green, chore lane) APPROVE — **no concerns**. The `bin` targets and the scaffold logic are RMU-016's deliverable.
