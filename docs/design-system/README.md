# Design System

This document is the root UI contract for all feature specs.

## Active Pipeline

The product design system pipeline was restarted after the first visual artifacts failed the quality bar. Active outputs:

- [Product Design Brief](./product-design-brief.md)
- [Product Foundations](./product-foundations.md)
- [Product Tokens CSS](./product-tokens.css)
- [Product Components](./product-components.md)
- [Product Component Specimen](./product-components.html)
- [Product Patterns](./product-patterns.md)
- [Product Screens](./product-screens.md)
- [Product Screens HTML](./product-screens.html)
- [Validation Report](./validation-report.md)

Current gate: final approval for phase 1 implementation.

## When This Runs

Run design-system planning before the first `product-flow-spec`, then update it whenever a flow spec needs a new reusable component, state pattern, token, or interaction convention.

Sequence:

```txt
feature idea
  -> product-flow-map
  -> design-system check/update
  -> product-flow-spec
  -> arch-recon
  -> tickets
```

Design system is not a one-time polish pass. It is the shared vocabulary that flow specs must reference.

## Product Direction

X Builder is an internal post recommendation workbench. It should feel dense, practical, and fast. It is not a landing page, content calendar, or marketing dashboard.

Primary UI qualities:

- Operational.
- Scannable.
- Evidence-first.
- Low decoration.
- Clear about confidence and uncertainty.

## Root Navigation

Initial app tabs:

- Writer.
- Voice.
- Post Library.
- Settings.

Later tabs:

- My Analytics.
- Signals.

## Component Baseline

Feature specs should reference these components by name:

- `AppShell`
- `SidebarNav`
- `TopStatusBar`
- `PageHeader`
- `Button`
- `IconButton`
- `Textarea`
- `Input`
- `Select`
- `Tabs`
- `Dialog`
- `Drawer`
- `Tooltip`
- `Badge`
- `ProgressBar`
- `ScoreBar`
- `DataTable`
- `Switch`
- `Slider`
- `Toast`
- `EmptyState`
- `Skeleton`
- `InlineError`
- `CandidateCard`
- `JudgePanel`
- `PostTextPreview`
- `UsageStateBadge`
- `KnownPostsTable`
- `VoiceProfileEditor`
- `ImportPreviewTable`

## State Patterns

Every screen spec must cover:

- Ideal.
- Empty.
- Loading.
- Error.
- Partial.

## Accessibility Baseline

- One `h1` per route.
- `nav` for global navigation.
- `main` for route content.
- `aside` for inspectors.
- All dynamic generation/judging results use `aria-live="polite"`.
- Errors use `aria-live="assertive"`.
- Icon-only buttons require labels and tooltips.
- Score bars include text values and never rely on color alone.
- Keyboard focus must be visible.

## Copy Rules

Scores must be labeled as:

```txt
Heuristic rank, not prediction.
```

LLM output must be labeled as:

```txt
Codex judge
```

When Codex is unavailable:

```txt
Codex judge unavailable. Deterministic scoring still ran.
```
