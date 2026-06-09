# What We Are Building

X Builder is a local internal workbench for deciding what to post on X.

The product has one purpose: take an idea, understand the user's voice and evidence, generate strong post candidates, score them, judge them, and preserve the results so future recommendations get better.

This is not a marketing dashboard, content calendar, or generic social media tool. It is an operator console for one founder writing sharp X posts.

## Day-One Product

Day one should prove the loop locally:

1. The user opens a simple local UI.
2. The user writes an idea.
3. The deterministic engine generates and scores candidates.
4. The backend calls Codex through a `codex exec` adapter for LLM writing or judging.
5. The UI shows deterministic and LLM outputs separately.
6. The user chooses, copies, saves, or marks a post for later.
7. The run is persisted so the product can learn from it later.

## Architecture Direction

The backend calls Codex directly. We are not building a day-one engine CLI just so the app can call itself.

```txt
UI
  -> backend
       -> deterministic engine
       -> CodexAdapter
            -> codex exec
       -> storage
```

There can be a CLI later for developer ergonomics, batch work, or automation. It is not part of the first product path.

## LLM Direction

Day one has one LLM execution path:

```txt
writer = codex-cli
judge = codex-cli
fallback = deterministic
```

Important rules:

- Deterministic scoring always runs.
- LLM judging is additive, not a replacement for deterministic scoring.
- If Codex is unavailable, the product still shows deterministic candidates and explains that Codex judge is unavailable.
- We do not silently route app LLM calls through a ChatGPT subscription.
- Later, we may add provider adapters for OpenAI API, OpenRouter, Gemini, Groq, Nvidia, Ollama, or others.

## Core Loop

```txt
idea
  -> candidate generation
  -> deterministic scoring
  -> Codex judge
  -> user selection
  -> post saved / copied / marked published
  -> later X metrics imported
  -> feedback loop updates recommendations
```

The loop only becomes valuable if we persist each step:

```txt
idea
  -> candidates
  -> scores
  -> judge result
  -> selected post
  -> published X URL
  -> post metrics
  -> learned signal
```

## Recommendation Modes

The writer should propose posts in three formats:

1. One-liners / founder truths.
2. Lessons / mini-framework posts.
3. Engagement / debate / founder question posts.

The interaction is two-step:

1. Propose one candidate per format.
2. After the user chooses a format, propose three more variants in that same format.

Every candidate should show:

- deterministic reach score
- deterministic engagement score
- deterministic impressions score
- deterministic voice-match score
- overall heuristic rank
- Codex judge recommendation when available
- reasons, risks, and suggested rewrite when available

Scores must be labeled as:

```txt
Heuristic rank, not prediction.
```

LLM output must be labeled as:

```txt
Codex judge
```

## Voice And Evidence

Voice profile is core, not optional. Without voice, "best X post" becomes generic.

The product needs:

- imported posts
- selected posts for voice extraction
- editable voice profile
- examples of voice
- phrases to avoid
- known unused posts
- external signal posts
- run history

The engine should use voice and known posts as evidence, but must avoid copying external accounts. Borrow structure, not content.

## Phase 1 Outcome

Phase 1 is complete when the local app can:

- run with a backend, client, shared schemas, and storage boundary
- display shell readiness for engine, Codex, and storage
- import known posts manually
- extract and edit a voice profile
- generate and score candidates deterministically
- call Codex through the adapter
- write first-pass candidates and same-format variants
- judge candidates with Codex
- persist run history and known-post usage state

## Phase 2 Outcome

Phase 2 is complete when the app can:

- import the user's X posts and metrics
- persist metric snapshots
- compare generated and published posts against outcomes
- update scoring and recommendations from the user's analytics
- import external accounts and metrics
- extract reusable signal from external posts
- turn external signal into constraints without copying

## Later Outcome

A later publishing/export workflow should close the loop:

- copy to clipboard
- mark as published
- paste X URL
- connect generated candidate to real X post metrics
- update run history with outcomes
