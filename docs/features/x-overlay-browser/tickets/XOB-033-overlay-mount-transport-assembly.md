---
status: in-progress
---

# XOB-033: Browser-safe overlay bundle + `window.__xbTransport` assembly seam (overlay-mount remediation)

Depends on: XOB-015, XOB-016, XOB-018, XOB-030. Unblocks: XOB-031 (re-validate), XOB-032.

> **Why this ticket exists.** XOB-031's [E2E] suite (Purple authored, Blue validated as correct) proved the overlay's injected-into-browser path is broken in the built artifact — `IMPLEMENTATION_BROKEN`, confirmed by a direct `addInitScript` browser probe (`window.__xbBootstrap` and `window.__xbTransport` both `undefined`, pageerror `process is not defined`). The capture half (Flow D, invariants #1/#2) works; the overlay-mount + transport half never did. This ticket fixes the two root-cause production defects so the 8 failing XOB-031 flows pass. It is a behavior fix with genuinely new logic (the transport-assembly seam), so it runs the **standard pipeline** (Red → Blue → Green → Blue+Yellow), with the existing XOB-031 E2E as the integration acceptance gate.

## Implementation Details

Two defects, both owned by prior "done" tickets:

1. **Browser-safe overlay bundle (config; XOB-018 gap).** `overlay/vite.config.ts` declares no `define`, so the production IIFE (`overlay/dist/overlay.iife.js`) ships ~46 bare `process.*` references (React's `process.env.NODE_ENV`, plus others). Injected into a raw page via `addInitScript`, the IIFE throws `process is not defined` at eval time — before `window.__xbBootstrap = bootstrap` (`overlay/src/index.ts`) is ever assigned. Add the minimal `define` (and/or rollup config) that eliminates **every** bare `process` reference such that the rebuilt bundle evaluates in a raw page without throwing. Verify against the rebuilt bundle, not just the config (a single `process.env.NODE_ENV` define may not remove all refs — confirm none remain).

2. **`window.__xbTransport` assembly seam (wiring; XOB-015/016 gap).** The overlay reads `window.__xbTransport` as an `EngineTransport` object (`overlay/src/transport/provider.tsx`), falling back to a warned no-op when absent. The runner's `ExposeFunctionTransport.bindAll` only exposes raw `window.__xbuilder_<method>` functions via `page.exposeFunction`; **nothing assembles them into the `EngineTransport` object**. Build the missing seam: the runner must, in the page context and **before the overlay bootstrap reads the transport**, construct `window.__xbTransport` as an object whose methods are exactly the `EngineTransport` surface, each delegating to its corresponding exposed `__xbuilder_<method>` binding and resolving its result. The assembly MUST derive the method set from the shared source of truth (`ENGINE_TRANSPORT_BINDINGS` / the `EngineTransport` method-name map in `shared/src/schemas/engine-transport.ts`), not a hand-duplicated list, so it stays 1:1 by construction. This keeps the overlay transport-agnostic (the MV3/extension future swaps only this seam).

3. **Overlay bootstrap is never invoked (wiring; XOB-015 gap — found during pre-Green diligence, 2026-06-23).** `overlay/src/index.ts` only *assigns* `window.__xbBootstrap = bootstrap`; nothing calls it. `RunnerApp.start()` injects the bundle → `bindTransport` → `attachObserver` → `goto`, but **never invokes `window.__xbBootstrap()`**, so even a browser-safe, transport-assembled overlay would not mount. The runner must invoke the overlay bootstrap in the page **after** the bundle is injected, the `__xbuilder_*` bindings are exposed, and `window.__xbTransport` is assembled (so the provider reads a real transport on mount), and after the page is ready. Follow the existing injectable-seam pattern in `RunnerApp` (like `bindTransport`/`attachObserver`) so the start step stays overridable by tests; keep the existing `runner-app.test.ts` call-order tests passing. This is E2E-gated (proven by XOB-031's mount flows), like AC-3/AC-4.

## Data Models

No new schemas. Reuses the existing `EngineTransport` interface and the `ENGINE_TRANSPORT_BINDINGS` (17 `__xbuilder_*` name) map in `@x-builder/shared`.

## Integration Point

Production entry: `runner/bin/x-builder.js` → `RunnerApp.start()` (`addInitScript(bundle)` → `bindTransport` → `attachObserver` → `goto`). The transport-assembly seam is injected by the runner alongside/after `bindAll`. The consumer is unchanged: `overlay/src/transport/provider.tsx` reads `window.__xbTransport`. Terminal outcome: the overlay mounts and its `useTransport()` calls reach the real in-process engine.

## Scope Boundaries / Out of Scope

- **MAY change:** `overlay/vite.config.ts` (define/rollup), the runner transport-assembly seam (`runner/src/expose-function-transport.ts` and/or `runner/src/runner-app.ts`), and — only if assembly needs it — a re-export in `@x-builder/shared`. Plus the focused Red test(s) for the seam.
- **MUST NOT change:** the overlay's transport-consuming code (`provider.tsx`, `use-transport.ts` — they already read `window.__xbTransport` correctly), XOB-031's E2E specs/fixtures (they are the acceptance, validated good), the engine, XOB-030's `BoundEngineServices` adapter. No fallback/dual-path/compat shim — one canonical assembly path (zero-trace).
- Do **not** broaden the bundle config beyond what is needed to remove the `process` refs (no unrelated build retuning).

## Test Strategy & Fixture Ownership

- **Unit/integration (Red, fast):** the transport-assembly seam — assert that, given exposed `__xbuilder_*` bindings, `window.__xbTransport` is assembled with exactly the 17 `EngineTransport` methods (1:1 with `ENGINE_TRANSPORT_BINDINGS`, no missing/extra), each delegating to its binding with the same arguments and resolving/rejecting with the binding's result (errors propagate, not swallowed). Owning suite: the runner package, extending the `expose-function-transport.test.ts` fake-page pattern. If a sub-behavior has no clean fast seam, Red names it and defers it to the E2E gate rather than testing internals.
- **Browser-safety:** primarily proven by the XOB-031 E2E (overlay actually mounts). A fast static assertion that the rebuilt bundle contains no bare `process` token is acceptable but optional; do not make it brittle.
- **Integration acceptance gate (validation, not Red):** re-run the existing XOB-031 E2E — the 8 previously-failing flows (A, B, C, E, F + invariants #3, #4, #5) must pass; the 25 already-passing tests stay green.
- Isolation: no `~/.x-builder`; tmpdir/fakes only.

## Definition of Done

- New seam test(s) pass; XOB-031's 8 failing flows pass; full regression green (runner, engine, shared, overlay, client); `pnpm typecheck` + `pnpm lint` clean.
- The rebuilt `overlay/dist/overlay.iife.js` evaluates in a raw page without throwing and assigns `window.__xbBootstrap`.
- XOB-031 re-validated to **done**; XOB-032 unblocked.

## Acceptance Criteria

- **AC-1 (assembly exists & complete):** Given the runner has exposed the 17 `__xbuilder_*` bindings on the page, When the page initializes before the overlay bootstrap reads the transport, Then `window.__xbTransport` is an object whose methods are exactly the `EngineTransport` surface (1:1 with `ENGINE_TRANSPORT_BINDINGS` — no missing, no extra).
- **AC-2 (delegation correctness):** Given `window.__xbTransport` is assembled, When `__xbTransport.<method>(...args)` is called, Then it invokes `window.__xbuilder_<method>(...args)` and resolves with the binding's result; a binding rejection propagates as a rejection (not swallowed).
- **AC-3 (browser-safe bundle):** Given the production overlay bundle, When it is injected into a raw page via `addInitScript`, Then it evaluates without throwing and `window.__xbBootstrap` becomes defined.
- **AC-4 (bootstrap invoked; E2E-gated):** Given the bundle is injected, the bindings exposed, and `window.__xbTransport` assembled, When `RunnerApp.start()` completes, Then the runner has invoked `window.__xbBootstrap()` in the page so the overlay mounts; the new start step is injectable (overridable) and the existing `runner-app.test.ts` call-order tests still pass.
- **AC-5 (end-to-end):** Given AC-1..AC-4, When the XOB-031 E2E suite runs, Then the 8 previously-failing overlay-mount flows pass and the overlay reaches the real engine via `useTransport()`; the 25 already-passing tests stay green.

## Pipeline Log

### 2026-06-23 — in-progress
- Authored as remediation for XOB-031 `IMPLEMENTATION_BROKEN`. Red (`af4a2d6`) added `runner/src/transport-assembly.test.ts` (assembly-seam contract); Blue **Validate Red: APPROVE** (falsifiable; AC-3 deferral to E2E gate confirmed sound).
- **Scope expanded pre-Green:** orchestrator diligence found a third gap — `window.__xbBootstrap()` is never invoked by the runner (defect #3 above). Folded into scope (same overlay-mount defect class; user had authorized "fix now"). E2E-gated.

## Edge Cases

- **Init-script ordering:** `window.__xbTransport` must be present before the overlay bootstrap's provider read; verify the assembly is not racing the bootstrap.
- **Source-of-truth coupling:** if a future `EngineTransport` method is added, the assembly must pick it up from the shared map automatically (no duplicated list to drift).
- **Error propagation:** a binding that throws/rejects must surface through the transport method; no empty catch.
- **No double-assembly / no clobber:** re-navigation (SPA) must leave a valid `__xbTransport` (init scripts re-run on navigation) without breaking the exposed bindings.
