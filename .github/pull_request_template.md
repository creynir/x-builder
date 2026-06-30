## Summary

- 

## Linked Issue

Closes #

## Validation

- [ ] `pnpm exec turbo build --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared`
- [ ] `pnpm --filter @x-builder/runner exec playwright install --with-deps chromium`
- [ ] `pnpm exec turbo lint --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared`
- [ ] `pnpm exec turbo typecheck --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared`
- [ ] `pnpm exec turbo test --filter=@x-builder/engine --filter=@x-builder/overlay --filter=@x-builder/runner --filter=@x-builder/shared`

## Review Checklist

- [ ] PR is linked to a GitHub issue.
- [ ] Scope matches the linked feature doc or issue.
- [ ] Tests were added or updated where behavior changed.
- [ ] CI is green before merge.
- [ ] At least one explicit approval is present before merge.
