# SDLC

The repository uses a protected-main workflow:

1. Open a GitHub issue for every feature or meaningful change.
2. Link the issue to a feature doc under `docs/features/` when the work is product-facing.
3. Implement on a branch.
4. Open a pull request linked to the issue.
5. Wait for CI to pass.
6. Get explicit review approval.
7. Merge only after required checks and review approval are satisfied.

## Required Main Gate

`main` is the release branch and should be protected in GitHub with:

- direct pushes blocked;
- pull requests required before merge;
- at least one approving review required;
- stale approvals dismissed when new commits are pushed;
- conversations resolved before merge;
- required status check: `CI / test`;
- branch required to be up to date before merge.

## CI Contract

The required CI workflow runs on pull requests to `main` and pushes to `main`:

```txt
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm exec turbo lint --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared
pnpm exec turbo typecheck --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared
pnpm exec turbo test --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared
```

End-to-end and auxiliary tooling packages are intentionally outside the default required
gate. The required check covers the runtime packages: `engine`, `overlay`, `runner`, and
`shared`. E2E can be added as a separate required check once the overlay/runner harness is
repointed and stable.

## Feature Issue Expectations

Each feature issue should include:

- feature doc path;
- goal;
- scope;
- boundaries;
- validation plan;
- acceptance criteria.

The PR should use `Closes #<issue>` so GitHub links the issue and closes it on merge.
