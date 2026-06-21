---
status: todo
---

# XOB-024: ComposeGenerateRail — dynamic category buttons (LEFT cockpit zone)

## Implementation Details

**Component:** `ComposeGenerateRail`

**Props:**
```ts
{
  categories: GenerateCategory[];   // from getGenerateCategories(); 3–4 items
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
}
```

**Per-button rendering rules:**
- Button label = `category.label` exactly (no hardcoded label→format map; that map is DELETED).
- `cooldownStatus !== "clear"` → render an amber `Badge` (variant `"warning"`) appended inline, e.g. `"cool 4×/7d"` built from `category.sampleCount` + `windowDays` from the `cooldownSignal` (or a condensed label supplied by the server message field); button remains enabled (user can override).
- `pending === category.id` → show `Spinner` inside button, button disabled during that generation.
- Cold-start (basis `"default"`, `sampleCount: 0`) → renders identically to corpus-backed buttons; no visual distinction.
- Click → `onGenerate(category)` → caller invokes `generateIdeas({ format: category.format })` (no `idea` field).

**Primitives used:** `Button` (variant `"ghost"`, accent-edge via `--xb-border-edge`), `Badge` (variant `"warning"` for cooldown), `Spinner`.

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

**Framework:** Vitest + RTL, shadow-DOM-aware (queries inside shadow root).

**Fixtures (owned by overlay package):**
```ts
// fixtures/generate-categories.ts
export const defaultCategories: GenerateCategory[] = [
  { id: "hot_take", label: "Hot take", format: "hot_take", basis: "default", cooldownStatus: "clear", sampleCount: 0 },
  { id: "founder_story", label: "Build-in-public", format: "founder_story", basis: "default", cooldownStatus: "clear", sampleCount: 0 },
  { id: "audience_question", label: "Question", format: "audience_question", basis: "default", cooldownStatus: "clear", sampleCount: 0 },
  { id: "story", label: "Story", format: "story", basis: "default", cooldownStatus: "clear", sampleCount: 0 },
];
export const cooldownCategory: GenerateCategory = {
  id: "hot_take", label: "Hot take", format: "hot_take", basis: "top_performer", cooldownStatus: "cooldown", sampleCount: 4,
};
```

**Test cases:**
1. **Render** — 4 default categories → 4 buttons with correct labels; no cooldown badges.
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

**Given** `ComposeContext` is active and `getGenerateCategories()` returns 3–4 categories  
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
**Then** the default 4 categories appear with no visual difference from corpus-backed categories.

**Given** the user clicks a button  
**When** `onGenerate` fires  
**Then** the callback receives the full `GenerateCategory` object (not just `format`).

## Visual AC

**Aurora Glass tokens:**
- Container: `--xb-surface-panel` background, `--xb-border-edge` outer edge, `--xb-glow-sm` on focus/hover.
- Buttons: ghost variant with teal accent edge (`--xb-accent` / `--xb-border-edge`); **never** X's primary CTA hue (`#1d9bf0`); border-radius full (pill shape).
- Cooldown badge: `--xb-band-major` amber (`hsl(42 92% 60%)`); `Badge` variant `"warning"`.
- Pending spinner: `--xb-accent` teal; button opacity 0.6 while pending.
- Layout: vertical stack, `--space-2` gap between pills.
- Hover: `--xb-glow-sm` box-shadow on button; no fill flood.
- Active (pressed): slight inward shadow; accent edge brightens.
- Reduced motion: no transition animations; spinner replaced by static `aria-busy` label "Generating…".

**Channel identity:** this zone is the generate entry point, not judge — no `--xb-judge` tokens used here.

## Edge Cases

- **Empty `categories` array:** render nothing (no error state; `ComposeCockpit` shows nothing in LEFT zone).
- **Single category:** renders as a single pill; still vertical layout.
- **Long `category.label`:** truncate with ellipsis at container width; tooltip shows full label via `Tooltip`.
- **Multiple cooldown categories simultaneously:** each shows its own badge independently.
- **`pending` references an `id` not in `categories`:** no spinner shown (silently ignored).
- **Rapid clicks:** second click while `pending` is set is blocked (button disabled); no double-generation.

**Cross-deps:** XOB-019 (transport seam + `AnchorLayer`), XOB-023 (provenance — rail click triggers a generate path that sets the green anchor).
