---
status: done
---

# XOB-015: BrowserController + RunnerApp bootstrap — persistent context, `addInitScript`, one-command, first-run install

## Implementation Details

**Package:** `@x-builder/runner`

**Files:**

- `runner/src/browser-controller.ts` — exports `BrowserController`
- `runner/src/runner-app.ts` — exports `RunnerApp`
- `runner/bin/x-builder.ts` — the CLI entry point (registered as the `x-builder` bin)

### BrowserController

```ts
class BrowserController {
  static async launch(options: {
    userDataDir: string;  // default: path.join(os.homedir(), ".x-builder", "browser-profile")
    channel: "chromium";  // v1 always chromium
  }): Promise<BrowserContext>
}
```

**Behavior:**

1. Call `playwright.chromium.launchPersistentContext(options.userDataDir, { channel: options.channel, headless: false })`.
2. **First-run Chromium install:** If the launch throws an error whose message matches the Playwright "Executable not found" / "Please run `playwright install`" pattern:
   - Print a single progress line: `"[x-builder] Chromium not found — running playwright install chromium..."`.
   - Spawn `npx playwright install chromium` (or the equivalent `playwright.install({ browser: 'chromium' })` programmatic API if available in the installed version) with `stdio: 'inherit'` so the user sees Playwright's own progress output.
   - If the child process exits with non-zero status → print a one-line failure message: `"[x-builder] Browser install failed. Run: npx playwright install chromium"` and throw a `BrowserInstallError` (a typed subclass of `Error` with `code: "browser_install_failed"`). Do not hang or retry indefinitely.
   - If install succeeds → retry `launchPersistentContext` once. Let any second failure propagate as-is.
3. Return the `BrowserContext`.

**No overlay injection here** — `addInitScript` is `RunnerApp`'s responsibility, keeping `BrowserController` testable in isolation.

### RunnerApp

```ts
class RunnerApp {
  constructor(options?: RunnerAppOptions)  // reads defaults from ~/.x-builder/engine-settings
  async start(): Promise<void>
  async stop(): Promise<void>
}
```

**`start()` sequence (strict order):**

1. Construct engine services in-process from `~/.x-builder/engine-settings` + storage directory (mirror the construction pattern in the existing HTTP server bootstrap: `JsonFileAppSettingsRepository`, `JsonFilePostLibraryRepository`, and all engine services that will be consumed by `ExposeFunctionTransport` in XOB-016 and `LiveCaptureService` in XOB-017). Store service references on `this`.
2. Call `BrowserController.launch({ userDataDir: "~/.x-builder/browser-profile", channel: "chromium" })` → `this.context`.
3. Read the `@x-builder/overlay` prebuilt bundle to string:
   ```ts
   const overlayBundle = fs.readFileSync(
     require.resolve("@x-builder/overlay/dist/overlay.iife.js"),
     "utf-8"
   );
   ```
   Throw a descriptive `OverlayBundleNotFoundError` if the file is missing (overlay package not built).
4. `await this.context.addInitScript({ content: overlayBundle })` — injects once per document (before any script on the page runs). This single call covers all navigations in the context for its lifetime.
5. Get the first page (or create one): `this.page = this.context.pages()[0] ?? await this.context.newPage()`.
6. Call `ExposeFunctionTransport.bindAll(this.page, this.services)` (XOB-016 — called here, not implemented here).
7. Call `GraphQlCaptureObserver.attach(this.context, (batch) => this.liveCaptureService.ingest(batch))` (XOB-017 — called here, not implemented here).
8. `await this.page.goto("https://x.com")`.
9. Log: `"[x-builder] Ready — x.com loaded with overlay."`.

**`stop()` sequence:**

1. `await this.context?.close()`.
2. Any engine teardown (close file handles, flush pending writes via `withSerializedWrite` queue drain).

### Bin entrypoint (`runner/bin/x-builder.ts`)

```ts
#!/usr/bin/env node
import { RunnerApp } from "../src/runner-app.js";

const app = new RunnerApp();

process.on("SIGINT", async () => { await app.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await app.stop(); process.exit(0); });

await app.start();
```

Registered in `runner/package.json`:
```json
{
  "bin": {
    "x-builder": "./bin/x-builder.js"
  }
}
```

The built bin is invocable as `npx x-builder` (after publish) and `pnpm x-builder` (within the workspace).

## Data Models

No new schemas. `RunnerApp` reads `appSettingsSchema` (existing) from `~/.x-builder/engine-settings/settings.json` via `JsonFileAppSettingsRepository`. Storage root defaults to `~/.x-builder/engine-settings/`.

**`RunnerAppOptions`** (internal, not in shared):
```ts
interface RunnerAppOptions {
  engineSettingsDir?: string;  // default: path.join(os.homedir(), ".x-builder", "engine-settings")
  browserProfileDir?: string;  // default: path.join(os.homedir(), ".x-builder", "browser-profile")
  overlayBundlePath?: string;  // default: require.resolve("@x-builder/overlay/dist/overlay.iife.js")
}
```
All options exist for testing only — the bin passes no options (uses defaults).

## Integration Point

**Entry:** `npx x-builder` (production) or `pnpm -F @x-builder/runner start` (dev). Calls `RunnerApp.start()`.

**Terminal outcome:**
- A persistent Chromium context is running with `userDataDir` at `~/.x-builder/browser-profile/`.
- The overlay bundle (`@x-builder/overlay/dist/overlay.iife.js`) is registered as an `addInitScript` and will run on every new document in the context.
- The page is navigated to `https://x.com`.
- All `__xbuilder_*` bindings and the capture observer are active (delegated to XOB-016 and XOB-017 respectively, wired here).
- `SIGINT`/`SIGTERM` shut the context down cleanly.

## Scope Boundaries / Out of Scope

**In scope:**
- `BrowserController.launch` with first-run Chromium install fallback.
- `RunnerApp.start()/stop()` lifecycle: service construction, `addInitScript`, `bindAll` call, observer `attach` call, `page.goto`.
- `bin/x-builder.ts` entry point and signal handling.

**Out of scope (zero-trace — do NOT implement here):**
- The 17 `__xbuilder_*` binding registrations — owned by `ExposeFunctionTransport.bindAll` (XOB-016).
- `GraphQlCaptureObserver` implementation — owned by XOB-017.
- Overlay UI internals — owned by the `@x-builder/overlay` package.
- No real x.com scraping, no auth-header handling, no GraphQL construction.
- No overlay UI components, no DOM inspection from runner code.
- No HTTP server changes (engine Fastify server remains unchanged; runner is a separate process entry point that calls engine services in-process).

## Test Strategy & Fixture Ownership

This ticket does not own normalizer fixtures (those are XOB-014's). The runner E2E lives in `e2e-tests/` and is owned by XOB-031.

**Unit tests** (`runner/src/browser-controller.test.ts`, `runner/src/runner-app.test.ts`, Vitest):

- `BrowserController.launch` with a mock `playwright.chromium.launchPersistentContext` that resolves → returns the mock `BrowserContext`.
- `BrowserController.launch` with a mock that throws "Executable not found" on the first call → verifies `npx playwright install chromium` subprocess is spawned; if the subprocess mock exits 0 and the second launch resolves → resolves normally.
- `BrowserController.launch` with install subprocess mock exiting non-zero → throws `BrowserInstallError`.
- `RunnerApp.start()` with all collaborators mocked (mock `BrowserController.launch`, mock `addInitScript`, mock `ExposeFunctionTransport.bindAll`, mock `GraphQlCaptureObserver.attach`, mock `page.goto`) → verifies call order: launch → addInitScript → bindAll → attach → goto.
- `RunnerApp.start()` when `overlayBundlePath` points to a non-existent file → throws `OverlayBundleNotFoundError` before any binding call.
- `RunnerApp.stop()` → calls `context.close()`.

**Fixture ownership:** none (no GraphQL fixtures needed here).

## Definition of Done

- [ ] `BrowserController` exported from `runner/src/browser-controller.ts`; `RunnerApp` from `runner/src/runner-app.ts`.
- [ ] `bin/x-builder.ts` compiles and is registered in `package.json` `bin`.
- [ ] First-run path: missing Chromium → `[x-builder] Chromium not found — running playwright install chromium...` printed; installs; retries launch.
- [ ] First-run failure: install non-zero exit → single-line failure message printed + `BrowserInstallError` thrown (no hang).
- [ ] `addInitScript` called exactly once per `start()` with the overlay bundle content.
- [ ] All unit tests pass (`pnpm -F @x-builder/runner test`).
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm build` passes; `x-builder` bin resolvable in the workspace.

## Acceptance Criteria

**Given** `RunnerApp.start()` is called with a valid `engineSettingsDir` and a mock `BrowserController` that resolves,  
**When** `start()` completes,  
**Then** the persistent context was launched with `userDataDir` equal to the configured browser profile path, `addInitScript` was called once with the full content of `overlay.iife.js`, and `page.goto("https://x.com")` was called.

**Given** a first-run scenario where the bundled Chromium binary is absent,  
**When** `BrowserController.launch` is called,  
**Then** the progress line `"[x-builder] Chromium not found — running playwright install chromium..."` is printed, the install subprocess runs, and upon success the launch proceeds without error.

**Given** the install subprocess exits with a non-zero status code,  
**When** `BrowserController.launch` processes the result,  
**Then** the one-line failure message is printed to stdout and a `BrowserInstallError` is thrown; the process does not hang.

**Given** the `@x-builder/overlay/dist/overlay.iife.js` file does not exist (overlay package not yet built),  
**When** `RunnerApp.start()` attempts to read the bundle,  
**Then** an `OverlayBundleNotFoundError` is thrown before any binding or navigation call.

## Edge Cases

- Browser profile directory does not exist yet → `launchPersistentContext` creates it (Playwright behavior); `BrowserController` should not pre-create the directory.
- `context.pages()` returns an empty array on first launch (before any navigation) → `RunnerApp` calls `context.newPage()`.
- `addInitScript` must be called before `page.goto` — the sequence in `start()` enforces this.
- Engine settings directory does not exist (genuine first run) → the engine's own repository constructors handle initialization; `RunnerApp` does not pre-create the directory independently.
- `SIGINT` during `page.goto` (user Ctrl+C before x.com finishes loading) → `stop()` is called; `context.close()` should abort the navigation cleanly.
- Multiple calls to `start()` without an intervening `stop()` → second call should throw or be a no-op (guard with `this.started` flag).

**Depends on:** XOB-001, XOB-002

## Pipeline Log

Lean Red-first lane. Build-order seam: XOB-016/017 collaborators don't exist yet, so RunnerApp takes injectable `bindTransport`/`attachObserver` seams with NO-OP production defaults (016/017 replace them) — keeps 015 buildable + testable without forward-referencing unbuilt symbols.

- **Red** (`f13b8df`): `browser-controller.test.ts` (8: happy/launch-opts/install-fallback/non-zero→BrowserInstallError/no-hang/progress+failure lines/unrelated-error-propagates) + `runner-app.test.ts` (12: call-order array equality, addInitScript `{content}`, missing-bundle→OverlayBundleNotFoundError-before-bind/observer/goto, empty-pages→newPage, onBatch→ingest wiring, started-guard, stop→close). Injectable-seam surface specified for Green (`_launch`/`_install` testSeams; `launchBrowser`/`bindTransport`/`attachObserver`/`services`). RED via 2 missing modules; XOB-014 still 20/20; `rg "XOB-"` clean.
- **Gates** (post-Red, base `3e7f466`): `[scope]` + `[ticket-ids]` CLEAN.
- **Green** (`c56b037`): `BrowserController.launch` (real `chromium.launchPersistentContext` default + first-run install fallback + `BrowserInstallError`, no retry-loop) + `RunnerApp` (strict start() order, `existsSync` bundle guard before bind/observer/goto, `addInitScript({content})`, `pages()[0] ?? newPage()`, `onBatch → services.liveCapture.ingest`, `started` guard, `stop`) + NO-OP bind/observer defaults + `createServices` default (real `JsonFileAppSettingsRepository`/`JsonFilePostLibraryRepository`/`LiveCaptureService`) + `bin/x-builder.js` shim (SIGINT/SIGTERM). Minimal engine barrel exports (2 repo constructors + `PostLibraryStorageError` + types; server.ts untouched) + runner→`@x-builder/overlay` dep. 40 tests, typecheck 10/10, build green.
- **Gates** (post-Green, base `f13b8df`): `[suppressions]`/`[ticket-ids]`/`[stubs]`/`[ui-tokens]` CLEAN; `[slop] console.log ×3` ruled justified (spec-mandated CLI progress/failure/ready output; bare-console is the repo convention; no eslint).
- **Blue (Validate Green)**: APPROVE — call-order/install-fallback/guards correct, bind/observer defaults genuine no-ops, engine server diff empty, typecheck+build honest (cache-bypassed both packages), bin executable + resolves.
- **Yellow (intent)**: APPROVE — deliverable real (real launch + install fallback + real overlay-bundle resolve), seam honesty (onBatch→ingest genuinely wired + tested), ZERO-TRACE verified (no `__xbuilder_*`/observer/GraphQL/auth/DOM/fetch; only `page.goto`), engine minimal-export only, wiring-ready for 016/017.

### Concerns Ledger (non-blocking)
- **Runner tsconfig compiles `*.test.ts` into `dist/`** (pre-existing from XOB-014; `include: src/**/*.ts`). Dead weight in the build output (bin imports only `dist/runner-app.js`, unaffected). Candidate CHORE cleanup: exclude test files from the runner build (`tsconfig` `exclude` or a separate test tsconfig).
- **`onBatch` seam typed `(batch: unknown) => unknown`** vs XOB-017's planned `(CaptureIngestRequest) => Promise<void>` — deliberately permissive foundation seam; XOB-017 narrows it. No action.
- Status → **done**.
