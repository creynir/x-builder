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

**Next build queue:**

1. [`smarter-generation-context`](./smarter-generation-context/) - send the LLM only the requested format's playbook slice plus a tight voice sample instead of the whole knowledge base.
2. [`llm-chain-budget-rate-guard`](./llm-chain-budget-rate-guard/) - cap multi-call generate/apply chains and add basic protection around LLM-spawning bindings.
3. **Refactor hotspots** — split `engine/src/server/server.ts` and `overlay/src/compose/compose-cockpit.tsx` after behavior is pinned.

**Planned feature areas:**

- [`external-feedback-loop`](./external-feedback-loop/) — external or hosted feedback-signal expansion beyond the local My Feedback Loop
- [`external-x-import-signals`](./external-x-import-signals/) — external reach signals
- `voice-rag-generation` — future vector index / voice retrieval on top of the SQLite store

> Folders removed in the overlay pivot (the SPA writer studio era): `be-ui-shell`, `voice-profile`, `writer-logic`, `my-x-data-import`, `my-x-api-sync`, `post-library-manual-import`, `publish-export`. Voice is now corpus-derived (no standalone voice-profile builder); capture replaces API sync. Ticket files under those older feature trees are historical and should not be used as current product truth without checking the feature README and code.
