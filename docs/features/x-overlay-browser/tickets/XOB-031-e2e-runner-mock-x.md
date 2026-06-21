---
status: todo
labels: [test]
---

# XOB-031: [E2E] Runner vs Local Mock x.com — Compose Flow, Capture→Corpus, Apply→Re-Pin, Generated Entry, Highlight Degrade

Depends on: XOB-001 through XOB-029

**This suite never contacts real x.com. All network traffic is served from fixtures owned here.**

## Setup

Playwright's `launchPersistentContext` starts bundled Chromium with a temporary `userDataDir`. The runner's `addInitScript` injects the built `@x-builder/overlay` bundle. All x.com URLs are served from a local HTTP fixture server (static HTML + mock route handlers) that emits canned GraphQL responses and a mock composer. No real credentials, no internet access.

The engine services run in-process with a `tmpdir`-based `JsonFilePostLibraryRepository` seeded per test. LLM providers are injected as fakes that return deterministic outputs.

## User Flows to Verify

### Flow A — type → user_written → blue annotations positioned → Apply all suggestions → improved text → green/approved re-pin

**Given** the mock x.com fixture page is loaded, the overlay is injected, and the compose modal is open  
**When** the user types text into the mock `div[data-testid="tweetTextarea_0"]` composer  
**Then** within ~400 ms the `StaticEngineColumn` fills with deterministic metrics (score bar values, reach range, Post Coach nudges); the `JudgeStrip` shows a pulsing "AI judge running" indicator; provenance state is `"user_written"`

**When** the (fake) judge completes  
**Then** `JudgeStrip` renders the verdict band and 13 judge dimension scores; `CompositionHighlightLayer` renders blue underlay rectangles over the exact substrings named in `verdict.annotations`; the "Apply all suggestions" button is visible in `JudgeStrip`

**When** the user clicks "Apply all suggestions"  
**Then** the apply chain begins (pulse during the ~3 LLM call latency); on completion the improved text is written into the composer (explicit gesture); the `ProvenanceController` re-pins the returned text as the new green anchor; provenance flips to `"generated"`; the whole-post green wash appears; blue annotation highlights are hidden; "✓ Judge approved" shows (derived via `deriveApproved`); "Apply all suggestions" is hidden

### Flow B — generated entry from refined candidate (pre-approved, no judge wait)

**Given** the compose modal is open and the overlay is mounted  
**When** the user clicks a generate category button in `ComposeGenerateRail` (e.g. "Hot take")  
**Then** the `generateIdeas({format: "hot_take"})` call is made; the returned candidate carries `verdict` and `approved` (generate→judge refine succeeded)

**When** the user selects/applies the candidate  
**Then** the text is written into the composer; the anchor is pinned immediately to the returned text; provenance is `"generated"` without waiting for a `judgeDraft` round-trip; "✓ Judge approved" renders; the `JudgeStrip` judge-pulse does not appear (pre-judged entry skips it); blue highlights are hidden

### Flow C — edit a generated post → flip to user_written → blue reappears

**Given** the composer is in the `"generated"` / green state (anchor pinned from Flow A or Flow B)  
**When** the user edits any character in the composer so that `.textContent` no longer matches the anchor  
**Then** provenance flips to `"user_written"` immediately; the green wash disappears; a fresh `judgeDraft` is queued; once the judge returns, blue annotation highlights appear over the new text's `verdict.annotations`; "Apply all suggestions" is visible again

### Flow D — observer ingests the canned GraphQL batch → corpus grows

**Given** the runner has `GraphQlCaptureObserver` attached to the browser context  
**When** the mock x.com fixture serves a canned `UserTweets` GraphQL response (containing 5 valid tweet objects) as part of normal page load  
**Then** `XGraphQlNormalizer.normalizeUserTweets` processes the response; `LiveCaptureService.ingest` accumulates the posts into the `PostLibraryRepository`; a subsequent `__xbuilder_getCaptureSummary` call returns `postsCaptured >= 5`; the `corpusSize` reported by a second ingest call does not double-count posts with the same `platformPostId`

### Flow E — highlight degrade (quote edited out → silently dropped, no block)

**Given** the composer contains a judged text with at least one blue annotation whose `quote` substring is `"specific phrase"`  
**When** the user edits the composer to remove `"specific phrase"` entirely  
**Then** the `CompositionHighlightLayer` re-runs its Range locate pass (debounced ~120 ms); the corresponding blue underlay rectangle is silently removed; the compose flow continues; no error is thrown; remaining annotations (if any) are still rendered correctly

### Flow F — static-fast-then-judge-pulse-then-fill sequence

**Given** the compose modal is open  
**When** the user types text and the debounce (350 ms) fires  
**Then** `analyzePosts` returns and the `StaticEngineColumn` fills in **before** `judgeDraft` completes; the `JudgeStrip` shows the pulse indicator while the judge is running; the static column does not clear or show a loading state during the judge run; when the judge returns, the `JudgeStrip` fills without affecting the static column

## Architectural Invariants

Each invariant is falsifiable: a compliant implementation passes; the described violation breaks it.

1. **Capture is observe-only — no crafted GraphQL POST originates from the runner.** The fixture server records every inbound request. After the mock page loads and `GraphQlCaptureObserver` processes responses, the request log must contain zero `POST` requests to any URL matching `**/graphql` that originated from the runner process (as opposed to the mock page's own simulated browser requests). An implementation that issues its own authenticated GraphQL call fails this invariant.

2. **The overlay never posts, likes, follows, or interacts with X on its own.** After all flows complete, the fixture server's mutation log (any non-GET request to paths matching `/i/api/**`) must contain zero requests. Only the runner's GET-equivalent response-observation is permitted. Any implementation that fires a write mutation fails.

3. **Static metrics render without the judge.** The test simulates a judge timeout (fake LLM hangs for the judge purpose). The `StaticEngineColumn` must still fill with valid deterministic metrics within ~400 ms. An implementation that blocks static rendering on judge availability fails.

4. **`judge-down ≠ static-down`.** When the fake LLM returns `{status: "failed"}` for the judge purpose, the `JudgeStrip` shows the failure `Alert` and retry button, but the `StaticEngineColumn` remains fully rendered and the compose flow continues. An implementation that clears or disables static results on judge failure fails.

5. **Apply-all loop prevention.** After Flow A completes and the composer is in the `"generated"` / green state, "Apply all suggestions" must not be present in the DOM (it is hidden in the generated state per `ProvenanceController`). An implementation that offers "Apply all suggestions" on already-system-generated text fails.

6. **Highlight degrade never blocks.** When `CompositionHighlightLayer.locateQuote` encounters a quote that is not present in the current composer text (Flow E), it must not throw, must not render a broken highlight, and must not prevent further typing or analysis. The compose machine must still be responsive after a locate failure.

## Modules Under Test

- `runner/src/runner-app.ts` (`RunnerApp.start`)
- `runner/src/expose-function-transport.ts` (`ExposeFunctionTransport`, all 17 bindings)
- `runner/src/graphql-capture-observer.ts` (`GraphQlCaptureObserver`, URL-filter + batch dispatch)
- `overlay/src/overlay-runtime.tsx` (`OverlayRuntime`, shadow-DOM mount, `useTransport`)
- `overlay/src/cockpit/compose-cockpit.tsx` (`ComposeCockpit`, zone anchoring)
- `overlay/src/cockpit/compose-generate-rail.tsx` (`ComposeGenerateRail`, dynamic categories)
- `overlay/src/cockpit/static-engine-column.tsx` (`StaticEngineColumn`, fast fill)
- `overlay/src/cockpit/judge-strip.tsx` (`JudgeStrip`, pulse, Apply all)
- `overlay/src/anchor/provenance-controller.ts` (`ProvenanceController`, anchor pin + flip)
- `overlay/src/anchor/composition-highlight-layer.ts` (`CompositionHighlightLayer`, Range→rects, degrade)
- `overlay/src/suggest/suggest-affordance.tsx` (`SuggestAffordance` / `SuggestCard`, incidentally exercised)

**Fixture ownership (all owned in this ticket's test directory under `e2e-tests/`):**

- `fixtures/mock-x.html` — static HTML page with a `div[data-testid="tweetTextarea_0"]` mock composer, `div[data-testid="tweetButton"]`, a `[role="dialog"]` wrapper, and a stub tweet timeline
- `fixtures/user-tweets-response.json` — canned `UserTweets` GraphQL response body (5 tweets, valid `liveCapturedPostSchema` shapes after normalization)
- `fixtures/user-by-screen-name-response.json` — canned `UserByScreenName` response with a valid profile
- `fixtures/mock-route-handlers.ts` — Playwright `page.route` intercepts serving the above fixtures and recording mutation calls

All LLM calls injected via `FakeStructuredLlmService` (deterministic, per-purpose outputs). No internet access in CI.
