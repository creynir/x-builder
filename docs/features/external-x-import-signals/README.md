---
status: done
---

# External X Import + Signals

Purpose: manage external X accounts as observe-only signal sources and persist evidence-backed patterns in a separate local ledger.

## Architecture Context

External X Import + Signals adds a local external-signal ledger beside the user's own post corpus. It is designed for source management and pattern evidence, not for importing another account into the user's voice history.

The hard boundary is storage-first:

- External sources, observed evidence, refresh runs, and pattern links live in migration 3 tables: `external_x_signal_source`, `external_x_signal_evidence`, `external_x_signal_refresh_run`, `external_x_signal_pattern`, and `external_x_signal_pattern_evidence`.
- The feature does not write external posts through `PostLibraryRepository.upsertPosts`.
- External evidence does not enter the user's own post corpus, voice samples, cooldown windows, feedback actuals, archive-derived context, or captured-post summary.
- Future generation/scoring work may consume external patterns only through an explicit external-pattern provider. It must not read raw external evidence as if it were the user's own writing.

The runner side is observe-only. Once a handle is registered, X Builder listens for page-issued X GraphQL profile and timeline responses that the browser already fetched while the user browses. It does not navigate to profiles, construct GraphQL requests, add X API credentials, auto-scroll, auto-follow, or synthesize network traffic. If no already-observed response matches the source, refresh reports no observation instead of fetching anything itself.

This separation was validated through backend, runner, and E2E coverage: external observations are source-gated, registered external responses are skipped by the own-post capture observer, and the own captured-post summary remains unchanged when external evidence is ingested.

## User Guide

See [Use External X Signals](../../how-to/use-external-x-signals.md) for the settings-panel workflow.

## Settings Entry Point

Users manage the feature from **X Builder settings** in the **External X signals** section. The section sits between **Feedback loop** and **X archive** and includes:

- an **External X handle** input with an **Add** action;
- source rows with status, evidence count, pattern count, last observed time, **Refresh**, and **Remove**;
- overview totals for sources, active sources, evidence, and patterns;
- an **Evidence-backed patterns** list with pattern statements, source/evidence counts, confidence, and supporting evidence previews.

A newly added source may be active while still showing **Last observed: Waiting** and zero evidence. That means no matching already-fetched X response has been observed yet.

## API Endpoints

The engine exposes four canonical HTTP routes:

- `GET /external-x/signals/overview` - returns bounded source rows, totals, recent evidence, refresh runs, and persisted patterns.
- `POST /external-x/signals/sources` - adds a source or returns the existing source for the same normalized handle.
- `DELETE /external-x/signals/sources/:sourceId` - marks a source removed so it is hidden from the default active overview and future refresh.
- `POST /external-x/signals/sources/:sourceId/refresh` - records a refresh attempt and reconciles evidence that has already been observed for that source.

The overlay reaches the same behavior through four `EngineTransport` methods:

- `getExternalXSignalsOverview(request?)`
- `addExternalXSignalSource(request)`
- `removeExternalXSignalSource(request)`
- `refreshExternalXSignalSource(request)`

The transport surface grows from exactly 20 methods to exactly 24 methods. No alias method is part of the shipped contract.

## Refresh Semantics

There are two refresh actions in the settings UI:

- The section-level **Refresh** reloads the current overview from local storage.
- A source-row **Refresh** records a refresh run for that source, derives patterns from evidence already in the external ledger, and reports whether matching evidence exists.

Neither action fetches from X. Evidence appears only after the browser has already loaded matching X GraphQL profile/timeline responses for a registered source. Local E2E fixtures can replay those page-issued responses without live X network access; that test path exercises the same observe-only ingest boundary.

Refresh runs use honest states. A source with no matching observations stays at zero evidence and its row continues to show **Waiting** for last observed time. A captured run increases evidence and can produce patterns once there are enough supporting examples.

## Source Lifecycle

Handles are normalized by trimming a leading `@` and lowercasing the screen name. Adding the same handle twice returns the existing source instead of creating a duplicate.

Removing a source marks it `removed`. Removed sources are hidden from the default overview and future observe-only matching, but their external ledger evidence remains in the migration 3 tables. This keeps the active settings view clean without rewriting history or touching the user's own corpus.

## Evidence-Backed Patterns

Patterns are persisted snapshots derived by the engine from external evidence. The first shipped pattern type is format-based: when enough observed external examples share a detected post format, the engine writes a pattern with a label, statement, confidence, support count, source ids, evidence ids, and a small evidence preview.

The settings UI shows those server-derived patterns as read-only learning material. It does not perform client-side pattern generation and it does not automatically change generation, judging, reach scoring, or model settings.

## Component Breakdown

- `external-x-signals` shared schemas - Zod contracts for source rows, evidence rows, refresh runs, persisted patterns, overview totals, and the four source-management requests/responses.
- `SqliteExternalXSignalsRepository` - owns migration 3 external ledger reads/writes through the same SQLite handle as the engine store while avoiding own-post tables.
- `ExternalXSignalsService` - adds, removes, refreshes, ingests source-gated observed timelines, computes overviews, and persists deterministic patterns with evidence links.
- `ExternalXSignalsCaptureObserver` - runner-side observe-only observer for already-fetched X profile/timeline responses that match registered active sources.
- `ExposeFunctionTransport` external bindings - exposes the four canonical transport methods and validates requests/responses with shared schemas.
- `ExternalXSignalsSettingsSection` - settings-panel UI for adding, refreshing, removing, and reviewing external sources and patterns.

## Dependencies

- Existing local SQLite foundation through `openEngineDatabase`.
- Existing settings-panel architecture: `SettingsAffordance` owns transport calls; `SettingsPanel` renders presentational sections.
- Existing shared transport binding registry and exact-count tests.
- Existing runner observe-only capture boundary from `GraphQlCaptureObserver`.
- Existing v2 overlay primitives and tokens.

## Sub-Tickets Overview

1. `EXS-001: [FND] Define ExternalXSignals shared contracts`
2. `EXS-002: [FND] Append migration 3 and SqliteExternalXSignalsRepository`
3. `EXS-003: Build ExternalXSignalsService`
4. `EXS-004: Add ExternalXSignals Fastify routes`
5. `EXS-005: Extend EngineTransport and runner bindings`
6. `EXS-006: Add observe-only ExternalXSignalsCaptureObserver and runner wiring`
7. `EXS-007: Add ExternalXSignals settings section`
8. `EXS-008: [INT] Cover external X backend, transport, storage, and observer`
9. `EXS-009: [E2E] Verify overlay ExternalXSignals workflow`
10. `EXS-010: [DOC] Document External X Import + Signals`

## Pipeline Log

- 2026-06-28: Build implemented through EXS-010. Targeted backend, runner, overlay, and E2E coverage passed for source management, observe-only ingestion, persisted patterns, and own-corpus isolation.
- 2026-06-28: RGB ticket audit approved after adding explicit persisted pattern snapshots and dual-observer no-leak coverage.
- 2026-06-28: Arch recon approved with concern. Concern folded into EXS-006 and EXS-008: tests must prove external observations cannot leak through the existing own-post live-capture path.
