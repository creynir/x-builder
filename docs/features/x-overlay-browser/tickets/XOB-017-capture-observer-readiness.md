---
status: done
---

# XOB-017: GraphQlCaptureObserver wiring + `getOverlayReadiness` composition (runner-side)

## Implementation Details

**Package:** `@x-builder/runner`

**Files:**

- `runner/src/graphql-capture-observer.ts` — exports `GraphQlCaptureObserver`
- `runner/src/overlay-readiness.ts` — exports `getOverlayReadiness` composer function

### GraphQlCaptureObserver

```ts
class GraphQlCaptureObserver {
  static attach(
    context: BrowserContext,
    onBatch: (batch: CaptureIngestRequest) => Promise<void>
  ): GraphQlCaptureObserver
}
```

**`attach` behavior:**

1. Register a response listener: `context.on("response", handler)`.
2. The `handler` function is `async (response: Response) => { ... }` and must **never throw or block the page** — all errors are caught and logged at `debug` level.
3. **Operation-name filter** — match the response URL against the following operation-name substrings (case-sensitive):
   - `UserTweets`
   - `UserTweetsAndReplies`
   - `UserByScreenName`
   Matching strategy: `response.url().includes(operationName)` is sufficient for v1. If none match → return immediately (no work done).
4. For matching responses, promptly call `await response.json()` to read the body. If `response.json()` throws (e.g. body is not JSON, response was aborted, body too large) → catch, update internal health to `"layout_changed"` is NOT triggered here (layout_changed is for parseable-but-empty, see below), log at `debug` level, and return.
5. Call `XGraphQlNormalizer.normalizeUserTweets(body, capturedAt)` and, for `UserByScreenName` responses, also `XGraphQlNormalizer.normalizeUserProfile(body, capturedAt)`. `capturedAt = new Date().toISOString()` set at response receipt, before `await response.json()`.
6. **Observer health update** (critical — drives `getOverlayReadiness`):
   - If `normalizeUserTweets` returns a non-empty array → set `this.state = "ok"` and `this.lastCaptureAt = capturedAt`.
   - If the operation name matches `UserTweets` or `UserTweetsAndReplies` (not `UserByScreenName`) and `normalizeUserTweets` returns an **empty array** (JSON parsed successfully but yielded zero usable tweets) → set `this.state = "layout_changed"`. This signals X's GraphQL shape has changed in a way that breaks parsing.
   - `UserByScreenName` normalizing to `undefined` (no profile) does not change state.
   - Initial state on construction: `"paused"`.
7. Construct a `CaptureIngestRequest`:
   ```ts
   const batch: CaptureIngestRequest = {
     posts: normalizedPosts,          // [] is valid (profile-only batch)
     profile: normalizedProfile,      // undefined → field omitted
   };
   ```
   If both `posts` is empty and `profile` is `undefined` → skip the `onBatch` call (nothing to ingest).
8. Call `onBatch(batch)` and `await` it — but **wrap in a `try/catch`** so an ingestion failure never propagates to the page response listener.
9. The entire response handler runs off the page's critical path: the `context.on("response")` callback returns a Promise, and Playwright does not block page rendering on it. **Do not** do any synchronous heavy work; `await response.json()` and `onBatch` are both awaited inside the async handler.

**Internal state (instance fields):**

```ts
state: "ok" | "paused" | "layout_changed"  // initial: "paused"
lastCaptureAt: string | undefined           // ISO string; undefined until first ok
```

`attach` returns the observer instance so the caller (RunnerApp) can pass it to `getOverlayReadiness`.

### getOverlayReadiness composer

```ts
async function getOverlayReadiness(
  engineReadinessService: DefaultReadinessService,
  observer: GraphQlCaptureObserver
): Promise<OverlayReadiness>
```

This function is registered as `BoundEngineServices.getOverlayReadiness` by `RunnerApp` and passed to `ExposeFunctionTransport.bindAll` (XOB-016).

**Composition:**

1. Call `engineReadinessService.getSubsystems()` (or equivalent in-process method) to get `staticEngine: SubsystemStatus` and `llm: SubsystemStatus`. These map directly to the existing engine `DefaultReadinessService` that already backs the `/status` endpoint.
2. Build the `capture` block from the observer's current health:
   ```ts
   const capture = {
     state: observer.state,
     label: labelFor(observer.state),     // see label map below
     message: messageFor(observer.state), // optional, see below
     lastCaptureAt: observer.lastCaptureAt,
     checkedAt: new Date().toISOString(),
   };
   ```
3. Return `overlayReadinessSchema.parse({ staticEngine, llm, capture })`.

**Label and message map:**

| `state` | `label` (≤80 chars) | `message` (optional, ≤240 chars) |
|---|---|---|
| `"ok"` | `"Feed capture active"` | _(omitted)_ |
| `"paused"` | `"Waiting for feed"` | `"Navigate to your X profile or home feed to capture posts."` |
| `"layout_changed"` | `"Feed capture paused — X layout may have changed"` | `"Posts were detected but could not be parsed. X may have updated its page structure."` |

**Wiring in RunnerApp (XOB-015):**

After creating the observer instance, `RunnerApp.start()` passes the composer as a closure:

```ts
const observer = GraphQlCaptureObserver.attach(this.context, batch => this.liveCaptureService.ingest(batch));

this.services.getOverlayReadiness = () =>
  getOverlayReadiness(this.engineReadinessService, observer);

await ExposeFunctionTransport.bindAll(this.page, this.services);
```

This keeps `ExposeFunctionTransport` unaware of the observer internals.

## Data Models

**`CaptureIngestRequest`** — from `@x-builder/shared` (XOB-002):

```ts
captureIngestRequestSchema = z.object({
  posts: z.array(liveCapturedPostSchema).max(200).default([]),
  profile: liveCapturedProfileSchema.optional(),
})
```

**`OverlayReadiness`** — from `@x-builder/shared` (XOB-002), `overlayReadinessSchema`:

```ts
{
  staticEngine: subsystemStatusSchema,
  llm: subsystemStatusSchema,
  capture: {
    state: z.enum(["ok", "paused", "layout_changed"]),
    label: z.string().max(80),
    message: z.string().max(240).optional(),
    lastCaptureAt: z.string().datetime().optional(),
    checkedAt: z.string().datetime(),
  }
}
```

## Integration Point

**Entry:** `RunnerApp.start()` (XOB-015) calls:

```ts
const observer = GraphQlCaptureObserver.attach(
  this.context,
  async (batch) => { await this.liveCaptureService.ingest(batch); }
);
```

This is called after `ExposeFunctionTransport.bindAll` (all bindings registered) and before `page.goto` — so capture is active from the moment x.com begins loading.

**`getOverlayReadiness`** is registered as a binding handler in `ExposeFunctionTransport` (XOB-016) via `BoundEngineServices.getOverlayReadiness`. The overlay calls `window.__xbuilder_getOverlayReadiness()` to poll/refresh the readiness state.

**Terminal outcome:**

- Every `UserTweets`/`UserTweetsAndReplies`/`UserByScreenName` response the page fetches is intercepted, normalized, and ingested into the corpus via `LiveCaptureService`.
- `getOverlayReadiness()` returns a live composite view: engine subsystem health + observer capture state.
- Page rendering is never blocked by capture or ingestion work.

## Scope Boundaries / Out of Scope

**In scope:**
- `context.on("response")` registration and operation-name filtering.
- `await response.json()` and immediate hand-off to `XGraphQlNormalizer`.
- Observer health state machine (`ok` / `paused` / `layout_changed`).
- `getOverlayReadiness` composition function (engine subsystems + observer state).
- Wiring the composer into `BoundEngineServices.getOverlayReadiness` (done in `RunnerApp`; described here for context).

**Out of scope (zero-trace):**
- No crafted GraphQL requests, no bearer/ct0/x-client-transaction-id header construction.
- No auto-pagination, no auto-scroll to harvest more responses.
- No XQL query-ID matching — operation-name substring only (query IDs rotate).
- No DOM scraping or page evaluation.
- `XGraphQlNormalizer` implementation — owned by XOB-014.
- `LiveCaptureService.ingest` implementation — owned by XOB-004.
- Overlay UI readiness indicators — owned by `@x-builder/overlay`.
- No real x.com scraping.

## Test Strategy & Fixture Ownership

This ticket does not own GraphQL fixtures (those are XOB-014's). The runner E2E is owned by XOB-031.

**Unit tests** (`runner/src/graphql-capture-observer.test.ts`, `runner/src/overlay-readiness.test.ts`, Vitest):

- **Observer attach — matching response:**
  - Construct a mock `BrowserContext` with a controllable `on("response", ...)` callback.
  - Fire a mock response with URL `https://x.com/i/api/graphql/abc123/UserTweets?variables=...` → handler fires.
  - Mock `XGraphQlNormalizer.normalizeUserTweets` to return 2 `LiveCapturedPost` records.
  - Assert `onBatch` called with `{ posts: [post1, post2] }`.
  - Assert `observer.state === "ok"` and `observer.lastCaptureAt` is a valid ISO string.

- **Observer attach — non-matching URL:**
  - Fire a mock response with URL `https://x.com/i/api/graphql/abc/HomeTimeline` → `onBatch` not called, state remains `"paused"`.

- **Observer — `layout_changed` path:**
  - Fire a `UserTweets` response; mock `normalizeUserTweets` to return `[]` (empty — matches but yields zero tweets) → `observer.state === "layout_changed"`.

- **Observer — `response.json()` throws:**
  - Mock response's `.json()` to throw → handler does not propagate; `onBatch` not called; state remains `"paused"`.

- **Observer — `onBatch` throws:**
  - Mock `onBatch` to throw → handler does not propagate to the page.

- **`getOverlayReadiness` — state:ok:**
  - Observer state `"ok"`, `lastCaptureAt` set; mock `DefaultReadinessService` returns healthy subsystems.
  - Result: `capture.state === "ok"`, `capture.label === "Feed capture active"`, `capture.lastCaptureAt` set, result passes `overlayReadinessSchema.parse`.

- **`getOverlayReadiness` — state:paused:**
  - Fresh observer (state `"paused"`, no `lastCaptureAt`).
  - Result: `capture.state === "paused"`, `capture.message` present.

- **`getOverlayReadiness` — state:layout_changed:**
  - Observer state `"layout_changed"`.
  - Result: `capture.state === "layout_changed"`, `capture.message` present.

## Definition of Done

- [ ] `GraphQlCaptureObserver.attach` exported from `runner/src/graphql-capture-observer.ts`.
- [ ] Observer correctly filters by operation-name substring (only `UserTweets`, `UserTweetsAndReplies`, `UserByScreenName`).
- [ ] Observer health state machine transitions correctly: `"paused"` → `"ok"` on first successful normalize, `"layout_changed"` on empty-parse.
- [ ] `getOverlayReadiness` exported from `runner/src/overlay-readiness.ts`; composes engine subsystems + observer state.
- [ ] Page is never blocked: `onBatch` errors are caught; `response.json()` errors are caught.
- [ ] All unit tests pass (`pnpm -F @x-builder/runner test`).
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm build` passes for `@x-builder/runner`.

## Acceptance Criteria

**Given** a canned `UserTweets` response is fired through the mock context,  
**When** `GraphQlCaptureObserver`'s handler processes it,  
**Then** `XGraphQlNormalizer.normalizeUserTweets` is called, `onBatch` is called with the normalized posts, and `observer.state` transitions to `"ok"` — the page rendering is not blocked.

**Given** the observer has just been attached and no matching response has fired yet,  
**When** `getOverlayReadiness` is called,  
**Then** the returned `OverlayReadiness` has `capture.state === "paused"` and `capture.message` is non-empty.

**Given** a `UserTweets` response fires and `normalizeUserTweets` returns an empty array (JSON parsed successfully, zero usable tweets),  
**When** `getOverlayReadiness` is called after,  
**Then** the returned `OverlayReadiness` has `capture.state === "layout_changed"` and `capture.message` describing the X layout drift.

**Given** the `onBatch` callback throws an error during ingestion,  
**When** the observer's response handler processes the response,  
**Then** the error is caught internally and does not propagate to Playwright's response listener chain; `observer.state` remains unchanged from before the batch call.

## Edge Cases

- `UserByScreenName` response that normalizes to `undefined` (no profile extractable) does not change observer state; `onBatch` is not called for a profile-only batch when `profile === undefined` and `posts` is empty.
- `UserByScreenName` response that normalizes a profile successfully: `onBatch({ posts: [], profile })` — an empty posts array with a valid profile is a valid ingest call (profile-only batch); `observer.state` is NOT set to `"ok"` from a `UserByScreenName` response (only `UserTweets`/`UserTweetsAndReplies` drive the tweets-ok signal).
- Multiple matching responses in quick succession (e.g. user navigating rapidly): each fires an independent async handler; they may overlap — observer state is set by the last one to complete, which is acceptable for a health indicator.
- Response body > 2MB (unlikely for `UserTweets` which caps at ~20 posts, but possible for unusual accounts): `response.json()` may throw or return a very large object. If it throws → caught + state unchanged. If it returns → normalizer's per-record try/catch handles any downstream issues.
- `context.on("response")` may fire for resources other than GraphQL (images, JS, CSS) — the URL filter handles these cheaply with `.includes(operationName)` and returns immediately.
- After `context.close()` (during `RunnerApp.stop()`), no new response events fire; Playwright unregisters handlers on context close.

**Depends on:** XOB-004, XOB-014, XOB-015

## Pipeline Log

Lean Red-first lane. Building-block scope (consistent with XOB-016): observer + readiness composer delivered as structurally-typed, mocked-unit-tested modules; the RunnerApp wiring (attachObserver→`GraphQlCaptureObserver.attach`, register `getOverlayReadiness` into the bundle, wrap engine readiness into `getSubsystems`) defers to XOB-030 [INT].

- **Red** (`649c5cf`): `graphql-capture-observer.test.ts` (10) + `overlay-readiness.test.ts` (4). Drives non-empty vs empty tweets through the REAL `XGraphQlNormalizer` (XOB-014 fixtures + `{}`). Specified structural seams `ContextLike`/`ResponseLike`/`ReadinessLike`/`ObserverLike`. Flagged that engine `ReadinessService` exposes `getStatus()` not `getSubsystems()` (composer types it structurally; real wrap is XOB-030). RED via 2 missing modules; prior 61 pass; `rg "XOB-"` clean.
- **Gates** (post-Red, base `dd9eb57`): `[scope]` + `[ticket-ids]` CLEAN.
- **Green** (`fe95d79`): `GraphQlCaptureObserver` (op-name substring filter; state machine paused→ok/layout_changed; `capturedAt` before json; never-block defense-in-depth (json/onBatch/catch-all → `console.debug`, never propagate); profile-only batch; AC#4 state-before-onBatch) + `getOverlayReadiness` composer (subsystem passthrough + exact label/message map + checkedAt + `overlayReadinessSchema.parse`). Structural types only (no Playwright/engine class imports). RunnerApp untouched. 75 tests, typecheck 10/10, build green.
- **Gates** (post-Green, base `649c5cf`): `[suppressions]`/`[ticket-ids]`/`[stubs]`/`[ui-tokens]` CLEAN; `[slop] console.debug ×3` ruled justified (spec-mandated never-block tolerate logging; generic messages, no tweet-content leak).
- **Blue (Validate Green)**: APPROVE — op-filter/state-machine/never-block/composer/structural-types all correct, typecheck+build honest (cache-bypassed), RunnerApp no-op default intact.
- **Yellow (intent)**: APPROVE_WITH_CONCERNS — deliverable real, **ZERO-TRACE rigorously verified** (no crafted GraphQL/auth-headers/DOM/pagination/query-id — only `context.on("response")` + `response.json()` on already-fetched responses; the X-policy passive-observation boundary holds), never-block isolation, wiring shapes line up for XOB-030.

### Concerns Ledger — CARRIED TO XOB-030 [INT]
- **Capture is inert end-to-end until XOB-030 wires it:** RunnerApp's `attachObserver` is still XOB-015's no-op default. XOB-030 MUST wire `attachObserver` default → `GraphQlCaptureObserver.attach(context, batch => liveCaptureService.ingest(batch))` AND register `getOverlayReadiness(<engine readiness wrapped to getSubsystems>, observer)` into `BoundEngineServices.getOverlayReadiness`, then prove capture→corpus + readiness round-trip in-process. (Added to the same XOB-016→XOB-030 carried note in `tickets/README.md`.)
- Status → **done**.
