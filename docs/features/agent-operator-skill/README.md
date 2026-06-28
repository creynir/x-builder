---
status: planned
---

# Agent Operator Skill

Roadmap note: package x-builder setup and daily operation into an agent skill so users do not have to manually remember install steps, launch commands, health checks, local-storage details, archive/context behavior, or feedback-loop linking rules.

## Goal

Create an `x-builder-operator` skill that helps agents operate the local system correctly before routing feature work to implementation agents.

This is a bookkeeping item, not an implementation plan. Dedicated tickets are intentionally not created yet.

## Why It Matters

Recent product changes made manual operation harder to reason about:

- storage moved from `post-library.json` to local SQLite with one-time JSON migration;
- the overlay settings panel now hosts archive import, active context, feedback-loop status, and external signal status;
- feedback predictions can be recorded before they are linked to an actual X post;
- active context is archive/local-history personalization, not Home feed reading;
- runner operation depends on Chrome CDP state and a logged-in x.com session.

The skill should keep those distinctions clear for future agents and users.

## Boundaries

- No direct X posting or auto-confirming publish actions.
- No bypassing browser login, X UI consent, or user confirmation.
- No Home-feed parsing as a learning source.
- No direct SQLite writes except through supported migrations or app APIs.
- No cloud sync, hosted analytics, or external credential handling.

## Existing References

- `AGENTS.md` - repo map, commands, and agent-facing current project profile.
- `docs/features/README.md` - current feature inventory and roadmap anchor.
- `docs/local-data-storage.md` - current local SQLite and migration truth.
- `docs/how-to/use-my-feedback-loop.md` - feedback prediction/linking user flow.
- `docs/features/my-x-archive-import/README.md` - archive import and active context behavior.
- `docs/features/x-overlay-browser/README.md` - overlay runner and browser product architecture.
- `runner/package.json` - runner package scripts and `x-builder` bin.
- `package.json` - workspace build/test/typecheck/lint scripts.

## Bookkeeping Notes

Likely artifact name: `x-builder-operator`.

Likely repo source, if versioned here later:

```txt
docs/features/agent-operator-skill/skill/SKILL.md
```
