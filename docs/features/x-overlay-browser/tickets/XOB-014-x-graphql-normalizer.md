---
status: done
---

# XOB-014: XGraphQlNormalizer — tolerate-and-skip GraphQL → capture DTOs

## Implementation Details

**Package:** `@x-builder/runner` (`runner/src/x-graphql-normalizer.ts`)

**Exported symbols:**

- `XGraphQlNormalizer` — module (namespace export or class with static methods; no state)
  - `normalizeUserTweets(json: unknown, capturedAt: string): LiveCapturedPost[]`
  - `normalizeUserProfile(json: unknown, capturedAt: string): LiveCapturedProfile | undefined`

**`normalizeUserTweets`** — handles responses matching the `UserTweets` and `UserTweetsAndReplies` operation names (same shape):

1. Walk `json.data.user.result.timeline_v2.timeline.instructions[].entries[].content.itemContent.tweet_results.result` (and the `tweet` sub-field for promoted tweet wrappers); also handle `timelineAddEntries` instruction type.
2. For each candidate `tweet` object, extract defensively:
   - `platformPostId` from `tweet.rest_id` (string, ≤160 chars)
   - `text` from `tweet.legacy.full_text` (string, 1–8000 chars)
   - `createdAt` from `tweet.legacy.created_at` → parse via `new Date(...).toISOString()` (must be valid date)
   - `kind`: if `tweet.legacy.in_reply_to_status_id_str` is non-null/non-empty → `"reply"`; if `tweet.legacy.retweeted_status_result` present → `"repost_reference"`; else → `"original"`; unable to determine → `"unknown"`
   - `replyReferences`: `inReplyToPostId` from `tweet.legacy.in_reply_to_status_id_str`, `inReplyToUserId` from `tweet.legacy.in_reply_to_user_id_str` (both optional; omit when absent/null)
   - `entityFlags`: `hasUrls` = `tweet.legacy.entities.urls?.length > 0`, `hasMedia` = `tweet.legacy.entities.media?.length > 0 || tweet.legacy.extended_entities?.media?.length > 0`, `hasHashtags` = `tweet.legacy.entities.hashtags?.length > 0`, `hasMentions` = `tweet.legacy.entities.user_mentions?.length > 0` (all default `false`)
   - `liveMetrics`:
     - `likes` from `tweet.legacy.favorite_count` (integer ≥ 0)
     - `reposts` from `tweet.legacy.retweet_count`
     - `replies` from `tweet.legacy.reply_count`
     - `quotes` from `tweet.legacy.quote_count`
     - `bookmarks` from `tweet.legacy.bookmark_count`
     - `impressions` from `tweet.views.count` — **type: string in the API**; parse with `parseInt(tweet.views.count, 10)`; if absent, `null`, `"unavailable"`, non-numeric, or `NaN` → leave `impressions` **undefined** (field omitted). A valid non-negative integer parse is KEPT, including `"0"` → `impressions: 0` (see Edge Cases; `"0"` is a real zero-views value, NOT a sentinel — corrected from an earlier draft that lumped `"0"` with `"unavailable"`).
   - `capturedAt` passed through as-is (ISO string from caller)
3. Tolerate-and-skip: any exception thrown while processing a single tweet entry (missing fields, type errors, `zod.parse` failure, invalid date) → `catch`, log a single `debug`-level message (no `console.error`), and **skip that entry**. Never rethrow. Return only successfully parsed records.
4. Deduplicate by `platformPostId` before returning (last-wins if same id appears twice in one response).

**`normalizeUserProfile`** — handles `UserByScreenName` responses:

1. Walk `json.data.user.result.legacy`.
2. Extract:
   - `platformUserId` from `json.data.user.result.rest_id`
   - `screenName` from `legacy.screen_name`
   - `followers` from `legacy.followers_count` (integer ≥ 0; optional — omit if absent/null/non-integer)
   - `capturedAt` passed through
3. If any of `platformUserId`, `screenName` are missing or non-string → return `undefined` (whole profile unrecoverable).
4. Wrap entire parse in try/catch → return `undefined` on any unexpected error.

**Parsing guards (apply to all numeric fields):**

- `parseInt` / `Number(...)` results that are `NaN` or negative → treat as absent (field omitted, not `0`).
- String fields that exceed schema max length → truncate or skip the record (skip preferred; truncation acceptable for `text` when ≤8000 chars after trim).

## Data Models

Consumed from `@x-builder/shared` (defined in XOB-002):

```ts
import type { LiveCapturedPost, LiveCapturedProfile } from "@x-builder/shared";
// liveCapturedPostSchema, liveCapturedProfileSchema
```

`capturedAt` parameter type is `string` (ISO 8601 datetime, produced by `GraphQlCaptureObserver` at response receipt time).

## Integration Point

**Entry:** `GraphQlCaptureObserver.attach` (XOB-017) calls these two functions immediately after `await response.json()`, off the page's critical path:

```ts
const posts = XGraphQlNormalizer.normalizeUserTweets(body, capturedAt);
const profile = XGraphQlNormalizer.normalizeUserProfile(body, capturedAt);
onBatch({ posts, profile });
```

**Terminal outcome:** A `LiveCapturedPost[]` (possibly empty) + optional `LiveCapturedProfile` are returned to the observer's batch callback for ingestion into `LiveCaptureService`. Zero throws propagate to the caller.

## Scope Boundaries / Out of Scope

**In scope:**
- Pure transformation of already-fetched JSON into typed DTOs.
- Defensive parsing, tolerate-and-skip per-record error handling.
- Fixture ownership (see Test Strategy).

**Out of scope (zero-trace):**
- No network requests, no GraphQL construction, no auth headers.
- No X.com scraping or DOM access.
- No pagination, auto-scroll, or replay of responses.
- No persistence — normalizer is stateless; `LiveCaptureService.ingest` (XOB-004) owns accumulation.
- No URL filtering — `GraphQlCaptureObserver` (XOB-017) owns operation-name matching.
- No overlay UI — owned by overlay package.

## Test Strategy & Fixture Ownership

**This ticket owns all normalizer fixtures.**

Fixture files live at `runner/src/__fixtures__/graphql/`:

- `user-tweets-valid.json` — a `UserTweets` response with 3 well-formed tweets (one original, one reply, one repost_reference); `views.count` present on two, absent on one.
- `user-tweets-one-malformed.json` — same as above but one tweet has `legacy: null` (a completely missing legacy block → should be skipped).
- `user-tweets-views-unavailable.json` — `views.count` is the string `"unavailable"` on all tweets → all `liveMetrics.impressions` must be undefined.
- `user-tweets-and-replies-valid.json` — minimal `UserTweetsAndReplies` response (same shape, confirming normalizer handles both operation names).
- `user-by-screen-name-valid.json` — a `UserByScreenName` response with `followers_count` present.
- `user-by-screen-name-no-followers.json` — `followers_count` absent → profile returned without `followers` field.
- `user-by-screen-name-malformed.json` — `data.user.result.legacy` is `undefined` → `normalizeUserProfile` returns `undefined`.

**Unit tests** (`runner/src/x-graphql-normalizer.test.ts`, Vitest):

- `normalizeUserTweets(userTweetsValid, capturedAt)` → 3 `LiveCapturedPost` records; each passes `liveCapturedPostSchema.parse`.
- `normalizeUserTweets(userTweetsOneMalformed, capturedAt)` → 2 records (malformed entry skipped), no throw.
- `normalizeUserTweets(userTweetsViewsUnavailable, capturedAt)` → all records have `liveMetrics.impressions === undefined`.
- `normalizeUserTweets({}, capturedAt)` → empty array, no throw.
- `normalizeUserProfile(userByScreenNameValid, capturedAt)` → `LiveCapturedProfile` passes schema parse; `followers` is integer ≥ 0.
- `normalizeUserProfile(userByScreenNameNoFollowers, capturedAt)` → `followers` is `undefined`.
- `normalizeUserProfile(userByScreenNameMalformed, capturedAt)` → returns `undefined`, no throw.
- `normalizeUserProfile(null, capturedAt)` → returns `undefined`, no throw.

**Runner E2E** (`e2e-tests/`) — owned by XOB-031. This ticket does not write E2E tests.

## Definition of Done

- [ ] `normalizeUserTweets` and `normalizeUserProfile` exported from `runner/src/x-graphql-normalizer.ts`.
- [ ] All seven fixture files present in `runner/src/__fixtures__/graphql/`.
- [ ] All unit tests pass (`pnpm -F @x-builder/runner test`).
- [ ] TypeScript strict mode, no `any` escapes outside the single `unknown` input parameter boundary.
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm build` passes for `@x-builder/runner`.

## Acceptance Criteria

**Given** a `UserTweets` JSON response containing one tweet whose `legacy` field is `null` (malformed) alongside two well-formed tweets,  
**When** `normalizeUserTweets(json, capturedAt)` is called,  
**Then** exactly two `LiveCapturedPost` records are returned, each validates against `liveCapturedPostSchema`, and no exception is thrown.

**Given** a `UserTweets` JSON response where all tweets have `tweet.views.count` absent or equal to `"unavailable"`,  
**When** `normalizeUserTweets(json, capturedAt)` is called,  
**Then** every returned post has `liveMetrics.impressions === undefined` (the field is absent, not `0`).

**Given** a `UserByScreenName` response with a well-formed `legacy` block,  
**When** `normalizeUserProfile(json, capturedAt)` is called,  
**Then** a `LiveCapturedProfile` is returned that validates against `liveCapturedProfileSchema`.

**Given** a completely invalid JSON shape (e.g. `null`, `{}`),  
**When** either normalizer function is called,  
**Then** the function returns an empty array or `undefined` respectively, and does not throw.

## Edge Cases

- `tweet.views.count` is the string `"0"` → `impressions` should be `0` (valid integer ≥ 0), not undefined.
- `tweet.legacy.favorite_count` is `undefined` vs `0` → `0` maps to `likes: 0`; `undefined` maps to `likes` omitted from `liveMetrics`.
- Same `platformPostId` appears twice in one response (e.g., promoted + organic slot) → deduplicate, keep last occurrence.
- `created_at` string that `new Date(...)` cannot parse → skip that tweet entirely.
- `full_text` longer than 8000 characters (extremely rare; long-form posts) → skip that tweet (do not truncate silently).
- `UserTweetsAndReplies` includes replies to other people's posts (where `in_reply_to_user_id_str` is not the authenticated user) → include them; `kind: "reply"` is correct; consumer (XOB-004 / scoring) decides whether to exclude reposts/other-replies.
- `tweet.legacy.retweeted_status_result` present AND `in_reply_to_status_id_str` non-null simultaneously (quote-reply of a retweet) → prefer `"repost_reference"` kind (retweet structure takes precedence).
- Response body is oversized (e.g. > 2MB) → `response.json()` is the caller's responsibility (XOB-017); normalizer receives already-parsed object and applies no size gate itself.

**Depends on:** XOB-002

## Pipeline Log

Lean Red-first lane. Runner package (Wave 3).

- **Red** (`7369c44`): `runner/src/x-graphql-normalizer.test.ts` (20 cases) + 8 ticket-owned fixtures in `runner/src/__fixtures__/graphql/` (valid/malformed/views-unavailable/with-replies/3× profile + an edge-cases fixture). Schema-validates outputs; covers the corrected `"0"`→0 case, dedupe last-wins, retweet-precedence, oversized-text/invalid-date skips. RED via missing module; no vitest config needed; `rg "XOB-"` clean.
- **Gates** (post-Red, base `46bfc5c`): `[ticket-ids]` CLEAN; `[scope]` initially flagged the 8 fixtures (default globs lack `__fixtures__`) → re-ran with `--allowed '…,**/__fixtures__/**'` → CLEAN (ticket-owned fixtures, not source).
- **Green** (`22ef032`, cleanup `f0627d7`): `XGraphQlNormalizer` (defensive walker over `timeline_v2…tweet_results.result`; per-entry tolerate-and-skip via try/catch + `console.debug`; `liveCapturedPostSchema` final gate; dedupe last-wins; `parseImpressions` strict `^\d+$` so `"0"`→0 / `"unavailable"`→omitted; counters 0-kept/absent-omitted; profile rest_id+screen_name required). No `any` outside the single `unknown` boundary. 20 tests, typecheck 9/9, build 7/7. Cleanup `f0627d7` removed an inert `eslint-disable no-console` (repo has no eslint; lint=tsc; the only suppression in src).
- **Gates** (post-Green, base `7369c44`): `[suppressions]`/`[ticket-ids]`/`[stubs]`/`[ui-tokens]` CLEAN; `[slop] console.debug` ruled justified (spec-mandated skip log, matches repo bare-console convention).
- **Blue (Validate Green)**: APPROVE — walker/extraction/tolerate-skip/dedupe correct, `"0"`→0 verified, typecheck+build honest (cache-bypassed), no `any` in code. console.debug ruled justified-and-required.
- **Yellow (intent)**: APPROVE — **ZERO-TRACE verified** (grep: no fetch/network/DOM/page/scrape/paginate/persist — the passive-observation X-policy guarantee holds), pure stateless transform, wiring-ready for XOB-017→XOB-004, skip-log leaks no tweet data.

### Concerns Ledger
- **Trivial (no action):** `classifyKind` never emits `"unknown"` (falls back to `"original"`). Defensible — a tweet with a validated `legacy` block is genuinely original; schema permits but doesn't require `"unknown"`; no AC asserts it.
- **Process note:** runner tickets that add `__fixtures__` need `gates.py scope --allowed '…,**/__fixtures__/**'` (default globs omit it). Applies to XOB-017 if it adds fixtures.
- Status → **done**.
