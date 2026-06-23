/**
 * RunnerApp bootstrap: launches a persistent Chromium context, injects the
 * prebuilt overlay bundle once per document via `addInitScript`, wires the
 * (XOB-016) transport and (XOB-017) capture observer through injectable seams,
 * and navigates to x.com.
 *
 * Every collaborator `start()` touches is injectable through {@link RunnerAppOptions}
 * so the lifecycle can be tested with no real browser, engine services, or
 * network. The `bindTransport` / `attachObserver` defaults (XOB-030) bind the 17
 * `__xbuilder_*` engine bindings through {@link ExposeFunctionTransport} and
 * register the {@link GraphQlCaptureObserver} response listener; an injected
 * override still wins, so every seam stays testable.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  JsonFileAppSettingsRepository,
  JsonFilePostLibraryRepository,
  LiveCaptureService,
  NodeProcessRunner,
  StructuredLlmService,
  judgeProviderRegistry,
  resolveWorkspaceRoot,
} from "@x-builder/engine";

import { BrowserController } from "./browser-controller.js";
import {
  createBoundEngineServices,
  type StructuredLlmGateway,
} from "./bound-engine-services.js";
import { ExposeFunctionTransport } from "./expose-function-transport.js";
import { GraphQlCaptureObserver } from "./graphql-capture-observer.js";
import { type ObserverLike } from "./overlay-readiness.js";

const require = createRequire(import.meta.url);

/**
 * Structural surfaces of the Playwright Page/Context the bootstrap actually
 * touches. Typing the seams against these (rather than the full Playwright
 * interfaces) lets a real `BrowserContext` flow through unchanged while keeping
 * the launch/bind/observer seams injectable with lightweight fakes — the launch
 * mock returns a context-like object, not a full driver.
 */
export interface PageLike {
  goto(url: string): Promise<unknown>;
}

export interface BrowserContextLike {
  addInitScript(script: { content: string }): Promise<unknown> | unknown;
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
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
  postLibraryRepository?: JsonFilePostLibraryRepository;
}

export interface RunnerAppOptions {
  engineSettingsDir?: string;
  browserProfileDir?: string;
  overlayBundlePath?: string;
  services?: EngineServices;
  createServices?: (opts: { engineSettingsDir: string }) => EngineServices;
  launchBrowser?: (opts: {
    userDataDir: string;
    channel: "chromium";
  }) => Promise<BrowserContextLike>;
  bindTransport?: (page: PageLike, services: EngineServices) => void | Promise<void>;
  attachObserver?: (
    context: BrowserContextLike,
    onBatch: (batch: unknown) => unknown,
  ) => void | Promise<void>;
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
  const postLibraryRepository = new JsonFilePostLibraryRepository({
    root: join(opts.engineSettingsDir, "storage"),
  });
  const liveCapture = new LiveCaptureService(postLibraryRepository);

  return { liveCapture, settingsRepository, postLibraryRepository };
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

export class RunnerApp {
  private readonly engineSettingsDir: string;
  private readonly browserProfileDir: string;
  private readonly overlayBundlePath: string;
  private readonly injectedServices?: EngineServices;
  private readonly createServices: (opts: { engineSettingsDir: string }) => EngineServices;
  private readonly launchBrowser: (opts: {
    userDataDir: string;
    channel: "chromium";
  }) => Promise<BrowserContextLike>;
  private readonly bindTransport: (
    page: PageLike,
    services: EngineServices,
  ) => void | Promise<void>;
  private readonly attachObserver: (
    context: BrowserContextLike,
    onBatch: (batch: unknown) => unknown,
  ) => void | Promise<void>;

  private started = false;
  private context?: BrowserContextLike;
  private page?: PageLike;
  // The capture observer is created once per start and shared between the two
  // default seams: the bundle's getOverlayReadiness holds its live state
  // reference (bind runs first), and attachObserver registers it on the context.
  private captureObserver?: GraphQlCaptureObserver;

  constructor(options: RunnerAppOptions = {}) {
    this.engineSettingsDir = options.engineSettingsDir ?? defaultEngineSettingsDir();
    this.browserProfileDir = options.browserProfileDir ?? defaultBrowserProfileDir();
    this.overlayBundlePath = options.overlayBundlePath ?? defaultOverlayBundlePath();
    this.injectedServices = options.services;
    this.createServices = options.createServices ?? defaultCreateServices;
    this.launchBrowser = options.launchBrowser ?? ((opts) => BrowserController.launch(opts));
    // The real (XOB-030) defaults: bind the 17 engine bindings through
    // ExposeFunctionTransport, and observe X GraphQL responses for live capture.
    // An injected override still wins, keeping every seam testable.
    this.bindTransport = options.bindTransport ?? ((page, services) => this.defaultBindTransport(page, services));
    this.attachObserver =
      options.attachObserver ?? ((context, onBatch) => this.defaultAttachObserver(context, onBatch));
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
  // the in-process repositories + one StructuredLlmService, then register the 17
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
  ): void {
    // Forward the batch (and its ingest promise) so the observer's own
    // never-throw handler awaits and tolerates any ingestion failure.
    this.getOrCreateCaptureObserver().attachTo(context as never, async (batch) => {
      await onBatch(batch);
    });
  }

  async start(): Promise<void> {
    // Guard re-entry: a second start() without an intervening stop() must not
    // launch a second context.
    if (this.started) {
      return;
    }
    this.started = true;

    const services =
      this.injectedServices ?? this.createServices({ engineSettingsDir: this.engineSettingsDir });

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
    await this.attachObserver(this.context, (batch) => services.liveCapture.ingest(batch));

    await this.page.goto("https://x.com");

    console.log("[x-builder] Ready — x.com loaded with overlay.");
  }

  async stop(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
    // Drop the observer so a stop -> start gets a fresh one bound to the new
    // context rather than a stale listener.
    this.captureObserver = undefined;
    this.started = false;
  }
}
