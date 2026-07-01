# Reply Assistant Screen List

## Screens Found

| # | Screen | Type | Route | Referenced In Steps |
|---|---|---|---|---|
| 1 | Reply Assistant Pin | Panel | X reply dialog overlay | Detect, generate, review, choose |
| 2 | Parent/Thread Context Summary | Panel section | within Reply Assistant Pin | Review context |
| 3 | Variant Chooser | Panel section | within Reply Assistant Pin | Review and choose variants |
| 4 | Ledger Status | Inline status | within Reply Assistant Pin | Record chosen generated reply |
| 5 | Native X Composer | External/native composer | x.com reply dialog | Write/edit/post manually |

## Backend Capabilities Discovered

### Existing API / Transport

| Surface | Purpose | UI Implication |
|---|---|---|
| `generateIdeas` | Current post idea generation; accepts optional `replyContext` | Must not remain the primary reply generation contract. |
| `analyzePosts` | Static analysis and reply thread diagnostics | Reply UI may show diagnostics but not Post Coach/reach scoring. |
| `judgeDraft` | Manual judge | Must not be part of primary reply UI. |
| `applyJudgeSuggestions` | Apply-all rewrite | Out of scope in reply assistant mode. |

### Existing Data Models

| Model | Key Fields | UI Implication |
|---|---|---|
| `ReplyComposerContext` | target author/text/status/url, leading target handle, optional thread context | Context summary and fail-closed generation. |
| `ReplyThreadContext` | root, parent, ancestors, previous own replies, diagnostics | Parent/thread context summary. |
| `GenerateIdeaResponse` | exactly 3 candidates with optional verdict/approved | Not suitable as final reply response because reply variants must be 3-4 and unscored. |

### Needed Backend Capabilities

| Capability | UI Implication |
|---|---|
| Reply variant request/response schema | Variant chooser can render 3-4 reply variants without judge fields. |
| Reply plan schema | UI and tests can prove grounded facts/beliefs are separate from similar-situation voice examples. |
| Generated reply ledger insert | Ledger status reflects chosen generated reply recording. |
| Generated reply exclusion helper | Corpus/RAG paths can reject exact generated content hashes. |

## Coverage Check

- Screens that need backend data: Reply Assistant Pin, Parent/Thread Context Summary, Variant Chooser, Ledger Status.
- Backend capabilities with no primary reply UI: Post Coach, reach estimate, LLM judge, apply-all. These are intentionally excluded in reply assistant mode.
- Accessibility-critical states: loading variants, context incomplete, generated results available, ledger warning.

## Recommended Spec Order

1. Reply Assistant Pin - owns layout, states, and interactions for the full flow.
2. Variant Chooser - highest-risk interaction and keyboard path.
3. Ledger Status - small but important memory boundary.

## Paths

- **Design system:** `overlay/src/ui/v2/`
- **Component library:** `Button`, `Alert`, `Badge`, `Skeleton`, `EmptyState`, `KeyValueList`
- **Flow-map context:** `docs/features/reply-variant-assistant/map/`
- **Backend codebase:** `engine/src/llm/`, `engine/src/server/`, `shared/src/schemas/`
