---
status: done
---

# X Overlay Browser

Purpose: move X Builder from a separate writer studio into an assistive overlay that runs directly on top of X, so users can inspect posts, draft replies, score ideas, and apply archive-derived context where the work already happens.

This document is shape-giving input for the next `arch-recon` run. It records the current product direction, research findings, comparison criteria, and open architecture questions. It is not a final architecture spec, product-flow map, or ticket breakdown.

## Shaping Decisions (2026-06-21 — pre-recon)

These decisions were taken with the maintainer immediately before kicking off `arch-recon`. **Where they conflict with statements further down or with the locked design-system aesthetic, these win.**

### Audience

- Build for a **generic single user (anyone)**, not for the maintainer specifically. Still local-first, single-user, no auth, no hosting.

### Feed / metrics capture (reduces the need for the official X API and removes manual follower entry)

- Capture the **user's own authored posts and their public metrics** (impressions, likes, reposts, replies, etc.) from the live, logged-in X session.
- **Mechanism is an open architecture fork for recon to weigh:**
  - (a) **DOM extraction** of rendered post cards, vs
  - (b) **observe/replay X's internal GraphQL** — the same request the profile/timeline already issues to fetch "last ~20 authored posts." This is X's *internal page API*, **not** the official paid X API that the Non-Goals rule out.
- Each session yields ~20 posts. **Store locally and accumulate across sessions** (union grows over time → richer corpus for the judge's "suggest next post").
- **Profile-level metrics (follower count, etc.) are captured automatically** → the overlay flow does **not** ask the user to type follower count. This removes the current `ManualScoringContextPanel` friction.
- **New derived feature — repetition / cooldown detection:** detect when a topic or post type is being posted too often and surface it in recommendations (e.g. "you posted this angle X times in the last Y days — give it a cooldown").
- **Policy line recon must draw:** passively reading GraphQL responses the page already fetches (and DOM already rendered) is "analyze visible content." Actively crafting authenticated GraphQL calls / paginating to harvest is closer to the "automated scripting of the X website" that X's automation rules warn against. Recon must locate v1 on the safe side and document the boundary.

### v1 surface — three overlay affordances

1. **Settings button** — persistent, anchored to a top corner (recon/design picks left vs right). Opens overlay settings: archive upload → voice extraction, judge provider + readiness, active context.
2. **Compose / post-modal experience** — X's composer is effectively its own route/modal; this is the centerpiece:
   - On open: show a **static-engine "waiting" state** (empty metric slots), an **LLM "waiting"** indicator, and **15 "generate a post" buttons** for different categories/formats.
   - On the user typing: **static-engine metrics appear fast**, then a **pulsing "judge running"** indicator, then the **judge metrics fill in**.
   - On a generate-button click: produce a draft in the chosen category/format; thereafter the flow is identical to manual typing (the LLM may be pre-run before the draft is returned — a refinement, not required for v1).
   - Profile metrics are auto-available → **no manual follower input**.
3. **Suggest-post button** — uses the stored, accumulated authored-post history to suggest the next post, accounting for cooldown / repetition.

- **Cross-cutting — metric-explainer UX:** both the static-engine metrics and the LLM-judge metrics must be made legible — explain what each metric means and how to read it. (Users currently don't understand what the judge returns.) Applies to the overlay and, where cheap, the fallback studio.
- **Deferred to "later"** (explicitly out of v1): reply-assist ("Should I reply?" + reply angles), draft scoring while typing on *other people's* posts, thread-level and profile-level context extraction.

### UI direction — neon

- The overlay uses a **neon** visual language. This **intentionally overrides** the locked "dark cool-neutral ops console, no gradients/glow" aesthetic in `docs/design-system/ui-uplift-brief.md` — **for the overlay surface**.
- The design agent should **produce 2–3 real, injectable HTML neon mockups** rendered over a mock X post card, considered against X's three themes (Default/white, Dim/navy, Lights Out/black), so the maintainer can **compare them visually before committing**. No single neon variant is pre-selected.

### Runner language / packaging

- **Open — recon decides.** Weigh Node-first (reuse the existing pnpm/Turbo workspace + engine directly, `npx`/`pnpm` onboarding) against Python-first (the `uvx x-builder` one-command story, two-language split). Recommend with justification; the maintainer approves.

---

# Epic: X Overlay Browser v1

> Status: `todo`. Architecture cleared by arch-recon (system + UI architects, validator APPROVE_WITH_CONCERNS after two reconciliation cycles + a delta-validation pass). Full architecture outputs in `architecture/`. Tickets in `tickets/` (build-order index in `tickets/README.md`). Ticket ID prefix: **`XOB-`**.

## Architecture Context

*Re-read before every ticket. Precise and complete by design.*

**Shape.** A new Node package **`@x-builder/runner`** imports **`@x-builder/engine`** in-process, drives a Playwright **`launchPersistentContext`** Chromium (dedicated profile `~/.x-builder/browser-profile/`, log in once), injects a prebuilt overlay bundle (**`@x-builder/overlay`**, `dist/overlay.iife.js`) via **`addInitScript`**, and bridges overlay→engine over **`page.exposeFunction`** (CDP pipe — **no x.com CORS**; the engine's `defaultCorsAllowedOrigins` is untouched and serves only the `/writer` fallback). The MV3-era seam is a `FetchEngineTransport` implementing the same interface; v1 ships only the Playwright transport. `/writer` SPA is **strangler-demoted to fallback** — fully functional, no route deleted.

**Transport (the seam, in `@x-builder/shared`).** One **`EngineTransport`** interface, **17 methods**, each bound `__xbuilder_<method>`, structured-clone JSON only: `getOverlayReadiness`, `getStatus`, `getSettings`, `updateSettings`, `validateArchive`, `importArchive`, `getActiveContext`, `activateContext`, `deactivateContext`, `analyzePosts`, `judgeDraft`, `generateIdeas`, `suggestPost`, `getCooldown`, `getCaptureSummary`, `getGenerateCategories`, `applyJudgeSuggestions`. The overlay consumes only this (via `useTransport()`), never `fetch`.

**Feed capture (observe-only).** The runner's `GraphQlCaptureObserver` listens via `context.on('response')` for `UserTweets`/`UserTweetsAndReplies`/`UserByScreenName` (match by **operation-name substring** — queryIds rotate), `await response.json()`, and `XGraphQlNormalizer` (tolerate-and-skip) → `LiveCaptureService.ingest`. **No crafted GraphQL, no auth-header replay, no auto-pagination, no auto-scroll** — only the ~20 the user's own navigation loaded. Posts accumulate across sessions via the existing `PostLibraryRepository.upsertPosts` (merges by `platform:platformPostId`). Captured profile metrics → auto-fed to scoring; **no manual follower input**.

**Storage v2.** `postLibraryStoreSchema` bumped to `schemaVersion: 2`: widen `metricSnapshots`/`sourceRefs` to discriminated unions admitting `"x_live_capture"` (live metrics: impressions/likes/reposts/replies/quotes/bookmarks), add `profileSnapshots[]`, one-time forward migration in `loadStore`. Existing archive data validates unchanged. `better-sqlite3` (declared, unused) is the post-v1 scale path; v1 stays JSON.

**Reach + cooldown.** `LiveContextResolver.mergeAnalysisRequest` injects live `followers`/`trailingMedianImpressions`/`repeatHistory` into `scoringContext` (then the existing `ArchiveStudioContextResolver`); `resolveBase` auto-prefers `trailing_median`. `RepetitionWindowService` computes a real rolling window over `post.createdAt` (the existing `computeRepeatMultiplier`/`RepeatHistoryEntry` were half-built — numeric damping only), surfaced as a **visible** per-item `cooldown` signal on `AnalyzePostsResponse.items[]` and via `GET /capture/cooldown`. Canonical `cooldownSignalSchema {format, countInWindow, windowDays, lastPostedAt?, status, message}`.

**Generate / judge / improve.** `generateIdeas` is extended additively (`idea?`, `format?: detectedPostFormatSchema`; arity unchanged); the by-format path is **LLM-backed (`writer_variants`) and runs a generate→judge refine** via the same `JudgeDraftService`, so candidates return with `verdict?`+`approved?` (pre-approved). `applyJudgeSuggestions({text}) → {text, verdict, approved, improvedOverOriginal}` ("Apply all suggestions" auto-improve) rewrites applying the judge's `improvements`+`annotations`, re-judges, and **never makes a post worse** (rewrite overall ≤ original → returns the original, `improvedOverOriginal:false`). The judge now also emits span-level **`annotations: [{quote, severity, recommendation}]`** (`judgeVerdictSchema`, `.default([])` → legacy contract preserved). `SuggestPostService` (`POST /posts/suggest`) ranks the corpus deterministically (cooldown-excluded) → one LLM pass. `deriveApproved(verdict)` = `overall ≥ 70`, in `@x-builder/shared` — single source of "approved"; same `JudgeDraftService`+provider backs generate-refine, apply, and the UI `judgeDraft` for consistency.

**Overlay UI — compose cockpit.** Aurora Glass (teal-glass, **harmonious-but-distinct** from X; settings launcher top-left). One shadow-DOM React root via `addInitScript`; `adoptedStyleSheets`; centralized `XSelectors` + `MutationObserver` with silent degrade. Three rect-anchored zones around X's (never-injected) compose modal: **LEFT** `ComposeGenerateRail` (dynamic categories from `getGenerateCategories()`), **RIGHT** `StaticEngineColumn` (static metrics + recommendations from the deterministic Post Coach), **UNDER ~20px** `JudgeStrip`. Collapses to one column < ~1180px.

**Provenance + the two whole-post states (engine STATELESS; all overlay-side).** A post is in exactly one state, never mixed. `ProvenanceController` pins the exact `text` returned by `generateIdeas`/`applyJudgeSuggestions` as the **green anchor** (L3) and byte-compares the live composer text (L5): equal → **generated** (whole-post **green** wash, "✓ Judge approved" via `deriveApproved`, **no blue**, Apply-all hidden); differ → **user-written** (no green, judge `annotations` shown as **blue** spans via `CompositionHighlightLayer` Range→`getClientRects`, verdict + Apply-all shown). Any edit flips generated→user-written. Apply/generate are the only anchor-setters → the system never re-improves its own output (loop-prevented). Highlight colors: green `hsl(150 72% 50%)`, blue `hsl(205 96% 62%)` (distinct from X's `#1d9bf0`); graceful degrade mandatory.

**X policy boundary (in scope vs out).** In: analyze visible content, observe already-fetched GraphQL, suggest/score/judge, fill the composer **after an explicit user click**. Out (zero code): crafted/authenticated GraphQL, auto-pagination/scroll-to-harvest, auto-post/like/follow/repost/DM, reading private areas, automating the user's default Chrome profile. Documented in the `[DOC]` ticket.

**Deferred (zero-trace in v1):** reply-assist ("Should I reply?"/reply angles), draft scoring on other people's posts, thread/profile context extraction, LLM-extracted *theme* categories (Tier 2), MV3 extension, hosted backend, SQLite store.

## API Endpoints

- `POST /ideas/generate` — *extended additively*: `{idea?, format?, voiceProfileId?, useKnownPostIds?}` → 3 candidates each with optional `{verdict?, approved?}` (by-format = LLM + generate→judge refine; idea-only path unchanged).
- `POST /drafts/judge` — *extended additively*: response `verdict.annotations: [{quote, severity, recommendation}]` (`.default([])`).
- `POST /drafts/apply-suggestions` — `{text}` → `{text, verdict, approved, improvedOverOriginal}` (auto-improve, never-worse guard).
- `POST /posts/analyze` — *extended additively*: per-item `cooldown?: CooldownSignal`; engine runs `LiveContextResolver` before `ArchiveStudioContextResolver`.
- `POST /posts/suggest` — `SuggestPostRequest` → `SuggestPostResponse`.
- `GET /capture/cooldown?windowDays=7` → `CooldownReport`.
- `GET /capture/summary` → `CaptureSummary` (for the `/writer` fallback; overlay uses the in-process binding).
- `GET /generate/categories` → `GenerateCategory[]` (fallback; overlay uses the binding).
- Capture ingestion is **in-process** (`LiveCaptureService.ingest`), not HTTP, in v1.
- Unchanged: `/health`, `/status`, `/settings`, `/archive/*`. CORS allowlist unchanged (overlay uses `exposeFunction`).

## Component Breakdown

- **Engine** — `LiveCaptureService` (ingest + summary), `RepetitionWindowService`, `LiveContextResolver`, `GenerateCategoryService`, `GenerateIdeasService` (by-format + refine), `ApplyJudgeSuggestionsService`, `SuggestPostService`; extends `JudgeDraftService` (annotations), `post-library-repository` (v2), `deriveApproved` in shared. All exported from `engine/src/index.ts` for in-process use.
- **Runner** (`@x-builder/runner`) — `RunnerApp`, `BrowserController`, `ExposeFunctionTransport` (binds 17), `GraphQlCaptureObserver`, `XGraphQlNormalizer`; composes `getOverlayReadiness` (engine subsystems + observer capture-state).
- **Overlay** (`@x-builder/overlay`) — shadow host + `OverlayRuntime`; `OverlayTransportProvider`/`useTransport`; `XSelectors`+`AnchorLayer`; `SettingsAffordance`/`SettingsPanel`; `MetricExplainer`; `CompositionHighlightLayer`; `ProvenanceController`; `ComposeCockpit` (`ComposeGenerateRail`, `StaticEngineColumn`, `JudgeStrip`); `SuggestAffordance`/`SuggestCard`.
- **Shared** (`@x-builder/shared`) — `engine-transport`, `x-live-capture`, `cooldown`, `suggest-post`, `generate-category`, `apply-judge-suggestions`, `overlay-readiness`, judge `annotations`, `deriveApproved`; additive edits to `shell`/`deterministic-analysis`/`judge`.

## Dependencies

- New runtime dep: `playwright` (in `@x-builder/runner`). `@playwright/test` already in `e2e-tests`.
- External: the user's own logged-in X session (dedicated Chromium profile). No X OAuth/API key, no hosted backend.
- Reuses wholesale: `JudgeDraftService`, `StructuredLlmService`, judge provider registry/resolver, `DeterministicAnalysisService`, `ArchiveImportService`/`ArchiveDerivedContextService`/`ArchiveStudioContextResolver`, `JsonFilePostLibraryRepository.upsertPosts`, `JsonFileAppSettingsRepository`, `classifyPostFormat`, `computeRepeatMultiplier`/`RepeatHistoryEntry`, `deriveJudgeVerdict`.

## Sub-Tickets Overview

See `tickets/README.md` for the build order. 32 tickets: `[CHORE]`+`[FND]` foundations (workspace, shared contracts, store v2) → engine services (capture, cooldown, generate-category, live-context, capture-summary, judge-annotations, generate-refine, apply-suggestions, suggest) → runner (normalizer, browser/app, transport bindings, observer+readiness) → overlay (`[FND]` host + neon tokens, `[FND]` transport seam + anchor, settings, explainer, `[FND]` highlight layer, provenance, generate rail, static column, judge strip ×2, suggest, cockpit assembly) → `[INT]` + `[E2E]` → `[DOC]`.

## Pivot Summary

The previous product shape centered on an internal `/writer` studio. That studio can generate and score post drafts, import an X archive, derive compact historical context, and judge drafts. The new direction is to make the primary surface an overlay on `x.com`.

The core user moment becomes:

1. User opens X through X Builder.
2. User clicks or focuses a visible post, reply box, thread, or profile context.
3. X Builder shows recommendations in place: whether to reply, suggested reply angles, risk notes, draft score, and voice/context fit.
4. User stays in control of final actions on X.

The system should remain open-source friendly and local-first for the first slice.

## Directions Compared

Two setup directions were explored:

- **Playwright-controlled local browser**: user runs a local command, X Builder opens a dedicated Chromium/Chrome profile, injects overlay UI, and connects the overlay to the local engine.
- **Chrome extension**: user installs an extension that injects overlay UI into the user's normal Chrome/X session and connects to either a hosted backend or local native bridge.

The current conclusion is:

- Use **Playwright-controlled local browser** for the open-source/local product.
- Keep the overlay runtime portable enough that a later Chrome extension can reuse it if the product becomes a deployed SaaS.

## Decision Matrix

| Criterion | Playwright-Controlled Browser | Chrome Extension |
|---|---|---|
| Most frictionless onboarding, local/free | Strong for technical users: one command can start the engine, open X, and preserve a dedicated login profile. | Weak unless published. Local use requires loading an unpacked extension and possibly running a local backend/native host. |
| Most frictionless onboarding, deployed/sold | Weaker: asks users to install/run a local app and log into a separate browser profile. | Strong: store install, works in the user's existing browser session. |
| Best UX, local/free | Good after first run, but separate browser profile is visible friction. | Poor in dev/unpacked mode; good only after store distribution. |
| Best UX, deployed/sold | Good for power users, less natural for mainstream buyers. | Best long-term SaaS UX: existing X session, extension toolbar, native side panel, content scripts. |
| Overlay UI | Strong. Runtime can inject JS/CSS into pages and mount custom in-page panels. | Strong. Content scripts can read and modify page DOM. |
| Local engine access | Strong. Overlay can call Playwright-exposed bindings or local HTTP directly. | More plumbing. Needs extension messaging to service worker, fetch to localhost, or native messaging host. |
| Browser automation/control | Very strong. Playwright and CDP can inspect, click, type, capture screenshots, observe requests, and manage downloads. | Limited unless using sensitive APIs such as `chrome.debugger`, which adds UX/review risk. |
| Archive upload and local files | Strong. Local app can read files and store normalized data under engine storage. | Browser file picker is possible, but large local persistence or engine execution needs backend/native bridge. |
| Speed of development | Fastest path. Reuse current engine, inject overlay, add a Python/Node runner. | Slower. Requires MV3 manifest, service worker lifecycle, permission model, content-script messaging, review constraints. |
| Local/dev mode | Natural. The dev mode is the product mode. | Unpacked extension dev mode is not representative of buyer onboarding. |
| Ease of deployment | Easy for OSS: PyPI/uv/GitHub release. | Easy for users only after Chrome Web Store approval; harder before. |
| Cost of distribution | Low direct cost. Higher support cost for local environments. | Low store fee, but hosted backend/model costs if sold as SaaS. Review/policy cost is non-trivial. |

## Research Findings

### Playwright / Local Browser

- Playwright supports persistent browser contexts using a `user_data_dir`, which stores browser session data like cookies and local storage. This enables "log in once" behavior for a dedicated X Builder browser profile.
- Playwright can launch branded Chrome or bundled Chromium, but current Chrome guidance warns against automating the user's default Chrome profile.
- Chrome 136 changed remote debugging behavior so `--remote-debugging-port` and `--remote-debugging-pipe` are no longer respected against the default Chrome data directory; automation/debugging should use a separate user data directory.
- Playwright can expose local callbacks into the page and inject scripts across navigations. This is a direct fit for overlay-to-local-engine calls.
- Chrome DevTools Protocol gives broad browser instrumentation access across DOM, Runtime, Network, Input, Page, Storage, and related domains. Playwright should be the first abstraction; raw CDP should be a fallback for advanced needs.

References:

- [Playwright persistent context](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright expose binding](https://playwright.dev/python/docs/api/class-page#page-expose-binding)
- [Chrome remote debugging profile change](https://developer.chrome.com/blog/remote-debugging-port)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

### Chrome Extension

- Content scripts can read and change page DOM, which is sufficient for in-page overlays.
- Content scripts run in isolated worlds and communicate with extension pages/service workers through message passing.
- The Side Panel API can provide a persistent companion UI alongside the current page, which is attractive for a future SaaS version.
- Extension service workers can unload when dormant, which affects long-running state and requires careful messaging/state design.
- Cross-origin backend calls require host permissions. Broad host permissions and sensitive permissions can increase Chrome Web Store review time.
- Native messaging can bridge an extension to a local process, but requires platform-specific native host registration and is not available directly from content scripts.
- Manifest V3 does not allow remotely hosted executable code. Extension logic must be bundled and reviewable.
- Chrome Web Store publication requires a developer account and review. New extensions, broad permissions, and significant code changes can increase review time.

References:

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Manifest V3 remote code requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)

### X Policy Boundary

Both approaches must stay assistive, not autonomous.

X automation rules warn against non-API scripting of the X website and state that AI-powered automated reply bots require prior written approval. The first product slice should not auto-post, auto-like, auto-follow, auto-DM, mass reply, or perform actions that surprise the user.

Allowed product posture for v1:

- analyze visible content;
- suggest reply angles;
- score drafts;
- optionally fill a reply composer after an explicit user click;
- require the user to manually post, like, repost, follow, or send.

Reference:

- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)

## Proposed Product Shape

First slice:

```txt
local x-builder runner
  starts/uses local engine
  launches dedicated browser profile
  opens x.com
  injects shared overlay runtime
  observes visible posts and reply boxes
  sends selected context to local engine
  renders recommendations in place
```

The user-facing command should eventually feel like:

```txt
uvx x-builder
```

The exact package manager, command name, and runtime packaging are architecture questions.

## Overlay Capabilities To Support

Minimum:

- detect X post cards in the timeline, thread, profile, and detail views;
- detect active reply composer and draft text;
- inject a small action affordance near a post or composer;
- open a recommendation card anchored to the selected post/composer;
- call the local engine for scoring, judging, and recommendations;
- show local engine/LLM readiness;
- upload or select archive file from settings overlay;
- persist user settings and active archive context locally.

Near-term:

- "Should I reply?" score for a visible post;
- reply angle suggestions;
- draft score while typing;
- "make it more me" rewrite suggestions;
- "use this as a voice example" marking;
- thread-level context extraction;
- profile-level lightweight context extraction;
- confidence and privacy indicators.

Later:

- portable extension version using the same overlay runtime;
- optional hosted backend;
- optional extension side panel;
- local/remote model selection;
- more robust DOM extraction layer using a browser-agent library only where deterministic selectors are insufficient.

## Reuse From Current System

Reuse as much as possible:

- archive import contracts and parser;
- canonical post library repository;
- derived archive context service;
- deterministic post scoring;
- judge provider abstraction;
- settings persistence;
- shared Zod contracts;
- existing client design tokens/components where useful for overlay UI.

Reframe:

- `/writer` becomes a fallback/internal studio, not the primary experience.
- `/library` archive import becomes an overlay settings flow or local settings page reachable from the overlay.
- active archive context becomes a local personalization layer for X-page recommendations.

## Architecture Context For Next Recon

The next `arch-recon` run should inspect and decide:

- whether the runner should be Python-first, Node-first, or split;
- whether to keep the existing Fastify engine as-is and add a separate browser runner package;
- whether overlay UI should be built as plain JS, React bundle, or reused client components;
- how the overlay runtime should communicate with local engine: Playwright binding, localhost HTTP, WebSocket, or a small bridge protocol;
- how browser profile state is stored and upgraded;
- how to package Playwright browsers and avoid a painful first install;
- how to run provider readiness checks from the local overlay;
- how archive upload works from injected UI without leaking raw archive content;
- how to structure code so a future Chrome extension can reuse the overlay runtime;
- which parts of current client routes become dead, fallback, or reusable.

## Non-Goals For The First Slice

- No Chrome extension implementation.
- No hosted backend.
- No X OAuth.
- No X API dependency.
- No autonomous posting, liking, following, reposting, or direct messaging.
- No automation that performs X account actions without an explicit user gesture.
- No scraping of private areas such as DMs.
- No attempt to automate the user's default Chrome profile.
- No full voice-profile editor unless needed to prove overlay value.

## Open Questions

- Is the first target user comfortable logging into X inside a dedicated browser profile?
- Should the dedicated profile use bundled Chromium, Chrome for Testing, or installed Chrome?
- What is the minimum install command that works reliably across macOS, Linux, and Windows?
- Should the first runner be a Python package because Playwright Python fits the one-command local story, or should it stay in the existing Node/pnpm workspace?
- How much of the current React UI can be reused without making overlay injection heavy?
- Should the overlay be shadow-DOM isolated to avoid X CSS collisions?
- How should the system handle X DOM changes without turning into a brittle selector project?
- Where is the policy line between "fill composer after explicit click" and "automated website scripting"?
- Should a later SaaS version be extension-first, or should the local browser remain the open-source product forever?

## Suggested Next Pipeline Step

Run `arch-recon` on this feature with focus on:

1. local browser runner architecture;
2. overlay runtime packaging and injection;
3. local engine reuse boundary;
4. future extension portability;
5. X policy and user-action safety boundaries.

The expected output is an architecture report and ticketable implementation path, not a broad product-flow map yet.
