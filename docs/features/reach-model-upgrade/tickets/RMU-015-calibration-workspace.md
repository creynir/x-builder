---
status: in-progress
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
