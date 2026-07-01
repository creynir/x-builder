# Reply Variant Assistant Feature Inventory

## Problem Frame

- **Problem statement:** Reply mode currently behaves like post generation: category rail, judged candidates, auto-select/write, Post Coach surfaces, and feedback recording. A user replying on X needs contextual reply options they can choose and edit without x-builder scoring or posting for them.
- **Primary audience:** The x-builder operator composing replies inside the native X reply dialog.
- **Success metrics:** reply assistant opens only in valid reply mode; generation returns 3-4 parent-aware variants; choosing a variant writes only the authored body into the native composer; generated replies are recorded for future RAG exclusion; normal post generation remains unchanged.
- **Guardrails:** no auto-posting; no reply reach estimate, Post Coach, LLM judge, apply-all, or post-style category rail as the primary reply UI; no invented thread context; generated replies never become voice evidence.
- **Constraints:** React shadow-DOM overlay, existing `ComposeCockpit` split/merge safety, existing `EngineTransport`, shared Zod schemas, local SQLite engine storage, observed-only reply thread context.
- **Decision principles:** preserve native composer editing, fail closed when parent/thread context is incomplete, separate factual grounding from voice examples, keep reply UI choose-first rather than score-first.

## Personas

### Replying Operator

- **Role:** Writes replies from the live X composer.
- **Goal:** Quickly get a few context-aware reply options, choose one, and edit before posting manually.
- **Context:** Uses x-builder while an X reply dialog is open; expects native X composer behavior to remain in control.
- **Source:** Issue #4 and `docs/features/reply-variant-assistant/README.md`.
- **Confidence:** High.

### Future Memory Builder

- **Role:** Uses generated-content exclusions to protect the local voice/RAG corpus.
- **Goal:** Avoid treating generated replies as authored evidence when the same text is later imported or captured.
- **Context:** Local memory projections and archive/live capture classify corpus evidence.
- **Source:** `docs/features/labeled-corpus-memory/README.md`.
- **Confidence:** High.

## JTBD Feature Mapping

| JTBD Step | What the user does | Reply Variant Assistant features |
|---|---|---|
| Define | Starts from an active X reply target | Reply-mode detection and context panel |
| Locate | Reviews parent/thread context | Observed parent/thread context summary with incomplete diagnostics |
| Prepare | Requests reply help | Reply-specific generate action and reply plan contract |
| Confirm | Chooses a variant | Variant list with distinct reply moves and no scoring UI |
| Execute | Writes selected draft | Native composer write preserving split/merge safety |
| Monitor | Sees write/record status | Generated-reply ledger status, non-blocking failure state |
| Modify | Edits in native composer | User edits remain native authored content |
| Conclude | Posts manually in X | No auto-posting; generated ledger records the chosen generated body |

## IA / Content / Service Notes

### Information Architecture

| Section / Screen | Parent | Primary Nav? | Label Risk | Notes |
|---|---|---:|---|---|
| Reply Assistant Pin | X reply dialog | No | Low | Replaces post generation rail only when `replyContext` exists. |
| Parent/Thread Context Summary | Reply Assistant Pin | No | Medium | Must say context is observed, not complete truth. |
| Variant Chooser | Reply Assistant Pin | No | Low | The primary reply UI; no scoring language. |
| Generated Reply Ledger Status | Reply Assistant Pin | No | Medium | Must avoid implying user-authored evidence. |

### Content Model

| Content Type | Key Fields | Owner | Appears In | Gaps |
|---|---|---|---|---|
| Reply context | target author, target text, status/url, leading handle state, thread diagnostics | `ReplyComposerContext` | Context summary, generate request | Full thread may be absent. |
| Reply plan | grounded facts/beliefs, similar-situation voice examples, context diagnostics | Engine reply generator | Generation contract | Needs new shared schema. |
| Reply variant | id, text, reply move, grounding notes, warnings | Engine reply generator | Variant chooser | Should not include judge/verdict fields. |
| Generated reply ledger entry | text hash, body text, source context, chosen variant id, timestamps | Engine storage | Ledger status and RAG exclusion | Needs DB table/repository. |

### Service Dependencies

| User Step | Visible System Response | Backstage Process | Owner | Risk |
|---|---|---|---|---|
| Open reply composer | Assistant appears only with valid reply evidence | `AnchorLayer` produces `replyContext` | Overlay | Partial DOM evidence must fail closed. |
| Generate variants | Loading state in reply assistant | Engine builds reply plan and calls LLM | Engine | Missing required context returns `reply_context_incomplete`. |
| Choose variant | Variant body written into native composer | Overlay split/merge write | Overlay | Must preserve deleted structural handle behavior. |
| Record generated reply | Small status badge/alert | Engine ledger insert | Engine | Ledger failure must not block editing. |
| Later corpus import/capture | Generated content excluded | Memory/corpus exclusion checks text hash | Engine | User edits should not be over-excluded unless exact hash matches. |

### Accessibility-Critical Moments

| Flow / State | Risk | Later Test Needed | Notes |
|---|---|---|---|
| Variant chooser | Keyboard users cannot choose variant | Keyboard and focus order | Each variant needs a real button. |
| Async generate | Dynamic result not announced | `aria-live` status | Loading, success, error, and ledger status. |
| Context diagnostics | Missing context hidden visually | Screen reader labels | Diagnostics must be text, not color-only. |
| Native composer write | Focus moves unexpectedly | Focus return test | After choose, focus should remain/return to composer. |

## Feature Inventory

| # | Feature | Description | Persona | JTBD Step | Status | Priority | Source |
|---|---|---|---|---|---|---|---|
| 1 | Split/merge regression pin | Preserve current reply authored-body split and structural handle merge behavior before changing reply UI. | Replying Operator | Execute | Planning | P0 | `reply-composer-context` |
| 2 | Reply-specific assistant shell | Show reply UI only in reply mode and keep post cockpit behavior for normal compose. | Replying Operator | Define | Planning | P0 | Issue #4 |
| 3 | Parent/thread context summary | Show observed parent/thread context and diagnostics without inventing missing text. | Replying Operator | Locate | Planning | P0 | `reply-thread-context` |
| 4 | Reply variant generation contract | Generate 3-4 variants from a reply plan that separates grounded facts/beliefs from voice examples. | Replying Operator | Prepare | Planning | P0 | Issue #4, XActions dual RAG |
| 5 | Variant chooser | Let the user choose one generated reply variant with no scoring UI. | Replying Operator | Confirm | Planning | P0 | Issue #4 |
| 6 | Native composer write | Write only the chosen authored body, preserving native editing and no auto-posting. | Replying Operator | Execute | Planning | P0 | `ComposeCockpit` |
| 7 | Generated reply ledger | Record chosen generated replies for future RAG exclusion. | Future Memory Builder | Conclude | Planning | P0 | `labeled-corpus-memory` |
| 8 | Generated reply exclusion | Exclude exact generated replies from future voice/RAG training evidence. | Future Memory Builder | Conclude | Planning | P1 | `labeled-corpus-memory` |
| 9 | Integration coverage | Prove reply and post modes do not bleed into each other. | Replying Operator | Confirm | Planning | P0 | Issue #4 |

## Gaps Identified

### Missing from code today

- Reply generation has no separate request/response schema from post idea generation.
- Reply UI auto-selects and writes a candidate instead of letting the user choose.
- Reply generation attaches judge verdicts and approved state, which must not be primary reply UI.
- No generated replies ledger or exclusion helper exists.

### Underspecified but bounded

- Exact fact/belief extraction can initially consume the existing generation guidance seam and future labeled-memory projections; the reply contract must preserve the lane separation even if projection data is sparse.
- Ledger matching should start with normalized text hash and conservative exact exclusion; fuzzy/generated-edit promotion is out of scope.

## Recommended Flows

### Critical

1. **Choose and edit a generated reply variant** - core reply assistant flow.
2. **Fail closed on incomplete reply context** - prevents invented parent/thread context.
3. **Exclude generated reply from future RAG evidence** - protects memory quality.

### Important

4. **Normal post compose remains unchanged** - regression guard for existing cockpit.
5. **User edits after choosing variant** - confirms native composer remains source of truth.
