/**
 * Transport-assembly seam (XOB-033).
 *
 * The runner exposes 24 raw `__xbuilder_<method>` functions on the page (via
 * {@link ExposeFunctionTransport.bindAll} → `page.exposeFunction`), which surface
 * as `window.__xbuilder_<method>`. The overlay, however, reads a single assembled
 * `window.__xbTransport` object ({@link OverlayTransportProvider}). This module is
 * the missing seam: given a window-like object carrying the exposed bindings, it
 * installs `window.__xbTransport` as an `EngineTransport` whose methods are
 * exactly the `EngineTransport` surface (1:1 with `ENGINE_TRANSPORT_BINDINGS`),
 * each delegating to its matching `__xbuilder_<method>` binding.
 *
 * One canonical implementation: the same pure `assembleTransport` is unit-tested
 * directly (Node) and serialized into the page by `RunnerApp.start()` via
 * `addInitScript` / `page.evaluate`. To stay serializable (Playwright stringifies
 * the function and loses closures), the binding registry is passed in as a
 * parameter when run in the page; the Node/unit caller relies on the imported
 * default.
 */

import { ENGINE_TRANSPORT_BINDINGS } from "@x-builder/shared";

/**
 * Minimal window-like surface the assembly touches: the exposed
 * `__xbuilder_<method>` callables (read by binding name) and the assembled
 * `__xbTransport` slot (written here). Indexed by string so the binding lookup
 * and the transport install are both expressible without a `Window` type in the
 * Node unit context.
 */
export interface TransportWindowLike {
  [bindingOrTransport: string]: unknown;
  __xbTransport?: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

/**
 * Install `win.__xbTransport` as the assembled `EngineTransport`, deriving the
 * method set from the shared binding registry so it stays 1:1 by construction
 * (no hand-duplicated list to drift). Each transport method delegates to its
 * matching `win.__xbuilder_<method>` binding, forwarding all arguments verbatim
 * and returning the binding's promise untouched — so a binding rejection
 * propagates as a rejection (nothing is swallowed).
 *
 * Re-runnable (init scripts re-execute on SPA navigation): a second call simply
 * re-installs a valid full-surface transport over the live bindings.
 *
 * @param win      the page window (or a window-like fake in unit tests).
 * @param bindings the method → binding-name registry. Defaults to the imported
 *   `ENGINE_TRANSPORT_BINDINGS` for Node callers; passed explicitly when this
 *   function is serialized into the page (where the closure import is absent).
 */
export function assembleTransport(
  win: TransportWindowLike,
  bindings: Readonly<Record<string, string>> = ENGINE_TRANSPORT_BINDINGS,
): void {
  const transport: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const method of Object.keys(bindings)) {
    const bindingName = bindings[method];
    if (bindingName === undefined) {
      throw new Error(`No binding name registered for transport method "${method}".`);
    }
    transport[method] = (...args: unknown[]): Promise<unknown> => {
      const binding = win[bindingName];
      if (typeof binding !== "function") {
        throw new Error(`Transport binding "${bindingName}" is not exposed on the page.`);
      }
      return (binding as (...a: unknown[]) => Promise<unknown>)(...args);
    };
  }

  win.__xbTransport = transport;
}
