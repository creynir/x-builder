---
status: done
---

# XOB-028: SuggestAffordance + SuggestCard — cooldown-aware suggest-post on home/profile

## Implementation Details

**Components:**
- `SuggestAffordance` — launcher anchored near the compose entry point on home/profile routes; opens `SuggestCard`.
- `SuggestCard` — anchored popover with suggested post + rationale + cooldown notice; "Use this" seeds the composer.

**Props (`SuggestAffordance`):**
```ts
{
  suggestion: SuggestState;
  onRefresh: () => void;      // triggers suggestPost() call in parent
  onUse: (text: string) => void; // writes draft into X's composer (explicit click, policy-safe)
  open: boolean;
  onToggle: () => void;
}
```

**`SuggestState` union:**
```ts
type SuggestState =
  | "idle"
  | "loading"
  | { status: "ready"; text: string; rationale: string; format: DetectedPostFormat; cooldown?: CooldownSignal }
  | { status: "cooldown_blocked"; reason: string; signal: CooldownSignal }
  | { status: "empty"; reason: string }
  | { status: "error"; error: string };
```

**Cooldown awareness:**
- `CooldownSignal` is bound from `suggestPost` response → `SuggestPostResponse.cooldown.signals[]`; the card binds `signal.format` + `signal.countInWindow` to display cooldown context.
- `status: "cooldown_blocked"` → show `Alert` (variant `"warning"`) with cooldown reason; refresh button available.
- `status: "ready"` with a `cooldown` attached → show inline `Badge` (variant `"warning"`) indicating the suggested format's cooldown status (warming/cooldown).

**"Use this" policy contract:**
- Writes `text` into X's composer **only on explicit user click** of "Use this" button.
- `onUse(text)` → caller (`ComposeCockpit` or parent affordance holder) performs the write gesture.
- **Never auto-posts** — the user must manually post on X after the composer is seeded.
- Button label: "Use this" (not "Post this" / "Publish").

**States rendered:**
1. `idle` — launcher button; card closed.
2. `loading` — `Skeleton` placeholder in card body.
3. `ready` — suggested post text + rationale + optional cooldown badge + "Use this" button.
4. `cooldown_blocked` — `Alert` variant `"warning"` with reason + optional refresh.
5. `empty` — `EmptyState` component ("No post history yet — capture some posts first").
6. `error` — `Alert` variant `"danger"` with retry.

**State levels:**
- `suggestion` = L1 (transport `suggestPost`, owned by parent/`AnchorLayer` affordance holder; passed down).
- `open` = **controlled prop** (parent owns the boolean; `SuggestAffordance` renders per `open` and calls `onToggle` to request a change). The component holds no internal open state of its own.

**Route gate:** mounted only on home/profile routes (X URL matches `/home` or `/:username`); owned by `AnchorLayer` route detection; `SuggestAffordance` does not implement routing logic itself.

**Primitives used:** `Button` ("Use this" — accent edge; `EmptyState` action), `Alert` (cooldown blocked + error), `Badge` (cooldown count, variant `"warning"`), `Skeleton` (loading), `IconButton` (launcher), `EmptyState` (no history).

**`EmptyState` is NOT yet in the v2 library — XOB-028 is its first consumer, so build a FRESH v2 `EmptyState` in `client/src/ui/v2/empty-state.tsx`** (token-driven, inline `var(--…)` styles, shadow-portable; export from the v2 barrel). Mirror the legacy `client/src/ui/foundation.tsx` `EmptyState` prop shape — `{ title: string; children: ReactNode; action?: ReactNode }` — but do NOT import the legacy one (it renders via global classnames, not shadow-portable), per the locked v2-primitive convention.

## Data Models

- `SuggestPostResponse` — from `suggestPostResponseSchema` (§3a): `{ status, suggestions, cooldown: CooldownReport, minimumCorpusSize }`.
- `SuggestedPost` — from `suggestedPostSchema`: `{ id, format, angle, text, rationale, cooldownStatus, sourceExamplePostIds, generatedBy }`.
- `CooldownSignal` — `{ format, countInWindow, windowDays, lastPostedAt?, status, message }` (§15.5).
- `CooldownReport` — `{ windowDays, generatedAt, corpusSource, signals[] }`.

The parent affordance holder maps `SuggestPostResponse` → `SuggestState` before passing to `SuggestAffordance`. No local models beyond `SuggestState`.

## Integration Point

- **Parent mount:** `AnchorLayer` mounts `SuggestAffordance` as an affordance pin near the compose-entry cluster when the route is home/profile and `ComposeContext` is **not** active.
- **User entry:** user clicks the suggest launcher → `onToggle()` opens `SuggestCard`; if `suggestion === "idle"` → parent calls `suggestPost()` to load.
- **Terminal outcome:** user clicks "Use this" → `onUse(text)` → parent writes text into X's composer textarea (explicit gesture, policy-safe) → composer seeded; user posts manually on X.

## Scope Boundaries / Out of Scope

**In scope:**
- All six `SuggestState` rendering cases.
- Cooldown signal display (inline badge + blocked state).
- "Use this" explicit-gesture write (no auto-post).
- `EmptyState` when corpus is below minimum (`status: "empty"`).
- Refresh affordance on blocked/error states.

**Out of scope (zero-trace):**
- Automatic posting — never.
- Auto-opening the card without user interaction.
- Displaying on compose route / in `ComposeCockpit` (separate from compose flow).
- Cooldown calculation (server-owned by `RepetitionWindowService`).
- Showing more than one suggested post at a time (single suggestion; carousel is deferred).
- `MetricExplainer` on suggest card (deferred; suggest card is not a metrics panel).

## Test Strategy & Fixture Ownership

**Framework:** Vitest **browser mode → Playwright Chromium** via `vitest-browser-react` — the established overlay harness (XOB-018/020–027), shadow-DOM-aware. NOT jsdom/RTL.

**Fixtures (owned by overlay package):** `overlay/src/testing/suggest-state.ts` (the `cooldown`/`signal` sub-objects must be valid `CooldownSignal` shapes from `@x-builder/shared`).
```ts
// overlay/src/testing/suggest-state.ts
export const loadingState: SuggestState = "loading";
export const readyState: SuggestState = {
  status: "ready",
  text: "Here's an idea for a hot take about TypeScript...",
  rationale: "You haven't posted a hot take in 3 days",
  format: "hot_take",
  cooldown: { format: "hot_take", countInWindow: 2, windowDays: 7, status: "warming", message: "2 hot takes this week" },
};
export const cooldownBlockedState: SuggestState = {
  status: "cooldown_blocked",
  reason: "You've posted 4 hot takes this week — give it a rest",
  signal: { format: "hot_take", countInWindow: 4, windowDays: 7, status: "cooldown", message: "Cooldown active" },
};
export const emptyState: SuggestState = { status: "empty", reason: "insufficient_corpus" };
export const errorState: SuggestState = { status: "error", error: "generation_failed" };
```

**Test cases:**
1. **Loading** — `Skeleton` placeholder rendered; no post text.
2. **Ready** — suggested text + rationale visible; "Use this" button present.
3. **Ready with cooldown badge** — `Badge variant="warning"` showing cooldown context visible alongside text.
4. **Cooldown blocked** — `Alert variant="warning"` with reason; "Use this" absent.
5. **Empty** — `EmptyState` with appropriate title; no `Alert`.
6. **Error** — `Alert variant="danger"` with retry; `onRefresh` called on retry click.
7. **"Use this" fires `onUse(text)`** — click → `onUse` called with exact `text` from suggestion; never fires automatically.
8. **Never auto-posts** — no call to any write/post transport method from this component directly.

**Transport mock:** `FakeEngineTransport` (calls owned by parent affordance holder; `SuggestAffordance` is presentational).

## Definition of Done

- [ ] All six `SuggestState` cases render correctly.
- [ ] Cooldown `Badge` shown in `ready` state when `cooldown` present.
- [ ] Cooldown-blocked renders `Alert variant="warning"` — not danger.
- [ ] `EmptyState` renders when `status === "empty"`.
- [ ] "Use this" calls `onUse(text)` on explicit click only — no auto-trigger.
- [ ] No element in `SuggestCard` triggers a compose/post transport call directly.
- [ ] All 8 test cases pass.
- [ ] Aurora Glass Visual AC satisfied (see below).

## Acceptance Criteria

**Given** `suggestion.status === "ready"`  
**When** `SuggestCard` is open  
**Then** the suggested post text, rationale, and "Use this" button are visible; no auto-action occurs.

**Given** `suggestion.status === "ready"` with a `cooldown` signal  
**When** `SuggestCard` renders  
**Then** an amber `Badge variant="warning"` displays the cooldown context alongside the suggestion.

**Given** `suggestion.status === "cooldown_blocked"`  
**When** `SuggestCard` renders  
**Then** `Alert variant="warning"` shows the block reason; "Use this" is absent.

**Given** `suggestion.status === "empty"` (corpus below minimum)  
**When** `SuggestCard` renders  
**Then** `EmptyState` is shown with a message indicating insufficient post history.

**Given** the user clicks "Use this"  
**When** `onUse` fires  
**Then** it is called exactly once with the suggested `text`; X's composer is seeded only by the parent performing the explicit write gesture.

**Given** `suggestion.status === "error"`  
**When** `SuggestCard` renders  
**Then** `Alert variant="danger"` shows with a retry button that calls `onRefresh`.

## Visual AC

**Aurora Glass tokens:**
- Launcher: `Button` (or `IconButton`) with `--xb-accent` edge, `--xb-glow-sm`; persists on home/profile routes.
- Card: `--xb-surface-panel` glass, `--xb-border-edge` accent edge, `--xb-glow-md`.
- "Use this" button: `Button variant="ghost"` with `--xb-accent` border — single accent edge; **not** a judge-cyan button and **not** X's primary CTA hue.
- Cooldown badge: `Badge variant="warning"`, amber `--xb-band-major`.
- Cooldown-blocked `Alert`: `variant="warning"`, amber; not red.
- `EmptyState`: muted; `--xb-text-muted` primary; no glow.
- Error `Alert`: `variant="danger"`, `--xb-band-donot` red.
- `Skeleton` loading: `--xb-surface-panel` shimmer; reduced-motion gated.
- Hover on launcher: `--xb-glow-md`; hover on "Use this": `--xb-glow-sm`.
- Reduced motion: no shimmer, no transition; static states only.

## Edge Cases

- **`suggestPost` call in flight when card opens:** show `loading` skeleton; no stale content flash.
- **Suggest while `ComposeContext` is active:** `SuggestAffordance` is not mounted (route gate); no conflict.
- **User navigates away before clicking "Use this":** card unmounts cleanly; no pending calls.
- **`ready` suggestion with `generatedBy: "deterministic_fallback"`:** renders identically to LLM-generated; no UI distinction needed (fallback is transparent to user).
- **Refresh while already loading:** debounce or disable refresh button during `loading` to prevent duplicate `suggestPost` calls.
- **`cooldown.signals` empty in `ready` response:** no badge rendered; clean render without errors.

**Cross-deps:** XOB-019 (transport seam + `AnchorLayer`), XOB-021 (MetricExplainer — not used in this card in v1, but the dep is declared for when explainers are added to suggest card in future).

## Pipeline Log

Lane: rgb-tdd lean Red-first (Red self-validates → Green → combined Blue+Yellow). Not `[FND]`.

| Station | Commit | Result |
|---|---|---|
| pre-Red SHA | `7f10e85` | base (after reconciliations: build fresh v2 `EmptyState` (first consumer), `open` is a controlled prop, browser-mode harness) |
| Red (failing tests, self-validated) | `893e115` | EmptyState contract block (in `ui-v2.test.tsx`) + 13 SuggestAffordance cases + fixtures; scope CLEAN; ticket-ids 2 benign comment matches; 2 import-resolution failures (right reason). |
| pre-Green SHA | `893e115` | base |
| Green (impl) | `e3852bb` | 3 files (`client/src/ui/v2/empty-state.tsx` + barrel, `overlay/src/suggest/suggest-affordance.tsx`); 291/291 overlay tests pass; overlay+client typecheck green; `gates.py all` CLEAN. |
| Blue (validate Green) | — | **APPROVE** — no test modification; EmptyState contract met (title/body/action-when-present; not foundation-imported); all 6 SuggestState cases; controlled `open`; "Use this"→`onUse(exact text)` once; cooldown_blocked=warning; empty=EmptyState; both typechecks honest; focused 3-file diff. |
| Yellow (intent/wiring) | — | **APPROVE** — **X-policy never-auto-post contract holds rigorously** (no transport/`useEffect`; `onUse` only on explicit click; label "Use this"); presentational/controlled-open seam; cooldown awareness (warning info, not error); fresh v2 EmptyState (not legacy reuse); zero-trace (no routing/auto-open/carousel/MetricExplainer); accent-edge ghost (not primary/judge). |

### Concerns Ledger

| # | Concern | Owner | Resolution |
|---|---|---|---|
| H1 | **Ticket Visual AC referenced `--type-title-small`, an UNDEFINED token.** Green correctly substituted the real `--type-panel-title` (defined in `product-tokens.css`). No test asserts the specific font token; cosmetic. | resolved (this ticket) | None needed — substitution is the right call. Flag: avoid phantom token names in future Visual ACs. |
| H2 (= G1/D1 recurrence) | The "Use this" `--xb-accent` edge again used the **accent-bordered-span-wrapping-a-ghost-Button** workaround (v2 `Button` has no `style`/border prop). Fourth occurrence of the D1 limitation. | v2 `Button` enhancement (already rule-of-three-triggered in XOB-027 ledger G1) | Covered by the existing README D1 note + XOB-027 G1 — add a `borderColor`/edge-token prop to v2 `Button` to retire all wrapper spans. Non-blocking. |
