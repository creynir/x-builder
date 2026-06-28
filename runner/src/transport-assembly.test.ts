/**
 * Failing tests for the page-context transport-assembly seam.
 *
 * The runner exposes 20 raw `__xbuilder_<method>` functions on the page (via
 * `ExposeFunctionTransport.bindAll` → `page.exposeFunction`), which surface in the
 * page context as `window.__xbuilder_<method>`. The overlay, however, reads a
 * single assembled `window.__xbTransport` object (`overlay/src/transport/provider.tsx`).
 * Nothing assembles the raw bindings into that object — so the overlay always
 * falls back to its warned no-op and never reaches the real engine.
 *
 * This file pins the assembly contract at a fast, browser-free seam: an assembly
 * routine that, given a window-like object carrying the exposed `__xbuilder_*`
 * functions, installs `window.__xbTransport` as an `EngineTransport`.
 *
 * The module under test (`./transport-assembly`) does not exist yet, so the
 * import below resolves to nothing until the implementation lands. That is the
 * intended Red state: these tests fail on a missing implementation, not on a
 * logic error in the test itself.
 *
 * Contract Green must satisfy (specified by behavior, not internal layout):
 *   - `assembleTransport(win)` installs `win.__xbTransport`.
 *   - `__xbTransport` has exactly the `EngineTransport` method set — 1:1 with the
 *     keys of `ENGINE_TRANSPORT_BINDINGS` (no missing, no extra). The expected set
 *     is derived from the shared registry so a hardcoded/partial list fails.
 *   - `__xbTransport.<method>(...args)` invokes the matching
 *     `win.__xbuilder_<method>(...args)` with the same arguments and resolves with
 *     its result; a binding that rejects propagates as a rejection (not swallowed).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ENGINE_TRANSPORT_BINDINGS } from "@x-builder/shared";

import { assembleTransport } from "./transport-assembly";

// ---------------------------------------------------------------------------
// Fake window carrying the 20 exposed `__xbuilder_<method>` functions.
//
// Mirrors the production boundary: `page.exposeFunction(name, fn)` installs a
// global `window[name]` callable. Each binding is a vi.fn echoing a tagged
// payload so a call can be traced back to the exact binding it routed through.
// ---------------------------------------------------------------------------

interface FakeWindow {
  [bindingName: string]: unknown;
  __xbTransport?: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

/** The `EngineTransport` method names, derived live from the shared registry. */
function transportMethodNames(): string[] {
  return Object.keys(ENGINE_TRANSPORT_BINDINGS);
}

/**
 * Build a fake window with every `__xbuilder_<method>` binding installed. Each
 * binding resolves to a value tagged with the method name + the args it received,
 * so delegation can be verified end-to-end.
 */
function createFakeWindowWithBindings(): {
  win: FakeWindow;
  bindings: Record<string, ReturnType<typeof vi.fn>>;
} {
  const win = {} as FakeWindow;
  const bindings: Record<string, ReturnType<typeof vi.fn>> = {};

  for (const method of transportMethodNames()) {
    const bindingName = ENGINE_TRANSPORT_BINDINGS[method];
    if (bindingName === undefined) {
      throw new Error(`No binding name registered for transport method "${method}".`);
    }
    const fn = vi.fn(async (...args: unknown[]) => ({ ok: method, args }));
    bindings[method] = fn;
    win[bindingName] = fn;
  }

  return { win, bindings };
}

let fake: ReturnType<typeof createFakeWindowWithBindings>;

beforeEach(() => {
  fake = createFakeWindowWithBindings();
});

/**
 * Read the assembled transport after `assembleTransport(win)` has run. Throws if
 * absent so a non-assembling implementation fails loudly here rather than reading
 * as `undefined` at a call site. Returns a callable record so individual method
 * calls stay free of `possibly undefined` type noise.
 */
function assembledTransport(): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const transport = fake.win.__xbTransport;
  if (transport === undefined) {
    throw new Error("assembleTransport did not install window.__xbTransport.");
  }
  return transport;
}

/** Fetch the spy for one binding, throwing if the test fixture lacks it. */
function bindingSpy(method: string): ReturnType<typeof vi.fn> {
  const spy = fake.bindings[method];
  if (spy === undefined) {
    throw new Error(`No fake binding registered for method "${method}".`);
  }
  return spy;
}

/** Invoke an assembled transport method by name with the given args. */
function callTransport(method: string, ...args: unknown[]): Promise<unknown> {
  const transport = assembledTransport();
  const fn = transport[method];
  if (fn === undefined) {
    throw new Error(`Assembled transport is missing method "${method}".`);
  }
  return fn(...args);
}

// ---------------------------------------------------------------------------
// AC-1 — assembly exists & complete
// ---------------------------------------------------------------------------

describe("transport assembly — installs window.__xbTransport with the full EngineTransport surface", () => {
  it("installs an __xbTransport object on the window", () => {
    assembleTransport(fake.win);

    expect(fake.win.__xbTransport).toBeTypeOf("object");
    expect(fake.win.__xbTransport).not.toBeNull();
  });

  it("exposes exactly the EngineTransport method set, 1:1 with ENGINE_TRANSPORT_BINDINGS — no missing, no extra", () => {
    assembleTransport(fake.win);

    const expected = transportMethodNames().slice().sort();
    const actual = Object.keys(assembledTransport()).sort();

    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(20);
  });

  it("makes every assembled transport method callable", () => {
    assembleTransport(fake.win);

    const transport = assembledTransport();
    for (const method of transportMethodNames()) {
      expect(transport[method]).toBeTypeOf("function");
    }
  });
});

// ---------------------------------------------------------------------------
// AC-2 — delegation correctness
// ---------------------------------------------------------------------------

describe("transport assembly — each method delegates to its matching __xbuilder_<method> binding", () => {
  it("invokes the matching binding with the same arguments and resolves with its result", async () => {
    assembleTransport(fake.win);

    // judgeDraft carries a request arg through to the binding.
    const request = { text: "Is this a good post?", accountProfile: "founder" };
    const result = await callTransport("judgeDraft", request);

    expect(bindingSpy("judgeDraft")).toHaveBeenCalledTimes(1);
    expect(bindingSpy("judgeDraft")).toHaveBeenCalledWith(request);
    // The transport resolves with the binding's own return value, untouched.
    expect(result).toEqual({ ok: "judgeDraft", args: [request] });
  });

  it("forwards positional arguments verbatim (e.g. getCooldown windowDays)", async () => {
    assembleTransport(fake.win);

    const result = await callTransport("getCooldown", 14);

    expect(bindingSpy("getCooldown")).toHaveBeenCalledWith(14);
    expect(result).toEqual({ ok: "getCooldown", args: [14] });
  });

  it("routes each method to its own binding and no other", async () => {
    assembleTransport(fake.win);

    await callTransport("getStatus");

    expect(bindingSpy("getStatus")).toHaveBeenCalledTimes(1);
    expect(bindingSpy("getOverlayReadiness")).not.toHaveBeenCalled();
    expect(bindingSpy("judgeDraft")).not.toHaveBeenCalled();
  });

  it("propagates a binding rejection as a rejection (not swallowed)", async () => {
    assembleTransport(fake.win);

    const boom = new Error("engine refused the request");
    bindingSpy("suggestPost").mockRejectedValueOnce(boom);

    await expect(callTransport("suggestPost", {})).rejects.toBe(boom);
  });
});

// ---------------------------------------------------------------------------
// Edge case — source-of-truth coupling (no drift / no double-assembly clobber)
// ---------------------------------------------------------------------------

describe("transport assembly — stays coupled to the shared registry on re-run", () => {
  it("re-running assembly (SPA re-navigation) leaves a valid full-surface transport", async () => {
    assembleTransport(fake.win);
    assembleTransport(fake.win);

    expect(Object.keys(assembledTransport()).sort()).toEqual(transportMethodNames().slice().sort());

    // The re-assembled transport still delegates to the live bindings.
    const result = await callTransport("getCaptureSummary");
    expect(bindingSpy("getCaptureSummary")).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: "getCaptureSummary", args: [] });
  });
});
