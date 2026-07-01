# X Overlay Browser v1 — Consolidated Architecture Report

**Diataxis: Explanation**

Validation outcome: **APPROVE_WITH_CONCERNS** — two reconciliation cycles between system and UI architects, followed by a delta-validation pass incorporating `§16` contract additions. Carried P2 concerns are listed at the end of this document. The architecture described here is the authoritative, validated design.

Source outputs synthesized: system architect output (§1–16, including two corrective passes); UI architect output (sections 1–12 + correction + delta); delta-validation pass.

---

## 1. Platform Decision

X Builder v1 takes the following platform path:

- **Runner language: Node.** A new package `@x-builder/runner` lives in the existing `pnpm`/Turborepo workspace alongside `@x-builder/engine`, `@x-builder/shared`, `@x-builder/overlay`, and the existing `client/` and `e2e-tests/` packages. This reuses the entire pnpm/Turbo workspace, the TypeScript engine, the Vitest harness, and the `@playwright/test` dep already present in `e2e-tests`. Python Playwright would spawn a Node process anyway and add a language split.

- **Engine lifecycle: in-process import, not spawn.** `RunnerApp` imports `@x-builder/engine` in-process. The existing Fastify HTTP server stays running for two purposes only: the `/writer` SPA fallback and the MV3 seam (below). Capture ingestion (`LiveCaptureService.ingest`) is an in-process typed function call, not an HTTP hop, because the runner and engine share a process and capture batches are frequent.

- **Browser: `launchPersistentContext` Chromium, dedicated profile at `~/.x-builder/browser-profile/`.** The user logs in once; the session persists. The user's default Chrome profile is never touched.

- **One-command entry: `npx x-builder` / `pnpm x-builder`.** First run triggers `playwright install chromium` automatically. Subsequent runs open the already-logged-in browser directly.

---

## 2. The 17-Method Transport Seam

The seam between the overlay and the engine is the `EngineTransport` interface, defined in `shared/src/schemas/engine-transport.ts`. It has exactly 17 methods. Each method is bound in v1 via `page.exposeFunction("__xbuilder_<method>", handler)`. All payloads are plain JSON (structured-clone safe; ISO strings for dates).

| Method | Binding name | Engine service |
|---|---|---|
| `getOverlayReadiness` | `__xbuilder_getOverlayReadiness` | Runner-composed: engine `DefaultReadinessService` + `GraphQlCaptureObserver` state |
| `getStatus` | `__xbuilder_getStatus` | `DefaultReadinessService` |
| `getSettings` | `__xbuilder_getSettings` | `JsonFileAppSettingsRepository` |
| `updateSettings` | `__xbuilder_updateSettings` | `JsonFileAppSettingsRepository` |
| `validateArchive` | `__xbuilder_validateArchive` | `ArchiveImportService.validate` |
| `importArchive` | `__xbuilder_importArchive` | `ArchiveImportService.import` |
| `getActiveContext` | `__xbuilder_getActiveContext` | `ArchiveDerivedContextService` |
| `activateContext` | `__xbuilder_activateContext` | `ArchiveDerivedContextService` |
| `deactivateContext` | `__xbuilder_deactivateContext` | `ArchiveDerivedContextService` |
| `analyzePosts` | `__xbuilder_analyzePosts` | `LiveContextResolver` → `ArchiveStudioContextResolver` → `DeterministicAnalysisService` + per-item cooldown |
| `judgeDraft` | `__xbuilder_judgeDraft` | `JudgeDraftService.judge` |
| `generateIdeas` | `__xbuilder_generateIdeas` | `GenerateIdeasService` (idea-only path unchanged; format path is LLM + generate→judge refine) |
| `suggestPost` | `__xbuilder_suggestPost` | `SuggestPostService.suggest` |
| `getCooldown` | `__xbuilder_getCooldown` | `RepetitionWindowService.compute` |
| `getCaptureSummary` | `__xbuilder_getCaptureSummary` | `LiveCaptureService.summary` |
| `getGenerateCategories` | `__xbuilder_getGenerateCategories` | `GenerateCategoryService` |
| `applyJudgeSuggestions` | `__xbuilder_applyJudgeSuggestions` | `ApplyJudgeSuggestionsService` |

**MV3 portability seam.** The `EngineTransport` interface, all its Zod schemas, and the entire overlay component tree are runtime-agnostic. Only two things change in the MV3 path: (a) the bootstrap entry (`addInitScript` → `content_scripts` + `document_start`) and (b) the transport provider (`window.__xbTransport` via `exposeFunction` → `chrome.runtime.sendMessage` → service worker → `FetchEngineTransport` doing `fetch('http://127.0.0.1:4173/...')`). The overlay's components use `useTransport()` exclusively; they never call `fetch` or reference `chrome.*`.

**Locked method spellings** (must not drift between engine and overlay): `analyzePosts`, `suggestPost`, `updateSettings`, `generateIdeas`, `getCaptureSummary`, `getOverlayReadiness`, `getGenerateCategories`, `applyJudgeSuggestions`.

---

## 3. Storage v2 and the Capture/Cooldown Model

### Post-library store v2

`postLibraryStoreSchema.schemaVersion` bumps to `literal(2)`. Two changes:

1. `metricSnapshots` becomes a discriminated union: `{source: "archive_tweets_js", observedAt, importedAt, favoriteCount?, retweetCount?}` | `{source: "x_live_capture", capturedAt, impressions?, likes?, reposts?, replies?, quotes?, bookmarks?}`. The `archive_tweets_js` branch is unchanged; the `x_live_capture` branch is new.
2. `sourceRefs` becomes a discriminated union: `{source: "archive_tweets_js", importRunId, rawId, sourceHash}` | `{source: "x_live_capture", captureSessionId, rawId}`.
3. `profileSnapshots: liveProfileSnapshot[]` is added (default `[]`).

A one-time forward migration in `loadStore` adds `profileSnapshots: []` to any v1 store on first load. Archive posts validate unchanged under the widened unions. `schemaVersion > 2` is rejected with `PostLibraryStorageError`.

### Observe-only capture

`GraphQlCaptureObserver` attaches to the Playwright `BrowserContext` via `context.on('response')`. It matches responses by **operation-name substring** (`UserTweets`, `UserTweetsAndReplies`, `UserByScreenName`) — not by queryId, which rotates. On a match it calls `await response.json()` promptly, passes the result to `XGraphQlNormalizer` (tolerate-and-skip: any malformed tweet is skipped, never throws), and calls `LiveCaptureService.ingest` in-process.

No crafted GraphQL request is ever issued. No authentication header is replayed. No auto-pagination or auto-scroll. Each session yields approximately 20 posts from the user's own normal navigation. Posts accumulate via `PostLibraryRepository.upsertPosts` (merge by `platform:platformPostId`; duplicate `metricSnapshots`/`sourceRefs` are deduplicated by key).

### Cooldown

`RepetitionWindowService.compute(windowDays)` counts posts by `classifyPostFormat` over `post.createdAt` in the rolling window. It derives a `cooldownStatusSchema` (`clear` | `warming` | `cooldown`) and `countInWindow` per format and returns a `CooldownReport`. The canonical per-signal shape is `cooldownSignalSchema {format: detectedPostFormatSchema, countInWindow, windowDays, lastPostedAt?, status, message}`. This same shape appears in two places: `AnalyzePostsResponse.items[].cooldown` (per post) and `CooldownReport.signals[]` (standalone report). One schema, two consumers.

`RepetitionWindowService` also provides `asRepeatHistory()` which converts the report into `RepeatHistoryEntry[]` for `computeRepeatMultiplier` in the deterministic scoring context.

---

## 4. Generate / Judge / Improve Flows

### Dynamic generate categories — `GenerateCategoryService`

`getGenerateCategories()` replaces the hardcoded label→format map that previously lived as a UI constant. The service loads the corpus, overlays corpus performance metadata (using `metricSnapshots[x_live_capture].replies` falling back to `weakMetrics.favoriteCount`) onto the fixed generator-format set, sorts by playbook opportunity weight first and replies-weighted performance second, annotates cooldown formats without hiding them, and returns 15 `GenerateCategory` entries with shape `{id, label, format, basis: top_performer|frequent|default, cooldownStatus, sampleCount, recentCount, windowDays}`. When the corpus has fewer than 10 originals (cold start), or when fewer than 15 generator formats are observed, it backfills the fixed generator-format set with `basis: "default"`. The overlay renders one button per returned category; the hardcoded map is gone from the UI.

### Generate→judge refine — `GenerateIdeasService`

When `generateIdeas` is called with a `format` (the by-format path), the service:

1. Generates 3 candidates in the requested format via `StructuredLlmService.generateStructured` (provider from `createSettingsJudgeProviderResolver`, purpose `writer_variants`).
2. Judges each candidate via `JudgeDraftService.judge` (same service and provider used for standalone `judgeDraft`).
3. Attaches `verdict` and `approved` (= `deriveApproved(verdict)`) to each candidate.

If the judge fails for one candidate, that candidate is returned without `verdict`/`approved`; generation does not fail. The response always returns exactly 3 candidates. The idea-only path (no `format`) is unchanged — no judge pass, no new fields.

### Auto-improve — `ApplyJudgeSuggestionsService` and the never-worse guard

`applyJudgeSuggestions({text})` runs a 3-call LLM chain:

1. Judge the original text via `JudgeDraftService.judge` → `originalVerdict`, `originalOverall`, `annotations`, `improvements`.
2. Rewrite the text applying each annotation recommendation and improvement via `StructuredLlmService.generateStructured` (purpose `writer_first_pass`) → `rewrittenText`.
3. Re-judge the rewrite via `JudgeDraftService.judge` → `rewriteVerdict`.

**Never-worse guard (maintainer-mandated):** if `rewriteVerdict.scores.overall <= originalOverall`, the service returns the original text with `{text: original, verdict: originalVerdict, approved: deriveApproved(originalVerdict), improvedOverOriginal: false}`. The rewrite is discarded. Auto-improve can never make a post worse.

### Judge span-annotations

`judgeVerdictSchema` gains `annotations: z.array(judgeAnnotationSchema).max(12).default([])`. `judgeAnnotationSchema` is `{quote: string (exact substring, max 280), severity: "suggestion"|"warning", recommendation: string (max 240)}`. The `.default([])` preserves the existing contract — all current `judgeDraft` consumers and tests continue to work without change when the model emits no annotations.

### `deriveApproved` — single approval source

`deriveApproved(verdict): boolean` lives in `shared/src/schemas/judge.ts` alongside `deriveJudgeVerdict`. Rule: `approved = verdict.verdict === "post_now" || verdict.verdict === "slight_rework"`, equivalent to `scores.overall >= 70` via `deriveJudgeVerdict`'s bands. Every producer (generate-refine, apply-suggestions) and the overlay itself must call `deriveApproved`; no component applies its own `>= 70` threshold.

---

## 5. Overlay Cockpit and the Aurora Glass Design

### Injection and isolation

`RunnerApp` calls `context.addInitScript({content: overlayBundle})` before navigation. The bootstrap:

1. Creates `<xb-overlay-root>` and appends it to `document.documentElement`.
2. Calls `host.attachShadow({mode: "open"})` — X's global CSS cannot pierce the shadow root; overlay `.xb-*` classes cannot leak onto X.
3. Applies `neonSheet` via `shadowRoot.adoptedStyleSheets` (parsed once, shared).
4. Seeds all `--xb-*` design tokens on `:host` (x.com defines no `:root` tokens that the overlay uses).
5. Calls `createRoot(mountNode)` → `<OverlayRuntime transport={window.__xbTransport} />`.

**`Drawer` and `ToastRegion` are not ported.** Both use `position: fixed` computed against the viewport — inside a shadow host that sits in X's transformed layout, fixed positioning is unreliable. `SettingsPanel` is an anchored popover (`position: absolute` within an overlay layer the host owns, with collision-flip). Toasts become an inline status region.

### Component architecture

The overlay has one persistent affordance (`SettingsAffordance`, top-left corner) and one compose-context affordance (`ComposeCockpit`).

`XSelectors` is the only module that holds X `data-testid` strings:
- `COMPOSER_TEXTAREA = 'div[data-testid="tweetTextarea_0"]'`
- `COMPOSER_BUTTON = 'div[data-testid="tweetButton"]'`
- `COMPOSER_DIALOG = '[role="dialog"]'`
- `TWEET_ARTICLE = 'article[data-testid="tweet"]'`
- `TWEET_TEXT = 'div[data-testid="tweetText"]'`

`AnchorLayer` runs a single `MutationObserver(document.body, {childList, subtree})`, rAF-batched with 150 ms debounce. Every selector read goes through `safeQuery()` which returns `null`/`[]` on miss and increments `selectorMissCount`. When misses exceed a threshold the overlay shows "X layout changed — affordances paused" in settings. It never throws, never blocks X paint.

### The three cockpit zones

`ComposeCockpit` mounts when `ComposeContext` is active (X's compose modal is open). It places three Aurora-Glass panels around the modal rect using the shared rAF rect tracker:

- **LEFT — `ComposeGenerateRail`**: 15 generate category buttons, one per `GenerateCategory` from `getGenerateCategories()`. Each button shows `category.label`; annotated with a cooldown badge when `category.cooldownStatus !== "clear"`. Click → `generateIdeas({format: category.format})`.

- **RIGHT — `StaticEngineColumn`**: static deterministic metrics (`ScoreBar`s, `PostCoachStrip`, `ReachPredictionBlock`) from `analyzePosts`. Fills fast (pure CPU, typically < 400 ms). Auto-followers from `getCaptureSummary().followers`; when absent, reach prediction enters the `disabled/missing_followers` state — no manual input is ever requested.

- **UNDER (~20px gap) — `JudgeStrip`**: 13 judge dimensions + verdict band + strengths/improvements. Judge auto-starts after static is ready if `getOverlayReadiness().llm.state === "ready"`. Shows the pulsing "AI judge running" indicator during the judge run (8 px judge-cyan dot, 1100 ms ease-in-out, gated by `prefers-reduced-motion`). Hosts "Apply all suggestions" button (judge-cyan, never X primary-CTA styling).

The static engine and judge are visually separated by a labeled `ChannelDivider` hairline (captions: "◆ Static engine" / "✦ AI judge"). The judge channel uses `--xb-judge` (cyan) tokens; the static channel uses neutral score-band tokens. Judge is never styled as the primary call-to-action.

Responsive collapse: at `< ~1180px` the three zones stack into one column (`data-cockpit="stacked"`), order: rail → static/coach → judge.

### Aurora Glass tokens

The committed visual variant is Aurora Glass. New `--xb-*` tokens seeded on `:host`:

- `--xb-accent: hsl(174 90% 52%)` — single teal accent
- `--xb-judge: hsl(192 95% 60%)` — judge channel cyan, never used as CTA
- `--xb-surface-panel: hsl(210 28% 9% / 0.72)` — translucent glass
- `--xb-glow-sm`, `--xb-glow-md`, `--xb-glow-judge` — capped glows (non-text, decorative)
- `--xb-text: hsl(180 25% 96%)`, `--xb-text-muted: hsl(195 18% 74%)` — verified ≥ 4.5:1 contrast on panel
- `--xb-band-post-now/slight/major/donot` — verdict band colors
- `--xb-highlight-green: hsl(150 72% 50%)`, `--xb-highlight-blue: hsl(205 96% 62%)` — provenance highlight colors
- `--xb-pulse-duration: 1100ms` — judge-running pulse

Theme adaptation via `data-xtheme` on `:host` (set by `OverlayThemeBridge` reading X's `<html>` computed background): `default` (X white) raises panel opacity and darkens text; `dim`/`lights-out` use the glass values above.

---

## 6. Whole-Post Provenance and the Two-State Model

The provenance model is entirely overlay-side. The engine is stateless per call — it does not store which text it generated or track any post state between calls.

### The two states

A post in the composer is always in exactly one of two states:

**Generated (green).** The text in the composer matches the last text that X Builder returned from `generateIdeas` or `applyJudgeSuggestions`, byte-for-byte. The overlay shows: whole-post green wash (`--xb-highlight-green-wash`), "✓ Judge approved" (via `deriveApproved`), no blue annotations, no "Apply all suggestions" button.

**User-written (no green).** The composer text differs from the anchor, or there is no anchor. The overlay shows: no green; judge `verdict.annotations` rendered as blue underlay spans; "Apply all suggestions" visible if the judge has completed.

### `ProvenanceController`

`ProvenanceController` stores the anchor text as L3 state (survives pin re-mounts within a compose session). It derives the current state as an L5 computation every frame: `anchor !== null && composerText === anchor → "generated"`, else `"user_written"`. The comparison is byte-for-byte string equality. There is no stored boolean; the state is always re-derived.

Anchor-setters (the only two code paths that pin a new anchor):
1. The user applies a generated candidate from `ComposeGenerateRail` (if the candidate carries `approved`, the post enters the generated state immediately without a judge wait).
2. `applyJudgeSuggestions` returns — the returned `text` (which may be the original, per the never-worse guard) is pinned as the new anchor.

### Loop prevention

"Apply all suggestions" is rendered only in the user-written state. Once the system generates text and it is applied, the button disappears. The system cannot re-improve its own output.

### `CompositionHighlightLayer`

Blue span highlights use the browser Range API: for each `annotation.quote` (exact substring), `locateQuote()` finds the first match in the composer's `contenteditable` DOM, calls `range.getClientRects()`, and renders absolutely-positioned blue underlay `div`s per rect. Highlights re-map on edit/scroll/resize at ~120 ms debounce via the shared rAF tracker.

Edge cases per `§16.4`:
- Multiple positions for the same quote → first match only.
- Same quote in multiple annotations → consume left-to-right by array index with a consumed-offset cursor.
- Quote no longer present (edited out) → silently dropped.
- `getClientRects` empty or locate throws → drop that highlight; never block the compose flow.

`pointer-events: none` on the highlight layer except for hover targets. Graceful degrade is mandatory.

---

## 7. X Policy Boundary

This boundary is documented for contributors and in the `[DOC]` ticket. The system's architecture enforces it:

**In scope:**
- Read and analyze posts visible in the user's own browsing session (already fetched by X).
- Score, judge, and suggest — presenting results to the user.
- Fill the composer with a suggestion or generated draft **after an explicit user gesture** (click).

**Out of scope (zero code in v1, none planned):**
- Any outbound HTTP request to `x.com` that the user did not trigger by browsing.
- Authenticated GraphQL calls, auto-pagination, or auto-scroll to harvest posts.
- Auto-posting, liking, following, reposting, retweeting, or sending DMs.
- Reading private areas (DMs, draft tweets).
- Automating the user's default Chrome profile.

The architecture enforces this: `context.on('response')` is read-only, `ExposeFunctionTransport` makes no network calls of its own, and the composer is only written after the user clicks. The `[INT]` test (XOB-030) and `[E2E]` test (XOB-031) include invariants that assert zero outbound GraphQL POSTs from the runner.

The policy document references X's automation rules: passive reading of rendered/already-fetched responses = "analyze visible content" (in scope); active authenticated GraphQL or pagination-to-harvest = "automated scripting of the X website" (out of scope).

---

## 8. Deferred and Zero-Trace Items

The following items were explicitly deferred. No partial implementation exists; they leave no trace in v1:

- Reply-assist ("Should I reply?" / reply angles)
- Draft scoring on other people's posts
- Thread-level and profile-level context extraction
- LLM-extracted theme categories (Tier 2; `GenerateCategoryService` uses format-based categories only)
- MV3 Chrome extension
- Hosted backend
- SQLite post-library store (`better-sqlite3` is declared in `engine/` as an unused dep; `SqlitePostLibraryRepository` is flagged as a post-v1 `[CHORE]` once the JSON store exceeds ~5 MB / a few thousand posts)
- Side panel API
- Full voice-profile editor

---

## 9. Validator's Carried P2 Concerns

These concerns were raised during the delta-validation pass and accepted into the carried work list in `tickets/README.md`. They are not blockers for the architecture approval but must be honored in the specified implementation tickets.

**(a) Per-chain LLM timeout and budget (XOB-011, XOB-012).**
The apply chain (`applyJudgeSuggestions`) makes 3 LLM calls. The generate-refine path (`generateIdeas` with `format`) makes up to 4 (generate 1 + judge 3). Without a per-chain timeout, a slow provider can stall the compose flow indefinitely. Both tickets should implement a timeout/budget (using the existing `judgeTimeoutMs` convention or a new per-chain budget) and surface a clean `generation_failed` error to the overlay rather than hanging.

**(b) Edit-while-applying cancellation (XOB-027).**
If the user edits the composer text while `applyJudgeSuggestions` is in flight (the 3-call chain), the in-flight chain should be cancelled (abort token pattern) and the compose machine should return to the user-written state from the current text. An implementation that lets the chain complete and overwrites the user's new text after they have already moved on is incorrect.

**(c) Rect-thrash visual budget during rapid typing (XOB-022 Visual AC).**
`CompositionHighlightLayer` re-maps rects on every debounced edit. At high typing speed the debounce window should be respected strictly (no intermediate re-map triggers), and the per-remap work should be bounded to visible annotations only (not the full document). The XOB-022 Visual AC should include a timing assertion at the specified ~120 ms debounce cadence under a simulated rapid-typing fixture.

---

## 10. Validation Outcome

The system architecture passed the validator's review in two stages:

**First reconciliation cycle:** the UI architect's initial call-site spellings (`analyzePost`, `getSuggestion`, `patchSettings`, `generateCandidates`) were corrected to the locked `EngineTransport` spellings (`analyzePosts`, `suggestPost`, `updateSettings`, `generateIdeas`). The readiness source was corrected from `getStatus` to `getOverlayReadiness`. The capture and cooldown shapes were corrected to the canonical schemas.

**Second reconciliation cycle (delta pass — `§16`):** the transport was extended from 15 to 17 methods (`getGenerateCategories`, `applyJudgeSuggestions`). Judge span-annotations (`annotations` field, `.default([])`), the generate→judge refine path (candidates with `verdict`/`approved`), `ApplyJudgeSuggestionsService` with the never-worse guard, the dynamic `GenerateCategoryService`, and the two-state provenance/highlight model were added. The UI delta (cockpit zone layout, `ProvenanceController`, `CompositionHighlightLayer`, `ComposeGenerateRail`) was validated against the system delta for schema and behavioral consistency.

**Result: APPROVE_WITH_CONCERNS.** The three P2 concerns above are the only outstanding items. They do not change the architecture; they are implementation-level quality gates on specific tickets.
