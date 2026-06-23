// @x-builder/overlay — transport context provider (XOB-019)
//
// `OverlayTransportProvider` is the single seam where the overlay's React tree
// receives its `EngineTransport`. In production the transport is bound to the
// page by the runner (`window.__xbTransport`, XOB-015); in tests a
// `FakeEngineTransport` is injected via the `transport` prop.
//
// The provider resolves its transport once, holds it in a stable ref so the
// context value identity never changes for the lifetime of the shadow root
// (L3), and degrades gracefully when no transport is available: it logs a
// single dev warning and supplies a no-op transport so `useTransport()`
// consumers never throw on a method call.

import type { EngineTransport } from "@x-builder/shared";
import { ENGINE_TRANSPORT_BINDINGS } from "@x-builder/shared";
import type { ReactNode } from "react";
import { createContext, useRef } from "react";

/** The context carries either a real/fake transport, or `null` outside a provider. */
export const OverlayTransportContext = createContext<EngineTransport | null>(
  null,
);

declare global {
  interface Window {
    /** Engine transport bound to the page by the runner (XOB-015). */
    __xbTransport?: EngineTransport;
  }
}

export interface OverlayTransportProviderProps {
  /**
   * The transport to provide. OPTIONAL: when omitted the provider falls back to
   * `window.__xbTransport`, and if that is also absent, to a no-op transport
   * (with a one-time dev warning).
   */
  transport?: EngineTransport;
  children: ReactNode;
}

/**
 * Build a no-op `EngineTransport` whose every method resolves to a safe default
 * (`{}` cast to the method's return type) so children never throw when the
 * engine is not connected. The `{} as EngineTransport` cast is the single
 * unavoidable boundary: keys are assigned dynamically from the real binding
 * registry, which keeps the no-op in lockstep with the 17-method contract.
 */
function createNoopTransport(): EngineTransport {
  const transport = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const methodName of Object.keys(ENGINE_TRANSPORT_BINDINGS)) {
    transport[methodName] = () => Promise.resolve({});
  }
  return transport as unknown as EngineTransport;
}

/** Resolve the transport once, warning + falling back to a no-op when absent. */
function resolveTransport(explicit: EngineTransport | undefined): EngineTransport {
  if (explicit) return explicit;

  const fromWindow = window.__xbTransport;
  if (fromWindow) return fromWindow;

  console.warn(
    "[xb] transport not available — overlay running without engine connection",
  );
  return createNoopTransport();
}

/**
 * Provides the resolved `EngineTransport` to the overlay subtree. The transport
 * reference is captured on first render and held stable for the provider's
 * lifetime (cross-overlay L3 state).
 */
export function OverlayTransportProvider({
  transport,
  children,
}: OverlayTransportProviderProps): ReactNode {
  // Resolve exactly once: the lazy-init ref captures the transport (and emits
  // the single warning) on the first render only.
  const ref = useRef<EngineTransport | null>(null);
  if (ref.current === null) {
    ref.current = resolveTransport(transport);
  }

  return (
    <OverlayTransportContext.Provider value={ref.current}>
      {children}
    </OverlayTransportContext.Provider>
  );
}
