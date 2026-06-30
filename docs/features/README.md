# Feature Docs

Each feature owns the same documentation shape:

```txt
docs/features/[feature]/
  map/
  spec/
  tickets/
  architecture/
```

## Workflow

For UI-bearing features:

```txt
product-flow-map
  -> design-system update/check
  -> product-flow-spec
  -> arch-recon
  -> tickets
```

For backend-only features:

```txt
arch-recon
  -> tickets
```

## Features

**Built (in the overlay product):**

- [`x-overlay-browser`](./x-overlay-browser/) — the overlay runner, capture, and transport seam (the product itself)
- [`deterministic-engine`](./deterministic-engine/) — instant rule-based reach prediction + Post Coach
- [`reach-model-upgrade`](./reach-model-upgrade/) — the format-dominant reach model
- [`founder-story-reach`](./founder-story-reach/) — reach playbook / format taxonomy grounding
- [`llm-judge`](./llm-judge/) — the 13-dimension on-demand judge
- [`codex-adapter`](./codex-adapter/) — the CLI provider layer (codex / claude / cursor)
- [`generation-and-judge-surface`](./generation-and-judge-surface/) — generate, apply-all, annotations, account profile
- [`my-x-archive-import`](./my-x-archive-import/) — `tweets.js` import (the optional fast-start corpus source)
- [`local-persistence-foundation`](./local-persistence-foundation/) — local SQLite corpus store + one-time JSON migration
- [`my-feedback-loop`](./my-feedback-loop/) — local predicted-vs-actual feedback over captured post performance
- [`llm-chain-budget-rate-guard`](./llm-chain-budget-rate-guard/) — chain budgets for multi-call LLM flows plus runner-side LLM binding protection
- [`voice-rag-generation`](./voice-rag-generation/) — local voice retrieval projection on the SQLite corpus for generation grounding
- [`smarter-generation-context`](./smarter-generation-context/) — requested-format playbook slices plus bounded voice samples for generation
- [`generation-category-panel`](./generation-category-panel/) — bounded left-side generation category panel with internal scroll
- [`external-x-import-signals`](./external-x-import-signals/) — observe-only external X signal ledger
- [`external-feedback-loop`](./external-feedback-loop/) — sanitized external pattern guidance for generation
- [`reply-composer-context`](./reply-composer-context/) — same-dialog reply detection and safe reply body split/merge through the existing cockpit
- [`archive-voice-skill`](./archive-voice-skill/) — explicit local voice skill/profile derived from the user's own corpus for post and reply generation

**Next build queue:**

1. [`labeled-corpus-memory`](./labeled-corpus-memory/) — add post/reply labels, parent context, generated-content exclusion, and grounded fact/belief projections to local RAG memory.
2. [`reply-thread-context`](./reply-thread-context/) — capture the available root/parent/ancestor reply graph for parent-aware replies.
3. [`reply-variant-assistant`](./reply-variant-assistant/) — replace post-like reply generation with 3-4 parent-aware variants drafted from a grounded reply plan and a generated-reply ledger.
4. [`unified-generation-context`](./unified-generation-context/) — make posts and replies consume the shared voice skill and labeled memory with task-specific context policies, including dual retrieval for reply grounding vs voice.

**Planned feature areas:**

- [`agent-operator-skill`](./agent-operator-skill/) - agent-run setup and operating skill so users do not manually bootstrap, launch, inspect, and explain the local system
- **Refactor hotspots** — split `engine/src/server/server.ts` and `overlay/src/compose/compose-cockpit.tsx` after behavior is pinned.
- **Reach model follow-ups** — `RMU-021` compact candidate summary chip and `RMU-022` advanced-context weighting.

> Folders removed in the overlay pivot (the SPA writer studio era): `be-ui-shell`, `voice-profile`, `writer-logic`, `my-x-data-import`, `my-x-api-sync`, `post-library-manual-import`, `publish-export`. Voice is now corpus-derived (no standalone voice-profile builder); capture replaces API sync. Ticket files under those older feature trees are historical and should not be used as current product truth without checking the feature README and code.
