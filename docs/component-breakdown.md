# Component Breakdown

This document is the root breakdown of product components, phases, and feature docs.

Feature-level docs live under:

```txt
docs/features/[feature]/
  map/
  spec/
  tickets/
  architecture/
```

The repo code is organized as:

```txt
engine/
client/
shared/
e2e-tests/
tools/
docs/
```

`shared/` owns Zod schemas used by both `engine/` and `client/`.

## Phase 1 Milestones

### 1. BE + Simple UI Shell

Feature folder:

```txt
docs/features/be-ui-shell/
```

Builds:

- Fastify backend.
- React UI shell.
- shared schemas.
- local settings.
- storage boundary.
- shell readiness.
- route navigation.
- error and retry patterns.
- local run-history foundation.

Key decisions:

- `/health` stays liveness-only.
- `/status` owns detailed readiness.
- Settings owns shell-level local config.
- Shell keeps the app usable when Codex or storage is partial.

### 2. Post Library + Manual Import UI

Feature folder:

```txt
docs/features/post-library-manual-import/
```

Builds:

- paste import.
- CSV import.
- JSON import.
- known posts table.
- unused/used/excluded flags.
- source, author, metrics, tags.
- selection for voice, signal, and generation.

Why it matters:

- Powers voice extraction.
- Powers signal collection.
- Prevents reusing the same evidence blindly.
- Gives the writer a known-post pool before X API integration.

### 3. Voice Profile + UI

Feature folder:

```txt
docs/features/voice-profile/
```

Builds:

- voice extraction from selected/imported posts.
- editable voice profile.
- voice examples.
- sentence shape and common moves.
- topics.
- phrases to avoid.
- voice profile selection for generation.

Why it matters:

- Keeps posts from becoming generic.
- Gives the deterministic engine and Codex writer a concrete voice contract.

### 4. Deterministic Engine + UI

Feature folder:

```txt
docs/features/deterministic-engine/
```

Builds:

- candidate structures.
- reach scoring.
- engagement scoring.
- impressions scoring.
- voice-match scoring.
- overall heuristic rank.
- deterministic explanation UI.

Rules:

- Runs every time.
- Does not depend on LLM availability.
- Must be visually separate from Codex judge.
- Uses the label `Heuristic rank, not prediction.`

### 5. Codex Adapter

Feature folder:

```txt
docs/features/codex-adapter/
```

Builds:

- backend wrapper around `codex exec`.
- JSON schema output.
- timeout handling.
- retry handling.
- read-only sandbox execution.
- result parsing.
- availability/readiness checks.

Rules:

- No app-level ChatGPT subscription routing.
- No separate engine CLI required for day one.
- Future provider adapters can be added behind the same boundary later.

### 6. Writer Logic + UI

Feature folder:

```txt
docs/features/writer-logic/
```

Builds:

- idea input.
- first pass: one candidate per format.
- format selection.
- second pass: three variants in chosen format.
- voice profile usage.
- optional known-post references.
- save/copy/mark-used actions.
- writer tab.

Formats:

- one-liners / founder truths.
- lessons / mini-framework posts.
- engagement / debate / founder question posts.

### 7. LLM Judge + UI

Feature folder:

```txt
docs/features/llm-judge/
```

Builds:

- judge all candidates.
- compare against deterministic scores.
- recommend best option.
- explain risks and tradeoffs.
- suggest rewrite.
- show raw/debug output when useful.

Rules:

- Label as `Codex judge`.
- If unavailable, show: `Codex judge unavailable. Deterministic scoring still ran.`
- Judge is advisory. User selection wins.

## Phase 2 Milestones

### 8. My X Data Import + Analytics Persistence

Feature folder:

```txt
docs/features/my-x-data-import/
```

Builds:

- X API auth.
- fetch my posts and metrics.
- normalize metrics.
- persist snapshots.
- connect published posts to generated candidates.

### 9. My Feedback Loop

Feature folder:

```txt
docs/features/my-feedback-loop/
```

Builds:

- compare generated/published posts to outcomes.
- learn what works for the user's account.
- update scoring weights.
- update reusable patterns.
- show account-specific recommendations.

### 10. External X Account Import + Signal Persistence

Feature folder:

```txt
docs/features/external-x-import-signals/
```

Builds:

- import selected external accounts.
- import posts and metrics.
- normalize per account.
- store raw posts.
- store signal evidence.
- mark signal usage.

### 11. External Feedback Loop

Feature folder:

```txt
docs/features/external-feedback-loop/
```

Builds:

- extract reusable patterns.
- convert patterns into generation constraints.
- identify hooks, structures, and angles.
- avoid copying external content.

Rule:

- Borrow structure, not content.

## Later Milestone

### 12. Publishing / Export Workflow

Feature folder:

```txt
docs/features/publish-export/
```

Builds:

- copy to clipboard.
- mark as published.
- paste X URL.
- connect generated candidate to real X post.
- update published result once metrics are imported.

Why it matters:

- This closes the feedback loop between generated candidates and real X outcomes.

## Cross-Cutting Contracts

### Shared Schemas

All client/engine contracts live in `shared/`.

Needed schema groups:

- candidate schemas.
- judge schemas.
- known post schemas.
- voice profile schemas.
- app status schemas.
- API error schemas.
- app settings schemas.
- run history schemas.
- analytics snapshot schemas.
- signal schemas.

### Persistence

Phase 1 persistence should support:

- settings.
- known posts.
- voice profiles.
- generation runs.
- candidate scores.
- judge results.
- selected/copied/saved usage.

Phase 2 persistence should add:

- X account imports.
- metrics snapshots.
- published post outcomes.
- learned feedback signals.

### UI Areas

Initial app navigation:

- Writer.
- Voice.
- Post Library.
- Settings.

Later app navigation:

- My Analytics.
- Signals.

Persistent shell regions:

- sidebar navigation.
- top status bar.
- route content.
- route-local errors.
- optional inspector panels.
