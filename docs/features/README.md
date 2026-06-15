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

- `be-ui-shell`
- `post-library-manual-import`
- `voice-profile`
- `deterministic-engine`
- `codex-adapter`
- `writer-logic`
- `llm-judge`
- `my-x-data-import`
- `my-feedback-loop`
- `external-x-import-signals`
- `external-feedback-loop`
- `publish-export`
- `founder-story-reach`
