# Product Foundations — X Builder

Stage: product-design-system / Stage 2 FOUNDATIONS.

Status: draft for Review Gate 1.

Inputs:

- [Product Design Brief](./product-design-brief.md)
- [Product Tokens CSS](./product-tokens.css)

## Foundation Intent

This token system exists to prevent X Builder from becoming a generic AI SaaS dark-mode interface.

It should support:

- dense candidate comparison
- visible evidence trails
- deterministic score vs. Codex judge distinction
- post-library memory surfaces
- partial/unavailable/stale states
- later X analytics with mixed confidence

It should not support:

- decorative gradients
- hero layouts
- large accent surfaces
- chat-first UI
- equal-weight card grids pretending to be a product

## Design Principles Encoded

### Recommendations Need Evidence

Token consequences:

- Mono typography for ranks, metrics, timestamps, providers, and evidence IDs.
- Warning and uncertain states are first-class semantic tokens.
- Score bands are semantic and labeled.
- Codex judge uses info treatment, not accent dominance.

### The Writer Controls The Machine

Token consequences:

- Selection tokens are stronger than judge/advisory tokens.
- Primary interaction is reserved for user actions.
- LLM unavailable states use partial/uncertain treatments.

### Memory Is A Product Surface

Token consequences:

- Table, row, bulk selection, and source badge tokens are explicit.
- Usage states have semantic tokens: unused, voice, signal, generation, excluded.
- Provenance and freshness use mono/meta treatment.

### Density With A Reading Rhythm

Token consequences:

- 32px default controls.
- 36px default rows.
- 12px panel padding baseline, but purpose-specific padding tokens exist.
- Borders and surface steps carry most of the layout work.

### No Generic AI Aesthetic

Token consequences:

- No gradient tokens.
- No glow tokens.
- No large AI-panel accent tokens.
- No ornamental background tokens.

## Color Architecture

The default theme is dark ops-console.

Reference colors are cool-neutrals tinted toward blue/cyan. The UI avoids pure black and pure white.

Accent is X-adjacent blue/cyan and appears only as:

- primary action
- active route marker
- selected candidate outline
- focus ring
- active tab underline
- small readiness states

Semantic colors:

- `success`: saved, imported, copied, valid, judge complete.
- `warning`: low evidence, partial import, stale metrics, heuristic uncertainty.
- `danger`: invalid input, failed import, judge failure, destructive/excluded.
- `info`: Codex judge, provider status, neutral system explanation.
- `uncertain`: deterministic-only, missing metrics, insufficient evidence.

Usage colors:

- `usage-unused`
- `usage-voice`
- `usage-signal`
- `usage-generation`
- `usage-excluded`

These map post-library memory states without relying only on color.

## Typography

Font mapping:

- `--font-display`: Geist, route titles only.
- `--font-body`: Geist, product UI.
- `--font-mono`: JetBrains Mono, factual/system/data values.

Type scale:

- 11px: dense badges and status metadata.
- 12px: labels, helper text, captions.
- 13px: compact row text and secondary UI.
- 14px: default body and controls.
- 16px: panel titles.
- 18px: dialog/section emphasis.
- 20px: page section heading.
- 24px: route title maximum.

Rules:

- Candidate post text uses body font, not display font.
- Score/rank/metric values use mono.
- Uppercase labels are rare and must use `--tracking-wide`.
- No viewport-based font scaling.

## Spacing

Scale starts at 1px, with dense 2px granularity.

Important defaults:

- icon/text gap: 4px.
- compact inline gap: 6px.
- control padding: 8-12px.
- panel padding compact: 10px.
- panel padding default: 12px.
- panel padding spacious: 16px.
- feature page padding: 16px.

Purpose-specific spacing:

- Writer input panel: default.
- Candidate board: compact.
- Judge inspector: compact.
- Post Library table: dense.
- Settings: default.

Do not use identical padding everywhere.

## Layout

Core dimensions:

- Header: 40px.
- Status bar: 22px.
- Sidebar expanded: 224px.
- Sidebar collapsed: 48px.
- Writer inspector: 340px.
- Narrow inspector: 280px.
- Wide inspector: 420px.

Panel priority:

1. Main work surface.
2. Candidate board.
3. Inspector.
4. Sidebar.
5. Status bar.

Responsive collapse:

- Inspector collapses first.
- Sidebar becomes rail next.
- Status bar hides on narrow screens.
- Main content remains the product center.

## Elevation

Dark mode uses surface steps and light borders before shadows.

Elevation levels:

- `sunken`: input wells, code blocks, post text wells.
- `default`: page background.
- `panel`: major product surfaces.
- `raised`: selected/interactive temporary emphasis.
- `overlay`: menus, drawers, dialogs.

No decorative shadows.

## Borders And Radius

Default radius:

- 3px: dense controls and badges.
- 4px: buttons, inputs, table rows.
- 6px: panels and dropdowns.
- 8px: overlays.

Rules:

- No nested cards.
- Page sections are not floating cards.
- Selected candidate uses border/outline channel.
- Validation error uses border + icon/text.

## Motion

Motion is functional.

- 50ms: very small opacity/color feedback.
- 100ms: active/pressed.
- 150ms: hover/focus/selection.
- 200ms: state changes.
- 300ms: drawer/panel entrance.
- 400ms: maximum.

Only transform and opacity should animate. Reduced motion disables animation but preserves state changes.

## Density

Day-one density: default.

- Control height: 32px.
- Input height: 32px.
- Button height: 32px.
- Row height: 36px.
- Nav item height: 32px.

Compact/comfortable modes exist as tokens only. They should not drive phase 1 scope.

## Data Visualization

Phase 2 analytics will need chart colors. The palette is defined now to prevent ad hoc color choices later.

Rules:

- Chart color does not carry status alone.
- Direct labels and summaries are required.
- Red/green pairs need text/icon/shape backup.
- Metric confidence must be encoded separately from metric value.

## State Encoding

State dimensions use different channels:

- Category/source: badge/icon tint.
- Runtime: icon + semantic border/status.
- Validation: inline text + semantic border.
- Selection: outline/ring.

Priority:

1. Validation/error.
2. Runtime.
3. Selection.
4. Category/source.

X Builder state families:

- neutral: idle, unused, not judged.
- active/info: judging, importing, refreshing.
- success: saved, imported, copied, judge complete.
- warning: partial, low evidence, stale metrics.
- danger: failed, invalid, excluded.
- uncertain: missing metrics, deterministic-only.

## Accessibility

Required token support:

- 2px focus ring.
- 2px focus offset.
- minimum touch target 24px.
- ideal touch target 44px for future mobile.
- high contrast overrides.
- reduced motion.
- selection color.

Design requirements:

- Score bars include label and value.
- Badges include text.
- State indicators include icon/text, not color alone.
- Candidate cards can be keyboard selected.
- Table rows can be keyboard navigated and selected.

## Localization And Content Resilience

Day one is English-only, but layout must survive:

- long post text.
- 130% longer labels.
- long account handles.
- long imported metric labels.
- long Codex judge notes.

Rules:

- Truncated text must have access to full text in implementation.
- Buttons use flexible padding, not fixed text widths.
- Dates, times, and numbers use locale-aware formatting.
- Use logical CSS properties where direction matters.

## Review Gate 1 Checklist

Approve or change:

1. Dark ops-console default.
2. X-adjacent blue/cyan reference scale.
3. Cool tinted neutral scale.
4. Geist + JetBrains Mono.
5. 32px controls and 36px rows.
6. Explicit memory/usage-state token family.
7. No gradients/glow/decorative background tokens.
