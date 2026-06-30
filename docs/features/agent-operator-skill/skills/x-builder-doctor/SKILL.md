---
name: x-builder-doctor
description: Diagnose local x-builder setup and runtime failures. Use when Codex needs to check build artifacts, Node/pnpm prerequisites, Chrome CDP availability, local SQLite/storage boundaries, runner/overlay readiness, or explain why the x-builder overlay, engine, archive import, capture, or feedback loop is not working.
---

# X Builder Doctor

## Quick Diagnosis

Run the bundled doctor from the repo root:

```bash
node docs/features/agent-operator-skill/skills/x-builder-doctor/scripts/doctor.mjs
```

Use stricter checks when the user expects the overlay to be runnable now:

```bash
node docs/features/agent-operator-skill/skills/x-builder-doctor/scripts/doctor.mjs --require-build --require-cdp
```

Use JSON when another tool or report needs structured output:

```bash
node docs/features/agent-operator-skill/skills/x-builder-doctor/scripts/doctor.mjs --json
```

The doctor is read-only. It checks local files, package tools, build artifacts, SQLite metadata through the `sqlite3` CLI when available, and the configured/local Chrome CDP endpoint. It must not write to the database, launch Chrome, bypass login, or touch X.

## Triage Order

1. Run the doctor and preserve its exact failing check names.
2. If package/build checks fail, run the narrow command the failure names: usually `pnpm install`, `pnpm build`, or `pnpm --filter @x-builder/overlay build`.
3. If CDP fails, verify Chrome was started with a remote debugging port and that the user is logged into x.com in that browser.
4. If the overlay disappears after refresh, keep the runner process alive and verify post-refresh browser globals:

```js
document.getElementById("xb-overlay-root")
window.__xbTransport
window.__xbuilder_getOverlayReadiness?.()
```

5. If storage checks fail, inspect the path and permissions, but do not hand-edit SQLite rows.
6. If archive, feedback, or active-context behavior is suspect, use supported APIs or app flows to inspect state.

## Common Findings

- `overlay bundle missing`: run `pnpm --filter @x-builder/overlay build` or `pnpm build`.
- `runner dist missing`: run `pnpm --filter @x-builder/runner build` or `pnpm build`.
- `CDP unavailable`: start or reuse Chrome with `--remote-debugging-port=9222`, then run the runner with `XB_CDP_ENDPOINT=http://127.0.0.1:9222`.
- `database missing`: acceptable on a fresh install before first runner/engine startup.
- `SQLite user_version below current`: the current code expects migrations through version 4; run the app normally so supported migrations apply.
- `settings root missing`: acceptable before first run.

## Safety Rules

Do not diagnose by posting, liking, following, reposting, sending DMs, replaying X auth headers, auto-scrolling to harvest, or crafting authenticated GraphQL calls. Do not bypass user login/consent. Do not mutate `~/.x-builder/engine-settings/storage/x-builder.db` directly.
