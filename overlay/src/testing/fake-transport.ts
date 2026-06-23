// @x-builder/overlay — FakeEngineTransport (test-only)
//
// A configurable, type-safe stand-in for the REAL shared `EngineTransport`.
// It implements all 17 methods; each resolves to a minimal valid
// default (`{}` cast to the method's return type) unless an override is
// supplied via the constructor. Used as the injected transport in overlay
// tests via `OverlayTransportProvider`.
//
// Methods are bound in the constructor (closing over `overrides`, not `this`)
// so a test may extract a method and invoke it detached — `const fn =
// fake.getStatus; fn()` — without an unbound-`this` crash.

import type { EngineTransport } from "@x-builder/shared";

/**
 * Per-method override map. Every key is optional; an omitted method falls back
 * to the default resolver (`Promise.resolve({})` cast to the return type).
 */
export type FakeTransportOverrides = Partial<EngineTransport>;

/**
 * Resolve to a minimal valid value for a method whose return shape we do not
 * model in tests. `{}` satisfies the structurally-typed response objects, and
 * is cast at the single no-op boundary so each public method stays fully typed.
 */
function defaultResolve<T>(): Promise<T> {
  return Promise.resolve({} as T);
}

/**
 * Build a bound method: call the override when present, else the default
 * resolver. The returned function closes over `overrides` and never reads
 * `this`, so it is safe to invoke detached.
 */
function bind<K extends keyof EngineTransport>(
  overrides: FakeTransportOverrides,
  key: K,
): EngineTransport[K] {
  const fn = ((...args: Parameters<EngineTransport[K]>) => {
    const override = overrides[key] as
      | ((...a: Parameters<EngineTransport[K]>) => ReturnType<EngineTransport[K]>)
      | undefined;
    return override
      ? override(...args)
      : defaultResolve<Awaited<ReturnType<EngineTransport[K]>>>();
  }) as EngineTransport[K];
  return fn;
}

/**
 * Test-only `EngineTransport`. `const t: EngineTransport = new
 * FakeEngineTransport()` type-checks, and the instance exposes exactly the 17
 * method names in `ENGINE_TRANSPORT_BINDINGS`.
 */
export class FakeEngineTransport implements EngineTransport {
  getOverlayReadiness: EngineTransport["getOverlayReadiness"];
  getStatus: EngineTransport["getStatus"];
  getSettings: EngineTransport["getSettings"];
  updateSettings: EngineTransport["updateSettings"];
  validateArchive: EngineTransport["validateArchive"];
  importArchive: EngineTransport["importArchive"];
  getActiveContext: EngineTransport["getActiveContext"];
  activateContext: EngineTransport["activateContext"];
  deactivateContext: EngineTransport["deactivateContext"];
  analyzePosts: EngineTransport["analyzePosts"];
  judgeDraft: EngineTransport["judgeDraft"];
  generateIdeas: EngineTransport["generateIdeas"];
  suggestPost: EngineTransport["suggestPost"];
  getCooldown: EngineTransport["getCooldown"];
  getCaptureSummary: EngineTransport["getCaptureSummary"];
  getGenerateCategories: EngineTransport["getGenerateCategories"];
  applyJudgeSuggestions: EngineTransport["applyJudgeSuggestions"];

  constructor(overrides: FakeTransportOverrides = {}) {
    this.getOverlayReadiness = bind(overrides, "getOverlayReadiness");
    this.getStatus = bind(overrides, "getStatus");
    this.getSettings = bind(overrides, "getSettings");
    this.updateSettings = bind(overrides, "updateSettings");
    this.validateArchive = bind(overrides, "validateArchive");
    this.importArchive = bind(overrides, "importArchive");
    this.getActiveContext = bind(overrides, "getActiveContext");
    this.activateContext = bind(overrides, "activateContext");
    this.deactivateContext = bind(overrides, "deactivateContext");
    this.analyzePosts = bind(overrides, "analyzePosts");
    this.judgeDraft = bind(overrides, "judgeDraft");
    this.generateIdeas = bind(overrides, "generateIdeas");
    this.suggestPost = bind(overrides, "suggestPost");
    this.getCooldown = bind(overrides, "getCooldown");
    this.getCaptureSummary = bind(overrides, "getCaptureSummary");
    this.getGenerateCategories = bind(overrides, "getGenerateCategories");
    this.applyJudgeSuggestions = bind(overrides, "applyJudgeSuggestions");
  }
}
