import { ENGINE_TRANSPORT_BINDINGS } from "@x-builder/shared";
import type { EngineTransport } from "@x-builder/shared";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { FakeEngineTransport } from "../testing/fake-transport";
import { OverlayTransportProvider } from "./provider";
import { useTransport } from "./use-transport";

/** The 24 LOCKED method names, taken from the real shared binding registry. */
const METHOD_NAMES = Object.keys(ENGINE_TRANSPORT_BINDINGS);

/** A representative call argument per method (signatures come from the real type). */
const CALL_ARGS: Record<string, unknown[]> = {
  getOverlayReadiness: [],
  getStatus: [],
  getSettings: [],
  updateSettings: [{}],
  validateArchive: [{}],
  importArchive: [{}],
  getActiveContext: [],
  activateContext: [],
  deactivateContext: [],
  analyzePosts: [{}],
  judgeDraft: [{}],
  generateIdeas: [{}],
  suggestPost: [{}],
  getCooldown: [],
  getCaptureSummary: [],
  getGenerateCategories: [],
  applyJudgeSuggestions: [{ text: "draft" }],
  recordFeedbackPrediction: [{}],
  linkFeedbackPrediction: [{}],
  getFeedbackLoopSummary: [],
  getExternalXSignalsOverview: [],
  addExternalXSignalSource: [{ screenName: "external_builder" }],
  removeExternalXSignalSource: [{ sourceId: "external-source-1" }],
  refreshExternalXSignalSource: [{ sourceId: "external-source-1" }],
};

afterEach(() => {
  cleanup();
});

describe("FakeEngineTransport — shape", () => {
  it("implements exactly the 26 real EngineTransport methods", () => {
    const fake = new FakeEngineTransport();
    const ownMethods = METHOD_NAMES.filter(
      (name) =>
        typeof (fake as unknown as Record<string, unknown>)[name] ===
        "function",
    );

    expect(METHOD_NAMES).toHaveLength(26);
    expect(new Set(ownMethods)).toEqual(new Set(METHOD_NAMES));
    expect(ownMethods).toHaveLength(26);
  });

  it("is assignable to the real EngineTransport type (TS-enforced)", () => {
    // Compile-time satisfaction check: the fake must satisfy the real interface.
    const transport: EngineTransport = new FakeEngineTransport();
    expect(transport).toBeDefined();
  });

  it("resolves every method to its default value without throwing", async () => {
    const fake = new FakeEngineTransport() as unknown as Record<
      string,
      ((...args: unknown[]) => Promise<unknown>) | undefined
    >;

    for (const name of METHOD_NAMES) {
      const fn = fake[name];
      expect(typeof fn).toBe("function");
      // Each method must return a thenable that resolves (default: a value, no reject).
      const value = await (fn as (...args: unknown[]) => Promise<unknown>)(
        ...(CALL_ARGS[name] ?? []),
      );
      expect(value).not.toBeUndefined();
    }
  });
  it("keeps external X signal overrides callable when detached from the fake", async () => {
    const addExternalXSignalSource = vi.fn(async () => ({
      source: {
        id: "external-source-1",
        platform: "x",
        screenName: "external_builder",
        status: "active",
        evidenceCount: 0,
        patternCount: 0,
        createdAt: "2026-06-28T12:00:00.000Z",
        updatedAt: "2026-06-28T12:00:00.000Z",
      },
      duplicate: false,
    }));
    const fake = new FakeEngineTransport({ addExternalXSignalSource } as Partial<EngineTransport>);
    const detached = fake.addExternalXSignalSource;

    await detached({ screenName: "external_builder" });

    expect(addExternalXSignalSource).toHaveBeenCalledWith({ screenName: "external_builder" });
  });
});

describe("useTransport inside OverlayTransportProvider", () => {
  it("returns the injected FakeEngineTransport and resolves all 24 method calls", async () => {
    const fake = new FakeEngineTransport();
    const results: unknown[] = [];
    let failure: unknown = null;

    function Consumer(): null {
      const transport = useTransport();
      useEffect(() => {
        void (async () => {
          try {
            for (const name of METHOD_NAMES) {
              const fn = (transport as unknown as Record<string, unknown>)[name];
              expect(typeof fn).toBe("function");
              results.push(
                await (fn as (...a: unknown[]) => Promise<unknown>).apply(
                  transport,
                  CALL_ARGS[name] ?? [],
                ),
              );
            }
          } catch (err) {
            failure = err;
          }
        })();
      }, [transport]);
      return null;
    }

    render(
      <OverlayTransportProvider transport={fake}>
        <Consumer />
      </OverlayTransportProvider>,
    );

    await vi.waitFor(() => {
      expect(failure).toBeNull();
      expect(results).toHaveLength(26);
    });
  });
});

describe("OverlayTransportProvider with no transport available", () => {
  afterEach(() => {
    delete (window as { __xbTransport?: unknown }).__xbTransport;
  });

  it("renders children, warns once, and supplies a no-op transport when window.__xbTransport is absent", async () => {
    delete (window as { __xbTransport?: unknown }).__xbTransport;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let childRendered = false;
    let noopResolved = false;
    let noopThrew: unknown = null;

    function Consumer(): null {
      childRendered = true;
      const transport = useTransport();
      useEffect(() => {
        void (async () => {
          try {
            await transport.getOverlayReadiness();
            noopResolved = true;
          } catch (err) {
            noopThrew = err;
          }
        })();
      }, [transport]);
      return null;
    }

    // Provider invoked without an explicit transport prop → falls back to
    // window.__xbTransport, which is absent → no-op transport + one warning.
    render(
      <OverlayTransportProvider>
        <Consumer />
      </OverlayTransportProvider>,
    );

    expect(childRendered).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("transport not available");

    await vi.waitFor(() => {
      expect(noopThrew).toBeNull();
      expect(noopResolved).toBe(true);
    });

    warnSpy.mockRestore();
  });
});

describe("useTransport outside a provider", () => {
  it("throws the dev invariant when called with no OverlayTransportProvider ancestor", () => {
    // React surfaces the throw on render; suppress the noisy error boundary log.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Orphan(): null {
      useTransport();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow();

    errorSpy.mockRestore();
  });
});
