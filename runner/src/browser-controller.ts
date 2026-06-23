/**
 * Persistent-context Chromium launcher with a first-run install fallback.
 *
 * `launch` opens a persistent Playwright context against `userDataDir`. When the
 * first launch fails specifically because the Chromium executable is missing, it
 * runs `npx playwright install chromium` once and retries the launch a single
 * time. Any other launch failure propagates untouched (no install attempt), and
 * a failed install throws a typed {@link BrowserInstallError} without retrying —
 * so there is no install/launch loop or hang.
 *
 * Overlay injection is intentionally NOT done here; that is RunnerApp's job
 * (`addInitScript`), which keeps this controller testable in isolation.
 */

import { spawn } from "node:child_process";

import { type BrowserContext, chromium } from "playwright";

/**
 * Thrown when the first-run Chromium install subprocess exits non-zero. Carries a
 * stable `code` so callers can branch on the failure kind without string matching.
 */
export class BrowserInstallError extends Error {
  readonly code = "browser_install_failed" as const;

  constructor(message = "Browser install failed.") {
    super(message);
    this.name = "BrowserInstallError";
  }
}

export interface BrowserLaunchOptions {
  userDataDir: string;
  channel: "chromium";
}

/**
 * Injectable collaborators. In production the defaults launch a real persistent
 * context and spawn the real `npx playwright install chromium`; tests pass fakes
 * so no browser launches and no subprocess runs.
 */
export interface BrowserControllerSeams {
  _launch?: (
    userDataDir: string,
    opts: { channel: "chromium"; headless: boolean },
  ) => Promise<BrowserContext>;
  _install?: (args: { browser: "chromium" }) => Promise<{ code: number }>;
}

const PROGRESS_LINE = "[x-builder] Chromium not found — running playwright install chromium...";
const FAILURE_LINE = "[x-builder] Browser install failed. Run: npx playwright install chromium";

// The Playwright "binary missing" rejection. Matching this — and only this —
// keeps the install fallback from firing on unrelated launch errors (EACCES,
// profile-lock conflicts, etc.).
const MISSING_EXECUTABLE_PATTERN = /Executable doesn't exist|playwright install/i;

const isMissingExecutableError = (error: unknown): boolean =>
  error instanceof Error && MISSING_EXECUTABLE_PATTERN.test(error.message);

const defaultLaunch = (
  userDataDir: string,
  opts: { channel: "chromium"; headless: boolean },
): Promise<BrowserContext> => chromium.launchPersistentContext(userDataDir, opts);

const defaultInstall = (args: { browser: "chromium" }): Promise<{ code: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn("npx", ["playwright", "install", args.browser], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1 });
    });
  });

export class BrowserController {
  static async launch(
    options: BrowserLaunchOptions,
    testSeams: BrowserControllerSeams = {},
  ): Promise<BrowserContext> {
    const launch = testSeams._launch ?? defaultLaunch;
    const install = testSeams._install ?? defaultInstall;

    const launchOnce = (): Promise<BrowserContext> =>
      launch(options.userDataDir, { channel: options.channel, headless: false });

    try {
      return await launchOnce();
    } catch (error) {
      // Only a missing-executable rejection triggers the install fallback; any
      // other launch failure propagates verbatim with no install attempt.
      if (!isMissingExecutableError(error)) {
        throw error;
      }

      console.log(PROGRESS_LINE);
      const { code } = await install({ browser: "chromium" });

      if (code !== 0) {
        console.log(FAILURE_LINE);
        throw new BrowserInstallError();
      }

      // Install succeeded: retry exactly once. A second failure propagates as-is
      // (no further install, no loop).
      return await launchOnce();
    }
  }
}
