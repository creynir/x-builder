/**
 * Failing tests for the RunnerApp bootstrap lifecycle.
 *
 * The module under test (`./runner-app`) does not exist yet, so the import
 * below resolves to nothing until the implementation lands. That is the
 * intended Red state: these tests must fail on a missing module, not on a logic
 * error in the test itself.
 *
 * Subject:
 *   class RunnerApp {
 *     constructor(options?: RunnerAppOptions)
 *     start(): Promise<void>
 *     stop(): Promise<void>
 *   }
 *
 * Testing seams (required of the implementation): every collaborator that
 * `start()` touches is injectable through `RunnerAppOptions` so no real
 * browser, no real engine services, and no real network calls happen here.
 *
 *   interface RunnerAppOptions {
 *     engineSettingsDir?: string;
 *     browserProfileDir?: string;
 *     overlayBundlePath?: string;
 *     services?: EngineServices;                 // injected fake service bundle
 *     createServices?: (opts) => EngineServices;  // factory (default builds real ones)
 *     launchBrowser?: (opts: { userDataDir: string; channel: "chromium" })
 *                       => Promise<BrowserContextLike>;   // default: BrowserController.launch
 *     bindTransport?: (page, services) => void | Promise<void>;   // default: NO-OP (XOB later)
 *     attachObserver?: (context, onBatch) => void | Promise<void>; // default: NO-OP (XOB later)
 *   }
 *
 * The service bundle must expose the live-capture service so the observer's
 * onBatch callback can forward a captured batch into `services.liveCapture.ingest`.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OverlayBundleNotFoundError,
  RunnerApp,
  type BrowserContextLike,
  type BrowserLike,
  type PageLike,
} from "./runner-app";

const OVERLAY_BUNDLE_CONTENT = '(function(){"use strict";globalThis.__xbuilder_overlay=1})();';

// A shared, ordered recorder. Each seam pushes a label as it runs; the tests
// assert the resulting sequence with array equality.
function createRecorder() {
  const calls: string[] = [];
  return {
    calls,
    record(label: string) {
      calls.push(label);
    },
  };
}

// Build a fake Playwright BrowserContext + Page pair. `record` is shared with
// the seam mocks so addInitScript / goto land in the same ordered log.
function createFakeContext(record: (label: string) => void, options?: { emptyPages?: boolean }) {
  const goto = vi.fn(async () => {
    record("goto");
  });
  const page = { goto, label: "page" };

  const newPage = vi.fn(async () => page);
  const addInitScript = vi.fn(async (_script: { content: string }) => {
    record("addInitScript");
  });
  const close = vi.fn(async () => {
    record("close");
  });
  const pages = vi.fn(() => (options?.emptyPages ? [] : [page]));

  return {
    context: { addInitScript, pages, newPage, close, label: "context" },
    page,
    goto,
    newPage,
    addInitScript,
    close,
    pages,
  };
}

// A fake engine service bundle. Only the live-capture seam is exercised here.
function createFakeServices() {
  const ingest = vi.fn(async () => ({
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    duplicateCount: 0,
    profileApplied: false,
    corpusSize: 0,
  }));
  return { services: { liveCapture: { ingest } }, ingest };
}

let tempDir: string;
let bundlePath: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "x-builder-runner-"));
  bundlePath = join(tempDir, "overlay.iife.js");
  writeFileSync(bundlePath, OVERLAY_BUNDLE_CONTENT, "utf-8");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("RunnerApp.start — bootstrap call order", () => {
  it("launches, injects the overlay, binds transport, attaches the observer, then navigates — in that order", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const launchBrowser = vi.fn(async () => {
      recorder.record("launchBrowser");
      return fake.context;
    });
    const bindTransport = vi.fn(async () => {
      recorder.record("bindTransport");
    });
    const attachObserver = vi.fn(async () => {
      recorder.record("attachObserver");
    });

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser,
      bindTransport,
      attachObserver,
    });

    await app.start();

    expect(recorder.calls).toEqual([
      "launchBrowser",
      "addInitScript",
      "bindTransport",
      "attachObserver",
      "goto",
    ]);
  });

  it("injects the overlay bundle content read from overlayBundlePath", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();

    expect(fake.addInitScript).toHaveBeenCalledTimes(1);
    expect(fake.addInitScript).toHaveBeenCalledWith({ content: OVERLAY_BUNDLE_CONTENT });
  });

  it("launches the persistent context with the configured browser profile directory", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();
    const browserProfileDir = join(tempDir, "browser-profile");

    const launchBrowser = vi.fn(async () => fake.context);

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir,
      overlayBundlePath: bundlePath,
      services,
      launchBrowser,
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();

    expect(launchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ userDataDir: browserProfileDir, channel: "chromium" }),
    );
  });

  it("navigates to x.com", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();

    expect(fake.goto).toHaveBeenCalledWith("https://x.com");
  });

  it("passes the page and services through to bindTransport", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const bindTransport = vi.fn();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport,
      attachObserver: vi.fn(),
    });

    await app.start();

    expect(bindTransport).toHaveBeenCalledWith(fake.page, services);
  });
});

describe("RunnerApp.start — first-launch page creation", () => {
  it("creates a new page when the context reports no existing pages", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record, { emptyPages: true });
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();

    expect(fake.newPage).toHaveBeenCalledTimes(1);
    expect(fake.goto).toHaveBeenCalledWith("https://x.com");
  });

  it("reuses the first existing page rather than creating one", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();

    expect(fake.newPage).not.toHaveBeenCalled();
  });
});

describe("RunnerApp.start — missing overlay bundle", () => {
  it("throws OverlayBundleNotFoundError before binding transport or navigating", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const bindTransport = vi.fn();
    const attachObserver = vi.fn();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: join(tempDir, "does-not-exist", "overlay.iife.js"),
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport,
      attachObserver,
    });

    await expect(app.start()).rejects.toBeInstanceOf(OverlayBundleNotFoundError);

    expect(bindTransport).not.toHaveBeenCalled();
    expect(attachObserver).not.toHaveBeenCalled();
    expect(fake.goto).not.toHaveBeenCalled();
  });
});

describe("RunnerApp — observer onBatch wiring", () => {
  it("forwards a captured batch from attachObserver's callback into the live-capture ingest", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services, ingest } = createFakeServices();

    // Capture the onBatch callback that RunnerApp hands to attachObserver, then
    // invoke it with a batch and assert it reaches services.liveCapture.ingest.
    let capturedOnBatch: ((batch: unknown) => unknown) | undefined;
    const attachObserver = vi.fn((_context: unknown, onBatch: (batch: unknown) => unknown) => {
      capturedOnBatch = onBatch;
    });

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver,
    });

    await app.start();

    expect(capturedOnBatch).toBeTypeOf("function");

    const batch = { posts: [], profile: undefined };
    await capturedOnBatch?.(batch);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(batch);
  });

  it("hands attachObserver the context it launched", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const attachObserver = vi.fn();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver,
    });

    await app.start();

    expect(attachObserver).toHaveBeenCalledWith(fake.context, expect.any(Function));
  });
});

describe("RunnerApp.stop", () => {
  it("closes the launched context", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser: vi.fn(async () => fake.context),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();
    await app.stop();

    expect(fake.close).toHaveBeenCalledTimes(1);
  });
});

// A fake Playwright Page on x.com for reconnect mode: url() matches x.com, and
// goto/evaluate/addInitScript are spies that push into the shared ordered log.
// Typed as PageLike so the structural surface (method-syntax evaluate<R>) holds —
// a bare vi.fn collapses the generic, so the recording spy is exposed separately
// and the page's evaluate delegates to it.
type FakeXPage = PageLike & {
  url: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  addInitScript: ReturnType<typeof vi.fn>;
};

function createFakeXPage(record: (label: string) => void, options?: { url?: string }): FakeXPage {
  const url = vi.fn(() => options?.url ?? "https://x.com/home");
  const goto = vi.fn(async () => {
    record("goto");
  });
  const evaluate = vi.fn((_script: string) => {
    record("evaluate");
    return Promise.resolve(undefined);
  });
  const addInitScript = vi.fn(async (_script: { content: string }) => {
    record("page.addInitScript");
  });
  return { url, goto, evaluate, addInitScript, label: "x-page" } as unknown as FakeXPage;
}

// A fake connectOverCDP browser whose contexts()[0] is a fake live context that
// owns `pages`. close() records (CDP disconnect); context.close() must never run.
function createFakeCdpBrowser(
  record: (label: string) => void,
  pages: ReturnType<typeof createFakeXPage>[],
) {
  const contextClose = vi.fn(async () => {
    record("context.close");
  });
  const contextAddInitScript = vi.fn(async (_script: { content: string }) => {
    record("context.addInitScript");
  });
  const newPage = vi.fn(async () => createFakeXPage(record));
  const context: BrowserContextLike = {
    addInitScript: contextAddInitScript,
    pages: () => pages,
    newPage,
    close: contextClose,
  };
  const browserClose = vi.fn(async () => {
    record("browser.close");
  });
  const browser: BrowserLike = {
    contexts: () => [context],
    close: browserClose,
  };
  return { browser, context, contextClose, contextAddInitScript, newPage, browserClose };
}

describe("RunnerApp.start — reconnect mode (connectOverCDP)", () => {
  const ENDPOINT = "http://127.0.0.1:9222";

  it("connects over CDP and does not launch its own browser", async () => {
    const recorder = createRecorder();
    const xPage = createFakeXPage(recorder.record);
    const fakeCdp = createFakeCdpBrowser(recorder.record, [xPage]);
    const { services } = createFakeServices();

    const launchBrowser = vi.fn();
    const connectBrowser = vi.fn(async () => fakeCdp.browser);

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      connectEndpoint: ENDPOINT,
      services,
      launchBrowser,
      connectBrowser,
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
      bootstrapOverlay: vi.fn(),
    });

    await app.start();

    expect(connectBrowser).toHaveBeenCalledWith(ENDPOINT);
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("reuses the existing x.com tab and injects into the live document without navigating", async () => {
    const recorder = createRecorder();
    const xPage = createFakeXPage(recorder.record, { url: "https://x.com/home" });
    const fakeCdp = createFakeCdpBrowser(recorder.record, [xPage]);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      connectEndpoint: ENDPOINT,
      services,
      connectBrowser: vi.fn(async () => fakeCdp.browser),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
      bootstrapOverlay: vi.fn(),
    });

    await app.start();

    // Live-document injection runs the bundle string; no navigation happens.
    expect(xPage.evaluate).toHaveBeenCalledWith(OVERLAY_BUNDLE_CONTENT);
    expect(xPage.goto).not.toHaveBeenCalled();
    // The bundle is also registered for future documents on the live context.
    expect(fakeCdp.contextAddInitScript).toHaveBeenCalledWith({
      content: OVERLAY_BUNDLE_CONTENT,
    });
  });

  it("navigates an off-x.com tab to x.com/home instead of injecting into the current document", async () => {
    const recorder = createRecorder();
    const offX = createFakeXPage(recorder.record, { url: "https://example.com/" });
    const fakeCdp = createFakeCdpBrowser(recorder.record, [offX]);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      connectEndpoint: ENDPOINT,
      services,
      connectBrowser: vi.fn(async () => fakeCdp.browser),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
      bootstrapOverlay: vi.fn(),
    });

    await app.start();

    expect(offX.goto).toHaveBeenCalledWith("https://x.com/home");
    expect(offX.evaluate).not.toHaveBeenCalled();
  });

  it("binds transport then bootstraps the overlay (in order) and attaches the observer to the live context", async () => {
    const recorder = createRecorder();
    const xPage = createFakeXPage(recorder.record);
    const fakeCdp = createFakeCdpBrowser(recorder.record, [xPage]);
    const { services } = createFakeServices();

    const bindTransport = vi.fn(async () => {
      recorder.record("bindTransport");
    });
    const attachObserver = vi.fn(async () => {
      recorder.record("attachObserver");
    });
    const bootstrapOverlay = vi.fn(async () => {
      recorder.record("bootstrapOverlay");
    });

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      connectEndpoint: ENDPOINT,
      services,
      connectBrowser: vi.fn(async () => fakeCdp.browser),
      bindTransport,
      attachObserver,
      bootstrapOverlay,
    });

    await app.start();

    expect(bindTransport).toHaveBeenCalledWith(xPage, services);
    expect(bootstrapOverlay).toHaveBeenCalledWith(xPage);
    expect(attachObserver).toHaveBeenCalledWith(fakeCdp.context, expect.any(Function));

    // bindTransport precedes bootstrapOverlay.
    expect(recorder.calls.indexOf("bindTransport")).toBeLessThan(
      recorder.calls.indexOf("bootstrapOverlay"),
    );
  });

  it("throws a clear error when the connected browser has no context", async () => {
    const recorder = createRecorder();
    const noCtxBrowser: BrowserLike = {
      contexts: () => [],
      close: vi.fn(async () => undefined),
    };
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      connectEndpoint: ENDPOINT,
      services,
      connectBrowser: vi.fn(async () => noCtxBrowser),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
      bootstrapOverlay: vi.fn(),
    });

    await expect(app.start()).rejects.toThrow(/No browser context found over CDP/);
    void recorder;
  });
});

describe("RunnerApp.stop — reconnect mode", () => {
  const ENDPOINT = "http://127.0.0.1:9222";

  it("disconnects the CDP session (browser.close) without closing the user's context", async () => {
    const recorder = createRecorder();
    const xPage = createFakeXPage(recorder.record);
    const fakeCdp = createFakeCdpBrowser(recorder.record, [xPage]);
    const { services } = createFakeServices();

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      connectEndpoint: ENDPOINT,
      services,
      connectBrowser: vi.fn(async () => fakeCdp.browser),
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
      bootstrapOverlay: vi.fn(),
    });

    await app.start();
    await app.stop();

    expect(fakeCdp.browserClose).toHaveBeenCalledTimes(1);
    expect(fakeCdp.contextClose).not.toHaveBeenCalled();
  });
});

describe("RunnerApp.start — start guard", () => {
  it("does not launch a second context when start() is called again without stop()", async () => {
    const recorder = createRecorder();
    const fake = createFakeContext(recorder.record);
    const { services } = createFakeServices();

    const launchBrowser = vi.fn(async () => fake.context);

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: bundlePath,
      services,
      launchBrowser,
      bindTransport: vi.fn(),
      attachObserver: vi.fn(),
    });

    await app.start();

    // A second start() without an intervening stop() must be guarded: either it
    // rejects, or it is a no-op. Either way it must NOT launch a second context.
    await app.start().catch(() => undefined);

    expect(launchBrowser).toHaveBeenCalledTimes(1);
  });
});
