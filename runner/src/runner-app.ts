/**
 * RunnerApp bootstrap, in one of two modes:
 *
 *  - Launch mode (default): launches a persistent Chromium context, injects the
 *    prebuilt overlay bundle once per document via `addInitScript`, and navigates
 *    to x.com.
 *  - Reconnect mode (a `connectEndpoint` / `XB_CDP_ENDPOINT` is set): ATTACHES to
 *    an already-running Chrome over CDP (`connectOverCDP`) — one the user started
 *    and logged into — and injects the overlay into the live tab. The keychain-
 *    native session lives in that Chrome and is never touched by automation, which
 *    sidesteps the macOS login/Keychain walls.
 *
 * Both modes then wire the (XOB-016) transport and (XOB-017) capture observer
 * through the same injectable seams. Every collaborator `start()` touches is
 * injectable through {@link RunnerAppOptions} so the lifecycle can be tested with
 * no real browser, engine services, or network. The `bindTransport` /
 * `attachObserver` defaults (XOB-030) bind the 24 `__xbuilder_*` engine bindings
 * through {@link ExposeFunctionTransport} and register the
 * {@link GraphQlCaptureObserver} response listener; an injected override still
 * wins, so every seam stays testable.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  FeedbackLoopService,
  ExternalXSignalsService,
  JsonFileAppSettingsRepository,
  LiveCaptureService,
  NodeProcessRunner,
  SqliteFeedbackLoopRepository,
  SqliteExternalXSignalsRepository,
  SqlitePostLibraryRepository,
  StructuredLlmService,
  createSqliteVoiceSampleProvider,
  importPostLibraryJsonToSqlite,
  judgeProviderRegistry,
  openEngineDatabase,
  resolveWorkspaceRoot,
  type ExternalPatternSnapshotReader,
  type PostLibraryRepository,
  type VoiceSampleProvider,
} from "@x-builder/engine";
import { ENGINE_TRANSPORT_BINDINGS } from "@x-builder/shared";
import { chromium } from "playwright";

import { BrowserController } from "./browser-controller.js";
import {
  createBoundEngineServices,
  type StructuredLlmGateway,
} from "./bound-engine-services.js";
import { ExposeFunctionTransport } from "./expose-function-transport.js";
import { GraphQlCaptureObserver } from "./graphql-capture-observer.js";
import { ExternalXSignalsCaptureObserver } from "./external-x-signals-capture-observer.js";
import { type ObserverLike } from "./overlay-readiness.js";
import { assembleTransport } from "./transport-assembly.js";

const require = createRequire(import.meta.url);

declare global {
  interface Window {
    /** Overlay mount entrypoint, assigned by the injected overlay bundle. */
    __xbBootstrap?: () => void;
  }
}

/**
 * Structural surfaces of the Playwright Page/Context the bootstrap actually
 * touches. Typing the seams against these (rather than the full Playwright
 * interfaces) lets a real `BrowserContext` flow through unchanged while keeping
 * the launch/bind/observer seams injectable with lightweight fakes — the launch
 * mock returns a context-like object, not a full driver.
 */
export interface PageLike {
  goto(url: string): Promise<unknown>;
  // Current page URL (real Playwright `Page.url`). Optional/method-syntax like the
  // other members so a structural fake can omit it; reconnect mode uses it to find
  // the x.com tab and to decide whether the live document already needs a goto.
  url?(): string;
  // Page-level init script registration (real Playwright `Page.addInitScript`).
  // Optional on the structural surface: the lifecycle-ordering test fakes a page
  // with only `goto`, so the default overlay-bootstrap seam treats its absence as
  // "no real page to mount into" and skips. A real `Page` always provides it.
  // Method syntax (bivariant param check) so a real `Page.addInitScript` —
  // `<Arg>(script: PageFunction<Arg> | {content}, arg?) => Promise<Disposable>` —
  // is structurally assignable here. The function-form `script` arg is `unknown`
  // (bivariance accepts Playwright's `Unboxed<Arg>` transform); the caller pins
  // the concrete arg type at the call site.
  addInitScript?<Arg>(
    script: ((arg: unknown) => unknown) | { content: string },
    arg?: Arg,
  ): Promise<unknown> | unknown;
  // Evaluate a function or string expression in the page (real Playwright
  // `Page.evaluate`, whose `PageFunction` is `string | Function`). Optional for the
  // same structural-fake reason as `addInitScript`. Method syntax so the real
  // `Page.evaluate` overloads stay structurally assignable.
  evaluate?<R>(pageFunction: string | ((arg: unknown) => R), arg?: unknown): Promise<R>;
  // Emulate page media features (real Playwright `Page.emulateMedia`). Optional on
  // the structural surface (the lifecycle-test fake omits it). Used to CLEAR the
  // forced color scheme so X follows the user's real OS appearance instead of
  // Playwright's default light emulation (which left x.com rendering white).
  emulateMedia?(options?: {
    colorScheme?: "light" | "dark" | "no-preference" | null;
  }): Promise<unknown> | unknown;
}

export interface BrowserContextLike {
  addInitScript(script: { content: string }): Promise<unknown> | unknown;
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
  close(): Promise<unknown> | unknown;
}

/**
 * Minimal surface of the Playwright `Browser` the reconnect path touches. A
 * `connectOverCDP` browser owns the live Chrome the user started; `close()`
 * DISCONNECTS the CDP session without closing that Chrome or its tabs. Typed
 * structurally so a real `Browser` flows through and a fake stands in for tests.
 */
export interface BrowserLike {
  contexts(): BrowserContextLike[];
  close(): Promise<unknown> | unknown;
}

/**
 * The in-process engine service bundle the runner hands to its seams. The runner
 * itself only touches `liveCapture` (the observer's onBatch forwards a captured
 * batch into `liveCapture.ingest`); XOB-016 binds the rest through the transport.
 * The production factory adds the readily-constructable repositories so XOB-016
 * has them to wire, but they are optional on the type so a test can inject a
 * minimal `{ liveCapture }` bundle.
 */
export interface LiveCaptureLike {
  ingest(batch: unknown): unknown;
}

export interface EngineServices {
  liveCapture: LiveCaptureLike;
  settingsRepository?: JsonFileAppSettingsRepository;
  postLibraryRepository?: PostLibraryRepository;
  feedbackLoopService?: FeedbackLoopService;
  externalXSignalsService?: ExternalXSignalsService;
  externalPatternSnapshotReader?: ExternalPatternSnapshotReader;
  voiceSampleProvider?: VoiceSampleProvider;
}

export interface RunnerAppOptions {
  engineSettingsDir?: string;
  browserProfileDir?: string;
  overlayBundlePath?: string;
  // CDP endpoint of an already-running Chrome (started with --remote-debugging-port
  // and logged in by the user). When set — directly or via XB_CDP_ENDPOINT — the
  // runner ATTACHES over CDP instead of launching its own browser. An empty string
  // is treated as unset.
  connectEndpoint?: string;
  services?: EngineServices;
  createServices?: (opts: { engineSettingsDir: string }) => EngineServices;
  launchBrowser?: (opts: {
    userDataDir: string;
    channel: "chromium";
  }) => Promise<BrowserContextLike>;
  // Reconnect-mode acquisition: attach to the live Chrome over CDP. Default
  // `chromium.connectOverCDP`. Injectable so the reconnect lifecycle is testable
  // with a fake browser/context/page and no real Chrome.
  connectBrowser?: (endpoint: string) => Promise<BrowserLike>;
  bindTransport?: (page: PageLike, services: EngineServices) => void | Promise<void>;
  attachObserver?: (
    context: BrowserContextLike,
    onBatch: (batch: unknown) => unknown,
    services: EngineServices,
  ) => void | Promise<void>;
  bootstrapOverlay?: (page: PageLike) => void | Promise<void>;
}

/**
 * Thrown when the overlay bundle file cannot be found — the `@x-builder/overlay`
 * package has not been built. Surfaced before any browser binding or navigation
 * so the failure is unambiguous and side-effect free.
 */
export class OverlayBundleNotFoundError extends Error {
  constructor(bundlePath: string) {
    super(
      `Overlay bundle not found at ${bundlePath}. Build @x-builder/overlay first (pnpm -F @x-builder/overlay build).`,
    );
    this.name = "OverlayBundleNotFoundError";
  }
}

const defaultEngineSettingsDir = (): string => join(homedir(), ".x-builder", "engine-settings");
const defaultBrowserProfileDir = (): string => join(homedir(), ".x-builder", "browser-profile");
const defaultOverlayBundlePath = (): string =>
  require.resolve("@x-builder/overlay/dist/overlay.iife.js");

// Production service construction. The runner consumes engine services in-process
// (no HTTP). Only the slice the runner needs is built here; the full transport
// bundle is built by the default bindTransport wiring (XOB-030) from these.
const defaultCreateServices = (opts: { engineSettingsDir: string }): EngineServices => {
  const settingsRepository = new JsonFileAppSettingsRepository({ root: opts.engineSettingsDir });
  // SQLite host (LPF-003): open <engineSettingsDir>/storage/x-builder.db, run the
  // one-time JSON->SQLite importer over that same dir, then serve the corpus from
  // SQLite. Production persists at ~/.x-builder/engine-settings/storage; tests pass a
  // tmpdir engineSettingsDir, so home is never touched.
  const storageDir = join(opts.engineSettingsDir, "storage");
  mkdirSync(storageDir, { recursive: true });
  const db = openEngineDatabase(join(storageDir, "x-builder.db"));
  importPostLibraryJsonToSqlite(storageDir, db);
  const postLibraryRepository = new SqlitePostLibraryRepository(db);
  const feedbackLoopService = new FeedbackLoopService({
    feedbackRepository: new SqliteFeedbackLoopRepository(db),
    postLibraryRepository,
  });
  const externalXSignalsRepository = new SqliteExternalXSignalsRepository(db);
  const externalXSignalsService = new ExternalXSignalsService({
    repository: externalXSignalsRepository,
  });
  const liveCapture = new LiveCaptureService(postLibraryRepository);

  return {
    liveCapture,
    settingsRepository,
    postLibraryRepository,
    feedbackLoopService,
    externalXSignalsService,
    externalPatternSnapshotReader: externalXSignalsRepository,
    voiceSampleProvider: createSqliteVoiceSampleProvider({ db }),
  };
};

// One in-process StructuredLlmService backs the generate / apply / suggest LLM
// services and the judge gateway. The provider list is built from the registry
// against the startup-resolved workspace root, mirroring buildServer; an
// unresolvable root yields an empty provider list, so an LLM call resolves to a
// provider_unconfigured failure rather than throwing at construction.
const buildDefaultStructuredLlm = (): StructuredLlmGateway => {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const runner = new NodeProcessRunner();
  const providers = workspaceRoot
    ? judgeProviderRegistry.map((entry) => entry.createProvider({ runner, workspaceRoot }))
    : [];

  return new StructuredLlmService({ providers });
};

// Build the page init-script / evaluate source that mounts the overlay: install
// the ONE canonical `assembleTransport` (serialized from its compiled source — no
// duplicate inline copy), call it against the real `window` with the binding
// registry embedded as JSON, then invoke the overlay bootstrap. Idempotent: a
// re-run (init scripts re-execute on navigation) re-assembles the transport and
// re-invokes the (host-id-guarded) bootstrap.
const buildOverlayMountScript = (): string => {
  const bindingsJson = JSON.stringify({ ...ENGINE_TRANSPORT_BINDINGS });
  return [
    "(function(){",
    `var __xbAssemble = ${assembleTransport.toString()};`,
    // Assemble window.__xbTransport immediately — safe at document-start, since its
    // methods resolve their __xbuilder_* binding lazily at call time.
    `__xbAssemble(window, ${bindingsJson});`,
    // Defer the overlay MOUNT until the DOM is ready. As an init script this runs at
    // document-start (on reload / SPA navigation), before <body> and X's render
    // exist — calling __xbBootstrap() then mounts a host that does not survive X's
    // subsequent render. Waiting for DOMContentLoaded mounts into a ready document.
    "var __xbMount = function(){ if (typeof window.__xbBootstrap === 'function') { window.__xbBootstrap(); } };",
    "if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __xbMount, { once: true }); } else { __xbMount(); }",
    "})();",
  ].join("\n");
};

export class RunnerApp {
  private readonly engineSettingsDir: string;
  private readonly browserProfileDir: string;
  private readonly overlayBundlePath: string;
  // Resolved at construction from option then XB_CDP_ENDPOINT; empty string → unset.
  // A defined value selects reconnect mode.
  private readonly connectEndpoint?: string;
  private readonly injectedServices?: EngineServices;
  private readonly createServices: (opts: { engineSettingsDir: string }) => EngineServices;
  private readonly launchBrowser: (opts: {
    userDataDir: string;
    channel: "chromium";
  }) => Promise<BrowserContextLike>;
  private readonly connectBrowser: (endpoint: string) => Promise<BrowserLike>;
  private readonly bindTransport: (
    page: PageLike,
    services: EngineServices,
  ) => void | Promise<void>;
  private readonly attachObserver: (
    context: BrowserContextLike,
    onBatch: (batch: unknown) => unknown,
    services: EngineServices,
  ) => void | Promise<void>;
  private readonly bootstrapOverlay: (page: PageLike) => void | Promise<void>;

  private started = false;
  // True between start() and stop() when start() attached over CDP, so stop()
  // disconnects the CDP session (browser.close) instead of closing the user's
  // context/tabs.
  private reconnected = false;
  private context?: BrowserContextLike;
  // The connectOverCDP browser in reconnect mode; undefined in launch mode.
  private browser?: BrowserLike;
  private page?: PageLike;
  // The capture observer is created once per start and shared between the two
  // default seams: the bundle's getOverlayReadiness holds its live state
  // reference (bind runs first), and attachObserver registers it on the context.
  private captureObserver?: GraphQlCaptureObserver;

  constructor(options: RunnerAppOptions = {}) {
    this.engineSettingsDir = options.engineSettingsDir ?? defaultEngineSettingsDir();
    this.browserProfileDir = options.browserProfileDir ?? defaultBrowserProfileDir();
    this.overlayBundlePath = options.overlayBundlePath ?? defaultOverlayBundlePath();
    // Empty string (option or env) is treated as unset, so it does not select
    // reconnect mode.
    const endpoint = options.connectEndpoint ?? process.env.XB_CDP_ENDPOINT;
    this.connectEndpoint = endpoint ? endpoint : undefined;
    this.injectedServices = options.services;
    this.createServices = options.createServices ?? defaultCreateServices;
    this.launchBrowser = options.launchBrowser ?? ((opts) => BrowserController.launch(opts));
    this.connectBrowser =
      options.connectBrowser ?? ((endpoint) => chromium.connectOverCDP(endpoint));
    // The real (XOB-030) defaults: bind the 24 engine bindings through
    // ExposeFunctionTransport, and observe X GraphQL responses for live capture.
    // An injected override still wins, keeping every seam testable.
    this.bindTransport = options.bindTransport ?? ((page, services) => this.defaultBindTransport(page, services));
    this.attachObserver =
      options.attachObserver ??
      ((context, onBatch, services) => this.defaultAttachObserver(context, onBatch, services));
    // The real (XOB-033) default: assemble window.__xbTransport from the exposed
    // bindings and invoke the overlay bootstrap, both as page init scripts so they
    // (re-)run on every navigation. An injected override still wins.
    this.bootstrapOverlay =
      options.bootstrapOverlay ?? ((page) => this.defaultBootstrapOverlay(page));
  }

  // The shared capture observer for the default seams. Created on first use so
  // the bundle (bound first) and the response listener (attached second) share
  // one live state object.
  private getOrCreateCaptureObserver(): GraphQlCaptureObserver {
    if (this.captureObserver === undefined) {
      this.captureObserver = new GraphQlCaptureObserver();
    }

    return this.captureObserver;
  }

  // Default transport wiring: construct the full BoundEngineServices bundle from
  // the in-process repositories + one StructuredLlmService, then register the 20
  // __xbuilder_* bindings on the page. The bundle's getOverlayReadiness reads the
  // shared capture observer's live state.
  private async defaultBindTransport(page: PageLike, services: EngineServices): Promise<void> {
    if (services.settingsRepository === undefined || services.postLibraryRepository === undefined) {
      throw new Error(
        "RunnerApp default transport wiring requires settings + post-library repositories in the service bundle.",
      );
    }

    const llm = buildDefaultStructuredLlm();
    const bundle = createBoundEngineServices({
      settingsRepository: services.settingsRepository,
      postLibraryRepository: services.postLibraryRepository,
      feedbackLoopService: services.feedbackLoopService,
      externalXSignalsService: services.externalXSignalsService,
      externalPatternSnapshotReader: services.externalPatternSnapshotReader,
      voiceSampleProvider: services.voiceSampleProvider,
      liveCapture: services.liveCapture as LiveCaptureService,
      llm,
      // A StructuredLlmService's generic generateStructured satisfies the
      // judge-specialized gateway, so one instance backs both seams.
      judgeLlm: llm,
      observer: this.getOrCreateCaptureObserver(),
      settingsRoot: this.engineSettingsDir,
    });

    await ExposeFunctionTransport.bindAll(page as never, bundle);
  }

  // Default capture wiring: register the shared observer's response listener on
  // the context, forwarding each normalized batch to live-capture ingest. Pure
  // observation — no request is ever issued (invariant #6).
  private defaultAttachObserver(
    context: BrowserContextLike,
    onBatch: (batch: unknown) => unknown,
    services: EngineServices,
  ): void {
    const externalObserver = services.externalXSignalsService
      ? new ExternalXSignalsCaptureObserver(services.externalXSignalsService).attachTo(
          context as never,
        )
      : undefined;

    // Forward the batch (and its ingest promise) so the observer's own
    // never-throw handler awaits and tolerates any ingestion failure. When a
    // response belongs to a registered external signal source, skip the own-post
    // path so external evidence cannot enter the local author corpus.
    this.getOrCreateCaptureObserver().attachTo(
      context as never,
      async (batch) => {
        await onBatch(batch);
      },
      {
        shouldSkip: externalObserver
          ? (observation) => externalObserver.isRegisteredExternalObservation(observation)
          : undefined,
      },
    );
  }

  // Default overlay-mount wiring (XOB-033). Runs AFTER navigation so the page is
  // ready and the exposed __xbuilder_* bindings are callable:
  //   1. Register the transport-assembly init script so window.__xbTransport is
  //      (re-)assembled on every future document (a full reload re-runs init
  //      scripts; the one canonical `assembleTransport` is serialized in, with the
  //      binding registry embedded as JSON since the closure import is absent in
  //      the page). Its methods resolve their binding lazily.
  //   2. On the CURRENT (already-loaded) document — which the init script above
  //      does not cover — assemble the transport and invoke the overlay bootstrap
  //      (window.__xbBootstrap, assigned by the injected bundle). Doing this after
  //      the page is ready means getOverlayReadiness and the other bindings the
  //      provider/cockpit read on mount are callable, so the overlay mounts
  //      against the real engine rather than racing a not-yet-bound transport.
  //
  // A structural-fake page without `addInitScript`/`evaluate` (the lifecycle test)
  // has no real document to mount into, so the step is a clean no-op there.
  private async defaultBootstrapOverlay(page: PageLike): Promise<void> {
    const mountScript = buildOverlayMountScript();
    // Future documents (a full reload re-runs init scripts): re-assemble + re-mount.
    // Registered AFTER navigation, so it does NOT run on the current document —
    // that one is handled below, once bindings are callable.
    if (typeof page.addInitScript === "function") {
      await page.addInitScript({ content: mountScript });
    }
    // Current (already-loaded) document: run the same canonical mount script as a
    // string expression now that the page is ready and the bindings are callable.
    if (typeof page.evaluate === "function") {
      await page.evaluate(mountScript);
    }
  }

  async start(): Promise<void> {
    // Guard re-entry: a second start() without an intervening stop() must not
    // acquire a second browser.
    if (this.started) {
      return;
    }
    this.started = true;

    const services =
      this.injectedServices ?? this.createServices({ engineSettingsDir: this.engineSettingsDir });

    if (this.connectEndpoint !== undefined) {
      await this.startReconnect(this.connectEndpoint, services);
      return;
    }

    await this.startLaunch(services);
  }

  // Launch mode: open a persistent Chromium context, inject the overlay bundle as
  // a per-document init script, then bind / observe / navigate / bootstrap.
  private async startLaunch(services: EngineServices): Promise<void> {
    this.context = await this.launchBrowser({
      userDataDir: this.browserProfileDir,
      channel: "chromium",
    });

    // Read the overlay bundle before addInitScript/bind/observer/goto. A missing
    // bundle throws here, so none of those downstream steps run.
    if (!existsSync(this.overlayBundlePath)) {
      throw new OverlayBundleNotFoundError(this.overlayBundlePath);
    }
    const overlayBundle = readFileSync(this.overlayBundlePath, "utf-8");

    await this.context.addInitScript({ content: overlayBundle });

    this.page = this.context.pages()[0] ?? (await this.context.newPage());

    await this.bindTransport(this.page, services);
    await this.attachObserver(this.context, (batch) => services.liveCapture.ingest(batch), services);

    await this.page.goto("https://x.com");

    // Assemble window.__xbTransport and invoke the overlay bootstrap AFTER the page
    // is ready, so the exposed __xbuilder_* bindings are callable when the provider
    // and cockpit read the transport on mount (AC-4). Done last so it cannot race
    // the navigation or the binding exposure.
    await this.bootstrapOverlay(this.page);

    console.log("[x-builder] Ready — x.com loaded with overlay.");
  }

  // Reconnect mode: ATTACH to the live Chrome over CDP and inject the overlay into
  // its existing tab. The browser's first context (and its logged-in session) is
  // owned by that Chrome — automation never opened it — so the macOS Keychain wall
  // is sidestepped entirely.
  private async startReconnect(endpoint: string, services: EngineServices): Promise<void> {
    this.browser = await this.connectBrowser(endpoint);
    const context = this.browser.contexts()[0];
    if (context === undefined) {
      throw new Error(
        `No browser context found over CDP at ${endpoint}. Start Chrome with --remote-debugging-port and log in first.`,
      );
    }
    this.context = context;
    this.reconnected = true;

    // Read the overlay bundle before any injection/bind/observer step. A missing
    // bundle throws here, so none of those downstream steps run.
    if (!existsSync(this.overlayBundlePath)) {
      throw new OverlayBundleNotFoundError(this.overlayBundlePath);
    }
    const overlayBundle = readFileSync(this.overlayBundlePath, "utf-8");

    // Prefer a tab already on x.com; else the first tab; else a fresh one.
    const onX = (page: PageLike): boolean =>
      typeof page.url === "function" && /^https?:\/\/([^/]*\.)?x\.com\b/.test(page.url());
    const page = context.pages().find(onX) ?? context.pages()[0] ?? (await context.newPage());
    this.page = page;

    // Connecting over CDP pins the emulated `prefers-color-scheme` to light, so
    // x.com — which has no saved theme on a fresh profile and follows the media
    // query — renders white even on a dark-mode OS. Force the scheme to dark so X
    // renders dark regardless of the connect-time default. Applied to every open
    // tab in the context (last-write-wins; harmless if already dark).
    for (const openPage of context.pages()) {
      if (typeof openPage.emulateMedia === "function") {
        try {
          await openPage.emulateMedia({ colorScheme: "dark" });
        } catch {
          // emulateMedia unavailable / rejected — leave the scheme as-is.
        }
      }
    }

    // Register the bundle for FUTURE documents (init scripts re-run on navigation).
    await context.addInitScript({ content: overlayBundle });

    // Ensure the chosen page is on X with the overlay present. If it is off-X, a
    // goto loads x.com/home and the init script above injects the bundle on that
    // navigation (the logged-in session persists — the connected Chrome owns it).
    // If it is already on X, inject into the CURRENT document without reloading:
    // run the bundle IIFE so it assigns window.__xbBootstrap.
    if (!onX(page)) {
      await page.goto("https://x.com/home");
    } else if (typeof page.evaluate === "function") {
      await page.evaluate(overlayBundle);
    }

    // Same order as launch mode: bind the 24 bindings (exposeFunction works over
    // connectOverCDP), attach the capture observer, then bootstrap the overlay.
    await this.bindTransport(page, services);
    await this.attachObserver(context, (batch) => services.liveCapture.ingest(batch), services);
    await this.bootstrapOverlay(page);

    console.log(`[x-builder] Reconnected to Chrome at ${endpoint} — overlay injected.`);
  }

  async stop(): Promise<void> {
    if (this.reconnected) {
      // Disconnect the CDP session. This must NOT close the user's Chrome or tabs,
      // so we close the browser handle and never call context.close().
      await this.browser?.close();
    } else {
      await this.context?.close();
    }

    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
    this.reconnected = false;
    // Drop the observer so a stop -> start gets a fresh one bound to the new
    // context rather than a stale listener.
    this.captureObserver = undefined;
    this.started = false;
  }
}
