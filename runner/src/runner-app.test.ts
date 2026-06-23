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

import { OverlayBundleNotFoundError, RunnerApp } from "./runner-app";

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
