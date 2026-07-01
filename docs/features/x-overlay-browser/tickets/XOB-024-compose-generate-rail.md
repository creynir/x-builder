---
status: done
---

# XOB-024: ComposeGenerateRail — dynamic category buttons (LEFT cockpit zone)

## Implementation Details

**Component:** `ComposeGenerateRail`

**Props:**
```ts
{
  categories: GenerateCategory[];   // from getGenerateCategories(); 15 items
  pending?: string;                 // category.id currently generating (L4, from parent)
  onGenerate: (category: GenerateCategory) => void;
}
```

**Shape of `GenerateCategory`** (from `shared/src/schemas/generate-category.ts`, §16.1):
```ts
{
  id: string;            // ≤120
  label: string;         // ≤40, shown verbatim on button
  format: DetectedPostFormat;
  basis: "top_performer" | "frequent" | "default";
  cooldownStatus: "clear" | "warming" | "cooldown";
  sampleCount: number;   // ≥0
  recentCount: number;   // ≥0, count inside cooldown window
  windowDays: number;    // cooldown window length
}
```

**Per-button rendering rules:**
- Button label = `category.label` exactly (no hardcoded label→format map; that map is DELETED).
- `cooldownStatus !== "clear"` → render an amber `Badge` (variant `"warning"`) appended inline. **Label built ONLY from fields present on `GenerateCategory`** — `cooldownStatus`, `recentCount`, and `windowDays` (e.g. `"cooldown · 4 in 7d"`). `sampleCount` remains all-time corpus support and must not be shown as the recent cooldown count. Button remains enabled (user can override).
- `pending === category.id` → render the button in its `loading` state (`<Button loading disabled>`), which shows the built-in spinner + sets `aria-busy` while keeping the label visible; button disabled during that generation.
- Cold-start (basis `"default"`, `sampleCount: 0`) → renders identically to corpus-backed buttons; no visual distinction.
- Click → `onGenerate(category)` → caller invokes `generateIdeas({ format: category.format })` (no `idea` field).

**Primitives used:** `Button` (variant `"ghost"`, accent-edge via `--xb-border-edge`; its built-in `loading` state IS the pending spinner — no separate `Spinner` primitive), `Badge` (variant `"warning"` for cooldown), and the existing `Tooltip` wrapper for the cooldown explanation.

**State levels:**
- `categories` = L1 (fetched via `getGenerateCategories()` on `ComposeContext` open, owned by `ComposeCockpit`).
- `pending` = L4 (owned by `ComposeCockpit`, passed down).

**Layout:** vertical pill list, full-width within the LEFT anchor pin. Internal scroll on overflow (never pushes X UI).

## Data Models

- `GenerateCategory` — `shared/src/schemas/generate-category.ts` (§16.1).
- `DetectedPostFormat` — existing `detectedPostFormatSchema` in `@x-builder/shared`.
- `CooldownStatus` — `"clear" | "warming" | "cooldown"` from `cooldownStatusSchema`.

No local data models; component is purely presentational over the `categories` prop.

## Integration Point

- **Parent mount:** `ComposeCockpit` mounts `ComposeGenerateRail` into the LEFT `AnchorLayer` pin (anchored to the modal left edge) when `ComposeContext` is active.
- **User entry:** `ComposeContext` becomes active → `ComposeCockpit` calls `getGenerateCategories()` → passes result as `categories` prop.
- **Terminal outcome:** user clicks a category button → `onGenerate(category)` → `ComposeCockpit` calls `generateIdeas({ format: category.format })` → returned candidate text is written into X's composer on explicit user gesture → normal compose flow continues.

## Scope Boundaries / Out of Scope

**In scope:**
- Rendering `GenerateCategory[]` as vertical teal-edge pill buttons.
- Cooldown `Badge` annotation when `cooldownStatus !== "clear"`.
- Pending spinner on the active-generating button.
- Passing `category` (not just `format`) to `onGenerate` so the caller has full context.

**Out of scope (zero-trace):**
- Hardcoded label→format map (DELETED per §B/§16.1).
- Any generation logic or transport calls (owned by `ComposeCockpit`).
- Cooldown window calculation (owned by `RepetitionWindowService` / server).
- Theming / switching between hot-take and other formats — buttons are determined entirely by `categories` prop.
- Disabling buttons when LLM is unavailable — `ComposeCockpit` may pass an empty/disabled state but `ComposeGenerateRail` renders what it receives.

## Test Strategy & Fixture Ownership

**Framework:** Vitest **browser mode → Playwright Chromium** via `vitest-browser-react` — the established overlay harness (XOB-018/020/021/022/023), shadow-DOM-aware. NOT jsdom (the "RTL" phrasing predates that decision).

**Fixtures (owned by overlay package):** `overlay/src/testing/generate-categories.ts` (beside the existing `overlay/src/testing/` harness helpers).
```ts
// overlay/src/testing/generate-categories.ts
export const defaultCategories: GenerateCategory[] = [
  { id: "default_fill_blank_tribal", label: "Fill Blank Tribal", format: "fill_blank_tribal", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_cta_farm", label: "Cta Farm", format: "cta_farm", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_fantasy_question", label: "Fantasy Question", format: "fantasy_question", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_binary_choice", label: "Binary Choice", format: "binary_choice", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_recognition_roast", label: "Recognition Roast", format: "recognition_roast", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_audience_question", label: "Audience Question", format: "audience_question", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_genuine_question", label: "Genuine Question", format: "genuine_question", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_ab_choice", label: "Ab Choice", format: "ab_choice", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_milestone", label: "Milestone", format: "milestone", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_founder_story", label: "Build-in-public", format: "founder_story", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_story", label: "Story", format: "story", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_insight_share", label: "Insight Share", format: "insight_share", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_hot_take", label: "Hot take", format: "hot_take", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_nuanced_question", label: "Nuanced Question", format: "nuanced_question", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
  { id: "default_wisdom_one_liner", label: "Wisdom One Liner", format: "wisdom_one_liner", basis: "default", cooldownStatus: "clear", sampleCount: 0, recentCount: 0, windowDays: 7 },
];
export const cooldownCategory: GenerateCategory = {
  id: "corpus_cta_farm", label: "Cta Farm", format: "cta_farm", basis: "top_performer", cooldownStatus: "cooldown", sampleCount: 12, recentCount: 4, windowDays: 7,
};
```

**Test cases:**
1. **Render** — 15 default categories → 15 buttons with correct labels in the same order as the returned array; no cooldown badges.
2. **Cooldown annotation** — `cooldownStatus: "cooldown"` → `Badge` with `variant="warning"` rendered adjacent to button label.
3. **Pending spinner** — `pending === category.id` → spinner shown, button disabled; other buttons unaffected.
4. **Click payload** — clicking a button calls `onGenerate` with the full `GenerateCategory` object; `format` field matches.
5. **Cold-start parity** — `basis: "default"` renders identically to `basis: "top_performer"` (no visual difference).

**Transport mock:** `FakeEngineTransport` (no calls from this component directly; parent-owned).

## Definition of Done

- [ ] `ComposeGenerateRail` renders one button per `GenerateCategory` from props.
- [ ] Hardcoded label→format map does not exist anywhere in the component or its descendants.
- [ ] Cooldown badge (`Badge` variant `"warning"`) shown iff `cooldownStatus !== "clear"`.
- [ ] Pending spinner shown on correct button; button disabled while pending.
- [ ] Click fires `onGenerate(category)` — not `onGenerate(category.format)`.
- [ ] Cold-start (basis `"default"`) renders without visual distinction.
- [ ] All 5 test cases pass.
- [ ] Aurora Glass Visual AC satisfied (see below).

## Acceptance Criteria

**Given** `ComposeContext` is active and `getGenerateCategories()` returns 15 categories  
**When** `ComposeGenerateRail` renders  
**Then** exactly one button appears per category, labelled with `category.label`.

**Given** a category has `cooldownStatus: "cooldown"`  
**When** the rail renders  
**Then** an amber warning `Badge` is appended to that button's label; the button remains clickable.

**Given** `pending` equals a category's `id`  
**When** the rail renders  
**Then** that button shows a `Spinner` and is disabled; all other buttons remain enabled.

**Given** the corpus is empty (cold-start, `basis: "default"`)  
**When** the rail renders  
**Then** the default 15 categories appear with no visual difference from corpus-backed categories.

**Given** the user clicks a button  
**When** `onGenerate` fires  
**Then** the callback receives the full `GenerateCategory` object (not just `format`).

## Visual AC

**Aurora Glass tokens:**
- Container: `--xb-surface-panel` background, `--xb-border-edge` outer edge, `--xb-glow-sm` on focus/hover.
- Buttons: ghost variant with teal accent edge (`--xb-accent` / `--xb-border-edge`); **never** X's primary CTA hue (`#1d9bf0`); border-radius full (pill shape).
- Cooldown badge: `--xb-band-major` amber (`hsl(42 92% 60%)`); `Badge` variant `"warning"`.
- Pending state: comes from the `Button` primitive's `loading`+`disabled` styling (built-in teal spinner, `aria-busy`, the primitive's own disabled opacity ≈0.55). Do NOT fork the primitive's token values to hit an exact 0.6 — reuse the primitive as-is.
- Layout: vertical stack, `--space-2` gap between pills.
- Hover: `--xb-glow-sm` box-shadow on button; no fill flood.
- Active (pressed): slight inward shadow; accent edge brightens.
- Reduced motion: no transition animations; spinner replaced by static `aria-busy` label "Generating…".

**Channel identity:** this zone is the generate entry point, not judge — no `--xb-judge` tokens used here.

## Edge Cases

- **Empty `categories` array:** render nothing (no error state; `ComposeCockpit` shows nothing in LEFT zone).
- **Single category:** renders as a single pill; still vertical layout.
- **Long `category.label`:** truncate with CSS ellipsis at container width; the full label is exposed via the native `title` attribute (shows on hover) AND is the button's full accessible name (so AT/focus users get it). Labels are schema-capped at ≤40 chars, so this is bounded. A full v2 `Tooltip` primitive (text-only, hover+focus, per `product-components.md`) is **deferred to its genuine first consumer** (icon-only buttons) — not built for this single truncation case (rule of three).
- **Multiple cooldown categories simultaneously:** each shows its own badge independently.
- **`pending` references an `id` not in `categories`:** no spinner shown (silently ignored).
- **Rapid clicks:** second click while `pending` is set is blocked (button disabled); no double-generation.

**Cross-deps:** XOB-019 (transport seam + `AnchorLayer`), XOB-023 (provenance — rail click triggers a generate path that sets the green anchor).

## Pipeline Log

Lane: rgb-tdd lean Red-first (Red self-validates → Green → combined Blue+Yellow). Not `[FND]`.

| Station | Commit | Result |
|---|---|---|
| pre-Red SHA | `9e3ccf2` | base (after reconciliations: Spinner=`Button.loading`, defer `Tooltip`, cooldown badge from `sampleCount`+`cooldownStatus` only, browser-mode harness) |
| Red (failing tests, self-validated) | `17bcfb8` | 12 tests; scope CLEAN; ticket-ids CLEAN; correct module-not-found failure. |
| pre-Green SHA | `17bcfb8` | base |
| Green (impl) | `6671a40` | 1 file (`overlay/src/compose/compose-generate-rail.tsx`); 219/219 overlay tests pass; typecheck green; `gates.py all` CLEAN; token-only styling; no `Spinner`/`Tooltip` primitive built. |
| Blue (validate Green) | — | **APPROVE_WITH_CONCERNS** — no test modification (`17bcfb8...6671a40` test-diff empty); ghost-button-per-category; cooldown→warning Badge from `cooldownStatus`+`sampleCount`; pending→`loading`+`disabled`+`aria-busy` (siblings unaffected); full-object `onGenerate`; `basis` never leaks (cold-start parity). Concern **D1** (full-width). Cooldown Badge in Button `trailingIcon` slot is a loose-but-correct slot reuse (text-bearing, `data-variant` marker). |
| Yellow (intent/wiring) | — | **APPROVE_WITH_CONCERNS** — 5-segment seam consumable (`onGenerate(category)` full object → parent `generateIdeas({format})` → XOB-023 green anchor); **DELETED label→format map invariant honored** (buttons derive entirely from `categories`; no hardcoded list/switch); zero-trace (no transport/generation/cooldown-calc, no `Spinner`/`Tooltip`/cockpit stubs); channel identity = generate (no `--xb-judge*`); cooldown ≠ disabled (override preserved). Concern **D1** (full-width). Also surfaced & corrected an orchestrator misstatement: the categories transport binding is `getGenerateCategories`/`__xbuilder_getGenerateCategories` (NOT `n()`) — immaterial here (rail does no transport). |

### Concerns Ledger

| # | Concern | Owner | Resolution |
|---|---|---|---|
| D1 | **Full-width pill layout is implicit.** Visual AC / Layout wants a "vertical full-width pill list," but v2 `Button` is `display:inline-flex` with no `width`/`block`/`fullWidth`/`style`/`className` prop. The rail's container is `flex-direction:column` with default `align-items:stretch`, so buttons DO stretch to the pin width (Yellow verified) — product intent is **met**, but via an implicit CSS default rather than an explicit affordance. No AC violated; no test asserts width; all 12 tests pass. | v2 `Button` enhancement (rule-of-three) / future zone tickets | Either set explicit `alignItems:"stretch"` on the rail container for intent-clarity, OR add a `block`/`fullWidth` prop to v2 `Button` when its third consumer appears. Forbidden to hack width via a primitive escape hatch (no `style`/`className` on `Button`, per the Visual-AC "don't fork the primitive" rule). DX/robustness note, not a defect. Likely recurs in XOB-025/026/028 (other zone components consuming v2 `Button` in pinned layouts) — promote to a v2 `Button block` prop if it bites a third time. |
