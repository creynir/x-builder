# x-builder

**An AI writing coach that lives inside x.com.** A local Playwright runner attaches to your own logged-in Chrome and injects an overlay onto X's composer: as you write (or generate) a post, you get a live deterministic score, an on-demand LLM judge with inline fixes, and drafts grounded in what actually reaches — all on your machine. It never posts for you; it fills the composer only when you click, and you press **Post** yourself.

It is not a scheduler, a publisher, or a hosted tool. It is a private second opinion that runs over your real X session.

---

## How it works — the loop

```
   browse x.com            score + judge + generate              you decide
 ┌───────────────┐      ┌──────────────────────────┐      ┌──────────────────┐
 │  your posts   │ ───▶ │  static engine (instant)  │ ───▶ │  fill composer   │
 │  (corpus)     │      │  LLM judge (on demand)    │      │  on your click,  │
 │               │      │  generate (grounded)      │      │  you press Post  │
 └───────────────┘      └──────────────────────────┘      └──────────────────┘
        ▲                                                          │
        └──────────────── capture as you browse ───────────────────┘
```

Everything is calibrated to **your** account: your voice, your reach baseline, your posting cadence.

---

## Features

### The corpus — how it's built, and what it gives you

The corpus is a local library of **your own posts**. It is the foundation everything else is calibrated against. There are two ways to build it, and they merge (deduped by post id):

- **Live capture (passive).** While the runner is attached, it watches the GraphQL responses X already fetches as you browse and captures your posts — **`UserByScreenName`** (profile + follower count), **`UserTweets`** / **`UserTweetsAndReplies`** (your posts/replies). It pulls nothing on its own:
  - **Reload your profile** → captures your latest posts (page 1).
  - **Scroll your profile** → captures older posts, page by page — this is how the corpus grows deep.
  - The home feed is **not** captured (different op), and a post you just made only enters the corpus once you reload/scroll your profile so X re-fetches it.
- **Archive import (deep, one-shot).** Import the `tweets.js` from your downloaded X archive to load your **entire post history** at once — no scrolling. See [Importing your X archive](#importing-your-x-archive).

What the corpus powers:

- **Voice** — generation is grounded in your recent real posts so drafts sound like you.
- **Reach baseline** — your trailing performance calibrates the static engine's reach prediction to your account (not a generic curve).
- **Cooldowns** — your format usage over the last 7 days (see below).
- **Account profile for the judge** — derived audience/positioning hints feed the judge's audience-match.

### Static engine (deterministic, instant, as you type)

A rule-based pass that scores the live draft with no LLM and no waiting:

- **Reach prediction** — a stall range, an escape range, and an escape probability, calibrated to your follower count + trailing-median performance from the corpus. (Needs follower data — captured from your profile or imported from the archive.)
- **Post Coach** — concrete checks (hook opener, tension/contrast, quotability, hedging, em-dashes, weak closers, etc.) shown as **Fix** (red) / **Nudge** (yellow), with passing checks collapsed.
- **Static score** — a single 0–100 headline.

### LLM judge (on demand)

A slower, sharper read you trigger with **Run judge** (it never runs on its own — editing the draft resets it, so a verdict always matches the exact text it judged):

- **13-dimension grade** — overall, replies, profile clicks, impressions, bookmark value, dwell, voice match, negative risk, answer effort, stranger answerability, status dependency, reply-vs-quote, audience match. Overall is always shown; the rest collapse.
- **Inline span highlights** — the judge flags weak phrases and underlines them in the composer; hover to see the fix.
- **Strengths & improvements** — collapsible notes.
- **Apply all suggestions** — one click rewrites the draft applying every fix, re-judges it, and only keeps the rewrite if it scores better.

### Generate (grounded in what reaches + your voice)

The buttons on the left write drafts in a chosen format. Each draft is grounded in:

- a **reach playbook** (a knowledge base of which formats travel and why — see `knowledgeBasePath` in [Configuration](#configuration)), and
- **your captured voice** (recent real posts).

Generated drafts are judged automatically, highlighted **green**, and labelled **✓ Judge approved** when they pass — so you can tell at a glance that a draft is machine-written and vetted.

### Cooldowns — don't burn a format

Repeating the same format decays its reach. Each generate button shows a badge — e.g. **`cooldown · 5 in 7d`** — meaning you've posted that format 5 times in the last **7 days**:

- **≥ 4 in 7 days → cooldown** (give it a rest)
- **≥ 2 → warming**
- otherwise **clear**

The count is format-repetition over a rolling 7-day window (deterministic, from your corpus), not an all-time total. Hover for the explanation.

### How you know what works vs what doesn't

Three signals, stacked:

1. **Reach prediction** (static engine) — your odds of escaping your own trailing median, calibrated to your baseline.
2. **The judge's reach-oriented dimensions** — replies, profile clicks, audience match, negative risk, etc., rather than abstract "quality".
3. **The reach playbook** — generation and the cooldown nudges encode a format taxonomy from an observational reach study (recognition formats travel; abstract substance dies at low follower counts; repetition decays reach).

All of these are **heuristics and structured opinions, not guarantees** — a sharper second read before you post, not a prediction of real numbers.

---

## Getting started

### Prerequisites

- **Node.js 20+** and **pnpm 9.15+** (`corepack enable && corepack prepare pnpm@9.15.0 --activate`).
- **Google Chrome**, where you are logged into x.com.
- A **judge CLI** installed and authenticated — one of `codex`, `claude`, or `cursor` (the judge/generate run through it). Codex is the default.

### 1. Install & build

```bash
pnpm install
pnpm build          # builds the overlay bundle the runner injects (required)
```

### 2. Launch Chrome with remote debugging, logged into X

Quit Chrome first (the flag only applies to a fresh launch), then:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

In that window, make sure you're logged into **x.com**.

### 3. Run the overlay runner

```bash
XB_CDP_ENDPOINT=http://127.0.0.1:9222 node runner/bin/x-builder.js
```

The runner attaches to your Chrome over CDP and injects the overlay into the x.com tab. Open a composer and you'll see the rail (generate), the static-engine column, and the AI-judge box. Leave the runner running; it captures your corpus passively as you browse.

### 4. (Recommended) Build a corpus

Scroll your profile so X fetches your posts (the runner captures them), **or** import your archive for the full history at once.

---

## Configuration

Local settings live at `~/.x-builder/engine-settings/settings.json`:

| Field | Purpose |
| --- | --- |
| `judgeProvider` | `codex-cli` \| `claude-cli` \| `cursor-cli` — which CLI runs the judge/generate. |
| `codexModel` / `claudeModel` / `cursorModel` | Model for the chosen provider (e.g. `gpt-5.4-mini`). |
| `knowledgeBasePath` | Absolute path to a markdown **reach playbook** the generator grounds drafts in. Unset → a generic template. |
| `accountProfile` | Optional text describing your audience/positioning (feeds the judge's audience-match). |

Local data:

| Path | Purpose |
| --- | --- |
| `~/.x-builder/engine-settings/settings.json` | The settings above. |
| `~/.x-builder/engine-settings/storage/post-library.json` | Your corpus (captured + imported posts), import summaries, and active archive context. |

No hosted account, remote database, or X publishing token is involved.

---

## Importing your X archive

The archive gives you a deep corpus instantly and the reach/audience baseline the static engine and judge calibrate against.

1. Download and extract your X archive.
2. Validate `data/tweets.js` (shows importable posts, skipped records, duplicates).
3. Import it — your full post history (text, dates, kind, favorite/retweet counts) enters the corpus, deduped against live-captured posts.
4. **Activate** the derived context — this is what turns on the personalized reach baseline (`scoringContext`) and the judge's audience hints. Without activation, scoring stays generic.

`tweets.js` does not carry every metric — impressions, bookmarks, link/profile clicks, quotes, and received replies aren't in that file — so the favorite/retweet counts are used as weak proxies.

---

## Architecture

```txt
overlay/   React shadow-DOM overlay injected into x.com (the product surface)
runner/    Playwright runner — connectOverCDP to your Chrome, injects the overlay,
           captures GraphQL responses, hosts the in-process engine over a transport seam
engine/    Deterministic scoring, the LLM judge/generate/apply services, archive import,
           cooldown/repetition window, settings + post-library repositories
shared/    Zod schemas + TypeScript contracts shared across packages
client/    LEGACY web studio (deprecated). Only client/src/ui (the v2 component
           primitives) is still used — the overlay imports it. The studio app
           (app/features/shell/api) is no longer part of the product. See Notes.
docs/      Feature maps, specs, architecture notes, ticket docs
tools/     Calibration helpers
```

The runner talks to the engine **in-process** through a transport seam (`EngineTransport` ↔ `window.__xbTransport`), so there is no separate API server in the overlay product.

---

## Notes & limitations

- **Never auto-posts.** The overlay fills the composer only on an explicit click; you press Post.
- **Scores are heuristics, not predictions** of real reach.
- **Capture is passive** — a new post enters the corpus only after you reload/scroll your profile; the home feed isn't captured.
- **Legacy studio:** the `client/` web app (the old `/writer` `/voice` `/library` `/settings` studio) is deprecated and not part of the overlay product. Its `ui/` primitives are still shared with the overlay; the rest is dead code pending removal.
- **Tests:** the unit-test suite has drifted from recent overlay/judge/provenance changes and needs a refresh pass.

## Useful commands

```bash
pnpm build       # build all packages (required before running the runner)
pnpm typecheck   # TypeScript checks
pnpm test        # unit/integration tests (currently stale — see Notes)
```
