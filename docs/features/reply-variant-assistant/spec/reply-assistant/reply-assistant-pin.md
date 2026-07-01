# Screen: Reply Assistant Pin

## Purpose

Provide a reply-specific assistant inside an active X reply dialog: show observed context, generate 3-4 reply variants, let the user choose one, and record the generated body for future exclusion.

## Route

Panel within the X reply dialog overlay.

## Entry Points

- Mounted by `ComposeCockpit` only when `ComposeContextValue.replyContext` exists.
- Not mounted for ordinary post compose, even when the composer text starts with `@handle`.

## States

### Ideal State

- Header: "Reply assistant" with a small context-ready badge.
- Parent/Thread Context Summary shows target author, target text, and observed parent/root snippets when available.
- Generate button is enabled and labeled "Generate replies".
- Variant Chooser displays 3-4 variants after generation.
- Ledger Status shows "Recorded" after a variant is chosen and ledger write succeeds.

### Empty State

- Valid reply context exists, but no variants have been generated yet.
- Shows context summary, a short instruction line, and the primary `Button` "Generate replies".
- No post category rail, reach estimate, Post Coach, judge panel, or apply-all affordance.

### Loading State

- Generate button uses `Button` loading/disabled state with `aria-busy`.
- Variant area shows `Skeleton` rows sized like variant options.
- Status text in an `aria-live="polite"` region says "Generating reply variants".

### Error State

- `reply_context_incomplete`: `Alert` warning explains that required parent/thread context was not observed; generation is disabled or retry remains unavailable until context changes.
- `generation_failed`: `Alert` danger/warning with retry button; native composer text is untouched.
- Ledger write failure: non-blocking `Alert` warning below variants; choosing/writing remains complete.

### Partial State

- Target context exists but root/parent/ancestors are incomplete: context summary renders available observed text and diagnostics; generation is allowed only for variants whose required context is satisfied by the engine contract.
- Some optional grounding facts or voice examples are unavailable: generator may still return variants with warnings, but UI presents warnings as context notes, not scores.

## Layout

```text
Reply Assistant Pin
├─ Header: title + context badge
├─ Parent/Thread Context Summary
│  ├─ Target author/text
│  ├─ Root/parent/ancestor snippets when observed
│  └─ Diagnostics/warnings
├─ Generate Area
│  └─ Button: Generate replies
├─ Variant Chooser
│  ├─ Variant option 1
│  ├─ Variant option 2
│  ├─ Variant option 3
│  └─ Optional variant option 4
└─ Ledger Status
```

## Interactions

### Generate Replies

- Given: a valid reply context with required parent context complete and no request in flight.
- When: the user clicks "Generate replies".
- Then: the assistant calls the reply generation transport, enters loading, and renders 3-4 variants on success.
- Error: context-incomplete and generation failures are shown in `Alert`; native composer text is unchanged.

### Choose Variant

- Given: variants are visible.
- When: the user clicks a variant's "Use" button or focuses the option and presses Enter/Space.
- Then: x-builder re-reads the live composer split, strips duplicate target handles, writes the authored body into the native composer, returns focus to the composer, and records the chosen generated reply.
- Error: ledger failure shows non-blocking warning; native composer write remains complete.

### Retry Generation

- Given: generation failed with a retryable error.
- When: user clicks "Try again".
- Then: same request state machine restarts using the latest reply context.

## State Machine

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| idle | generate | context complete | loading | call reply generation |
| idle | generate | context incomplete | context_incomplete | show warning, do not call LLM |
| loading | success | 3-4 variants | variants_ready | render chooser, announce results |
| loading | failure | retryable | generation_failed | show retry alert |
| variants_ready | choose | live composer active | writing | write chosen body |
| writing | write complete | ledger available | recording | call ledger record |
| recording | success | - | recorded | show recorded badge |
| recording | failure | - | ledger_warning | show non-blocking alert |

Impossible states: showing reply variants with judge verdicts; showing Post Coach/reach in reply assistant; generated variant chosen without a native composer write attempt.

## Feedback and Recovery

- Generate success: announce "Reply variants ready".
- Context incomplete: persistent warning; no invented context.
- Generation failed: persistent retryable alert; preserve existing input.
- Ledger failed: non-blocking alert; user keeps editing.
- Duplicate target handle in generated text: silently stripped before write.

## Content and Localization

- Primary labels: "Reply assistant", "Generate replies", "Use this", "Recorded".
- Diagnostics must use observed/missing wording, for example "Parent text was not observed".
- Long target text and variant text wrap within panel; no text-only control may overflow.
- Reply text remains user-editable in native X composer; do not label chosen variant as posted.

## Accessibility

- Panel uses `aside` semantics when implemented in React and has an accessible label.
- Loading, success, and ledger states use `aria-live="polite"`.
- Errors use `Alert` with `role="alert"`.
- Tab order: Generate button -> variant options -> retry/status controls -> native composer after choose.
- Variant buttons have accessible names that include ordinal or reply move.
- Focus returns to native composer after choosing a variant.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `Button` | Generate, retry, use variant | `primary`, `secondary`, loading state |
| `Alert` | context incomplete, generation failed, ledger warning | `warning`, `danger` |
| `Badge` | context status, ledger status | `info`, `warning`, `success` |
| `Skeleton` | loading variant rows | existing v2 skeleton |
| `EmptyState` | no variants yet if useful | existing v2 empty state |
| `KeyValueList` | compact context details | existing v2 key-value list |

## Visual AC

- Use existing overlay tokens: `--xb-surface-panel`, `--xb-border-edge`, `--xb-text`, `--text-secondary`, `--interactive-default`, `--focus-ring-color`, `--space-*`, `--radius-md`.
- Dense operational overlay, not a marketing card.
- No purple/indigo-gradient treatment, no decorative blobs, no nested cards.
- Variant options are grouped rows inside the panel; each row has stable dimensions and wraps long text.

## Handoff Notes

- The screen is one mounted reply-mode branch of the compose cockpit, not a new route.
- The primary test surface is observable overlay behavior plus transport calls and native composer writes.
- Yellow validation should reject any Post Coach/reach/judge/apply-all primary reply UI.
