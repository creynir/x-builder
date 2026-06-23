---
title: Run X Overlay Browser
description: Get X Builder running for the first time — launch the browser, log into X, and start using the overlay beside the composer.
---

## Run X Overlay Browser

This guide gets X Builder running on your machine for the first time. It launches a dedicated Chromium browser, you log into X as usual, and the X Builder overlay appears beside the composer.

These are steps only. For why the overlay is built this way — the transport seam, the observe-only capture model, the provenance and approval rules — see [X Overlay Browser — Explanation](../features/x-overlay-browser/explanation.md).

## What you need

- **Node.js (LTS)** and **pnpm** installed (`pnpm@9` — the version pinned by this repo).
- A local checkout of this repository with dependencies installed (`pnpm install`).
- An **internet connection for the first run** — the first launch downloads a Chromium browser.
- An **X account** you can log into.

## First run

X Builder ships as a private workspace package in this repository (`@x-builder/runner`). You run it from the repo. Run every command from the repository root.

### 1. Build the packages the runner needs

The runner launches from compiled output, and it loads the overlay from a built bundle. Build both before the first launch:

```sh
pnpm --filter @x-builder/overlay build
pnpm --filter @x-builder/runner build
```

If you skip the overlay build, the launch stops with an error telling you to build `@x-builder/overlay` first.

### 2. Launch X Builder

```sh
node runner/bin/x-builder.js
```

### 3. Let Chromium download (first run only)

On the very first launch, if a Chromium browser is not already installed, X Builder downloads one for you. You will see this line while it works:

```
[x-builder] Chromium not found — running playwright install chromium...
```

This download happens **once**. Later launches reuse it. If the download fails, X Builder prints the command to run yourself:

```sh
npx playwright install chromium
```

Run that, then launch again.

### 4. Log into X

A Chromium window opens at `x.com`. Log in as you normally would. Your login is saved in a dedicated browser profile at `~/.x-builder/browser-profile/`, separate from your regular Chrome or Chromium. You only log in once.

### 5. Confirm the overlay appeared

Once the page loads, the X Builder overlay mounts. Look for the **settings button in the top-left corner** of the browser window — that confirms the overlay is running. In the terminal you will also see:

```
[x-builder] Ready — x.com loaded with overlay.
```

You can now browse X and use the overlay beside the composer.

## Subsequent runs

From the repository root:

```sh
node runner/bin/x-builder.js
```

The browser opens **already logged in** — your session is in the saved profile. There is no Chromium download on later runs. You only need to rebuild a package (step 1) after you change its source.

## Where your data lives

X Builder keeps everything under `~/.x-builder/`:

| Location | What it holds |
| --- | --- |
| `~/.x-builder/browser-profile/` | The dedicated browser session — cookies and your X login |
| `~/.x-builder/engine-settings/` | Your settings and the post corpus that grows as you browse (`post-library.json`) |

Neither directory is read by anything other than X Builder, and neither is sent anywhere. To start completely fresh, stop X Builder and delete the relevant folder — deleting `browser-profile/` logs you out; deleting `engine-settings/` clears your corpus and settings.

## Importing your X archive (optional)

You do not have to wait for the corpus to grow through browsing. If you have downloaded your X data archive, you can import it in one step and give the engine your full post history immediately.

1. Click the **settings button** (top-left of the browser window).
2. Find the **Archive** section.
3. Click **Upload archive** and select the `tweets.js` file from inside your downloaded X archive.

The file is validated and imported. If the file is rejected, the panel shows the reason inline and leaves the picker ready so you can try again.

## If the overlay stops appearing

X occasionally changes the structure of its page. If the overlay's buttons and annotations stop appearing, open the **settings panel**. If X Builder detected a page-structure change it could not adapt to, you will see:

```
X layout changed — affordances paused
```

This is a known limitation. The engine and all analysis still work — only the overlay's on-page buttons and annotations are paused until an updated build ships. Browsing, your saved corpus, and settings are unaffected.

> **Note on a one-command launch.** A published `npx x-builder` experience (no clone, no build) is the intended future shape, but it is not available yet — the package is private and runs from this repository. Use `node runner/bin/x-builder.js` from the repo root as described above.

<!-- Tickets: XOB-032 (+ XOB-015/030/033) — last verified 2026-06-23 -->
