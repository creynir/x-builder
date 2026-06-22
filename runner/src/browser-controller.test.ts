/**
 * Failing tests for the persistent-context browser launcher with first-run
 * Chromium install fallback.
 *
 * The module under test (`./browser-controller`) does not exist yet, so the
 * import below resolves to nothing until the implementation lands. That is the
 * intended Red state: these tests must fail on a missing module, not on a logic
 * error in the test itself.
 *
 * Subject:
 *   BrowserController.launch(options, testSeams?) -> Promise<BrowserContext>
 *
 * Testing seam (required of the implementation):
 *   `launch` accepts an optional second argument carrying injectable
 *   collaborators so no real browser launches and no real `npx playwright
 *   install` subprocess runs:
 *     {
 *       _launch?: (userDataDir: string, opts: { channel: "chromium"; headless: boolean })
 *                   => Promise<BrowserContextLike>,
 *       _install?: (args: { browser: "chromium" }) => Promise<{ code: number }>,
 *     }
 *   Production defaults: `_launch` -> chromium.launchPersistentContext,
 *   `_install` -> spawn `npx playwright install chromium` (stdio inherit),
 *   resolving with the child exit code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserController, BrowserInstallError } from "./browser-controller";

// The Playwright "binary missing" surface. The controller decides to install
// only when the launch rejection matches this shape.
const MISSING_EXECUTABLE_MESSAGE = [
  "browserType.launchPersistentContext: Executable doesn't exist at",
  "/Users/test/Library/Caches/ms-playwright/chromium-1234/chrome-mac/Chromium.app",
  "╔════════════════════════════════════════════════════════════╗",
  "║ Looks like Playwright Test or Playwright was just installed  ║",
  "║ or updated. Please run the following command to download new ║",
  "║ browsers:                                                    ║",
  "║                                                              ║",
  "║     npx playwright install                                   ║",
  "╚════════════════════════════════════════════════════════════╝",
].join("\n");

const LAUNCH_OPTIONS = {
  userDataDir: "/tmp/x-builder-test-profile",
  channel: "chromium" as const,
};

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BrowserController.launch — happy path", () => {
  it("returns the launched context and never attempts an install when the launcher resolves", async () => {
    const fakeContext = { id: "ctx" };
    const _launch = vi.fn().mockResolvedValue(fakeContext);
    const _install = vi.fn().mockResolvedValue({ code: 0 });

    const context = await BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install });

    expect(context).toBe(fakeContext);
    expect(_launch).toHaveBeenCalledTimes(1);
    expect(_install).not.toHaveBeenCalled();
  });

  it("passes the configured userDataDir and a headless:false chromium launch", async () => {
    const _launch = vi.fn().mockResolvedValue({ id: "ctx" });

    await BrowserController.launch(LAUNCH_OPTIONS, {
      _launch,
      _install: vi.fn().mockResolvedValue({ code: 0 }),
    });

    expect(_launch).toHaveBeenCalledWith(
      LAUNCH_OPTIONS.userDataDir,
      expect.objectContaining({ channel: "chromium", headless: false }),
    );
  });
});

describe("BrowserController.launch — first-run install fallback", () => {
  it("installs chromium then retries the launch once, resolving with the second context", async () => {
    const fakeContext = { id: "ctx-after-install" };
    const _launch = vi
      .fn()
      .mockRejectedValueOnce(new Error(MISSING_EXECUTABLE_MESSAGE))
      .mockResolvedValueOnce(fakeContext);
    const _install = vi.fn().mockResolvedValue({ code: 0 });

    const context = await BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install });

    expect(context).toBe(fakeContext);
    expect(_install).toHaveBeenCalledTimes(1);
    expect(_install).toHaveBeenCalledWith(expect.objectContaining({ browser: "chromium" }));
    expect(_launch).toHaveBeenCalledTimes(2);
  });

  it("prints the single progress line before running the install", async () => {
    const _launch = vi
      .fn()
      .mockRejectedValueOnce(new Error(MISSING_EXECUTABLE_MESSAGE))
      .mockResolvedValueOnce({ id: "ctx" });
    const _install = vi.fn().mockResolvedValue({ code: 0 });

    await BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install });

    expect(logSpy).toHaveBeenCalledWith(
      "[x-builder] Chromium not found — running playwright install chromium...",
    );
  });
});

describe("BrowserController.launch — install failure", () => {
  it("throws BrowserInstallError with code browser_install_failed when the install exits non-zero", async () => {
    const _launch = vi.fn().mockRejectedValue(new Error(MISSING_EXECUTABLE_MESSAGE));
    const _install = vi.fn().mockResolvedValue({ code: 1 });

    await expect(BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install })).rejects.toThrow(
      BrowserInstallError,
    );

    try {
      await BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install });
      expect.unreachable("launch should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserInstallError);
      expect((error as BrowserInstallError).code).toBe("browser_install_failed");
    }
  });

  it("does not retry the launch a second time after a failed install (no hang/loop)", async () => {
    const _launch = vi.fn().mockRejectedValue(new Error(MISSING_EXECUTABLE_MESSAGE));
    const _install = vi.fn().mockResolvedValue({ code: 1 });

    await expect(
      BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install }),
    ).rejects.toBeInstanceOf(BrowserInstallError);

    // One initial launch attempt, install fails, no retry launch.
    expect(_launch).toHaveBeenCalledTimes(1);
    expect(_install).toHaveBeenCalledTimes(1);
  });

  it("prints the one-line failure guidance when the install exits non-zero", async () => {
    const _launch = vi.fn().mockRejectedValue(new Error(MISSING_EXECUTABLE_MESSAGE));
    const _install = vi.fn().mockResolvedValue({ code: 1 });

    await expect(
      BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install }),
    ).rejects.toBeInstanceOf(BrowserInstallError);

    expect(logSpy).toHaveBeenCalledWith(
      "[x-builder] Browser install failed. Run: npx playwright install chromium",
    );
  });
});

describe("BrowserController.launch — non-install launch failures", () => {
  it("propagates an unrelated launch error without attempting an install", async () => {
    const unrelated = new Error("EACCES: permission denied, mkdir '/tmp/x-builder-test-profile'");
    const _launch = vi.fn().mockRejectedValue(unrelated);
    const _install = vi.fn().mockResolvedValue({ code: 0 });

    await expect(BrowserController.launch(LAUNCH_OPTIONS, { _launch, _install })).rejects.toBe(
      unrelated,
    );
    expect(_install).not.toHaveBeenCalled();
    expect(_launch).toHaveBeenCalledTimes(1);
  });
});
