---
status: done
labels: [test]
---

# XOB-032: [DOC] Overlay Architecture + X-Policy Boundary + One-Command Setup + Provenance/Approval/Explainer

Depends on: XOB-030, XOB-031

## Goal

Produce documentation that lets a new contributor understand how X Builder's overlay works, why it is built the way it is, and how to run it for the first time — without reading any source code. The docs should also make the X policy boundary unambiguous so contributors know exactly what the system is and is not allowed to do.

## Target Pages

| Path | Diataxis quadrant | Purpose |
|---|---|---|
| `docs/features/x-overlay-browser/explanation.md` | **Explanation** | Why the system is built this way: the transport seam, the observe-only capture model, the two-state provenance model, the approval rule, the X policy boundary |
| `docs/how-to/run-x-overlay-browser.md` | **How-To** | How to run X Builder for the first time, log in, and start using the overlay |

---

## Page 1 — `docs/features/x-overlay-browser/explanation.md`

**Diataxis quadrant: Explanation**

This page explains the system's design decisions to someone who has read the feature description but wants to understand the reasoning. Use plain language. Do not list symbol names or TypeScript types as the primary mode of explanation — describe what the user sees and what the system does, then name the relevant component once if helpful.

### Topics to cover

**The v1 transport seam — exposeFunction today, HTTP later**

X Builder runs inside a regular Chromium browser window. The overlay (the panel that appears beside the X composer) needs to talk to the local engine (the analysis and generation logic running on the user's machine). In v1, this connection uses a Playwright mechanism called `exposeFunction`: the engine registers a set of named functions that the overlay can call, and Playwright routes those calls over the browser's internal debugger pipe — no network port, no CORS headers, no x.com firewall.

The 17 functions the overlay can call are defined in a single interface (`EngineTransport`). All data crosses the boundary as plain JSON. This means a future browser extension version (MV3) can swap in a different transport that sends the same JSON over `localhost` HTTP or extension messaging — the overlay's component code does not change at all, only the one file that wires up the transport.

**Observe-only capture — what the system reads and what it does not**

When the user browses X, X's own page code fetches their recent posts to display them. X Builder watches for those responses as they arrive and reads the post data from them. It does not send any requests of its own to X's servers, does not authenticate with X's API, and does not paginate or scroll the page automatically to load more posts.

Each browsing session typically yields around 20 posts. These accumulate locally across sessions — each session adds to a local file (`~/.x-builder/engine-settings/post-library.json`) so the corpus grows over time and improves the quality of analysis and suggestions.

**The X policy boundary — in scope vs out of scope**

The distinction the overlay respects is between "reading content the page already has" and "acting on X on the user's behalf."

In scope: reading posts that are already visible, scoring a draft the user is writing, suggesting post ideas, filling the composer with a suggestion after the user explicitly clicks a button.

Out of scope (not built, not planned): sending any request to X that the user did not trigger by browsing, posting or liking or following automatically, reading direct messages, running any action without an explicit user gesture.

The overlay fills the composer only when the user clicks. Posting is always the user's own action.

**The two whole-post states — green (generated) and blue (user-written)**

The overlay tracks whether the text in the composer came from X Builder or from the user. This is the provenance model.

A post is "generated" (shown with a green background) when the text in the composer exactly matches the last text that X Builder produced — either from the generate buttons or from "Apply all suggestions." When the user edits that text, even by one character, the post immediately becomes "user-written": the green background disappears, the blue inline annotations from the judge appear, and the "Apply all suggestions" button comes back.

The system never re-improves its own output. "Apply all suggestions" only appears on user-written text. Once X Builder generates something and the user applies it, the button is hidden until the user edits the text themselves.

**The "approved" rule and `deriveApproved`**

The judge scores a post from 0 to 100. Any post that scores 70 or above is considered "approved." The overlay shows "✓ Judge approved" based on this rule, and the same rule is applied consistently whether X Builder is pre-judging a generated candidate, running "Apply all suggestions," or the user triggers a judge check manually. The rule lives in one shared function (`deriveApproved`) so it is impossible for the overlay to apply a different threshold than the engine.

**Blue inline annotations — what they are and what they are not**

When the judge finishes analyzing a user-written post, it returns not just a score but also a list of specific phrases in the draft that it flagged. The overlay finds each phrase in the composer text and draws a blue underline beneath it. Hovering over the phrase shows the judge's note.

These highlights are not always present: they disappear when the post is in the "generated" state, when the judge has not run yet, or when a phrase the judge flagged has since been edited out. Silently disappearing when the text changes is intentional — the overlay does not block the user from typing.

**The metric explainer — making scores legible**

Both the static engine scores and the 13 judge dimensions come with a "what it means / how to read it" popover. This is intentional: the scores are only useful if the user understands what they measure. The popover explains the direction of each score (for "negative risk," lower is better; for "voice match," higher is better) and includes a plain-language scale. The copy ships with the overlay but can be updated by the engine without a UI release.

---

## Page 2 — `docs/how-to/run-x-overlay-browser.md`

**Diataxis quadrant: How-To**

This page tells the user exactly what to do to get X Builder running for the first time. Steps only. No design rationale.

### Topics to cover

**What you need**

- Node.js (LTS) and `pnpm` installed, or `npx` available
- Internet connection for the first run (downloads Chromium)
- An X account you can log into

**First run**

1. Run `npx x-builder` (or `pnpm x-builder` in the repo).
2. On the first run, X Builder downloads a bundled Chromium browser (~150 MB). This only happens once.
3. A Chromium window opens. Log into X as you normally would. Your login is saved in a dedicated profile at `~/.x-builder/browser-profile/` — separate from your regular Chrome or Chromium installation.
4. Once logged in, the X Builder overlay appears. You will see the settings button in the top-left corner of the browser window.

**Subsequent runs**

Run `npx x-builder` again. The browser opens already logged in. No Chromium download on subsequent runs.

**Where your data lives**

- Browser session (cookies, login): `~/.x-builder/browser-profile/`
- Post corpus and settings: `~/.x-builder/engine-settings/`
- Neither directory is read by anything other than X Builder. Neither is sent anywhere.

**Importing your X archive (optional)**

Click the settings button (top-left). Under "Archive," upload your downloaded X archive `.zip` file. This gives the engine your full post history immediately, without waiting for the corpus to grow through browsing sessions.

**If the overlay stops appearing**

X occasionally changes the structure of its page. If the overlay affordances stop appearing, check the settings panel — it will show "X layout changed — affordances paused" if the overlay detected a structural change it could not adapt to. This is a known limitation. The engine and all analysis still work; the overlay UI affordances are paused until a selector update ships.

## Pipeline Log

### 2026-06-23 — DONE (White, doc-pipeline)
- Two pages written, verified against shipped behavior:
  - `docs/features/x-overlay-browser/explanation.md` (Explanation) — transport seam, observe-only capture, X policy boundary, provenance two-state model, the 70+ approval rule, blue annotations, metric explainer. **Folded in (Crimson L1):** a contributor note that the in-page transport trusts the authenticated x.com session (local-first single-user trust model).
  - `docs/how-to/run-x-overlay-browser.md` (How-To) — first run, login, data locations, archive import, recovery.
- **Corrected aspirational claim (White facts-only):** the draft's `npx x-builder` is not yet runnable (`@x-builder/runner` is a private workspace package). Documented the REAL launch — build overlay+runner, then `node runner/bin/x-builder.js` — with `npx x-builder` labeled an explicit future. Cross-links made relative (no docs site generator per Project Profile).
