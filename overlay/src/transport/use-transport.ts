// @x-builder/overlay — useTransport hook (XOB-019)
//
// Reads the `EngineTransport` from `OverlayTransportContext`. Throws a dev
// invariant when used outside an `OverlayTransportProvider` so a missing seam
// surfaces immediately at the call site rather than as a confusing `null`
// dereference downstream.

import type { EngineTransport } from "@x-builder/shared";
import { useContext } from "react";

import { OverlayTransportContext } from "./provider";

/**
 * Returns the typed `EngineTransport` provided by the nearest
 * `OverlayTransportProvider`. Throws if no provider is present.
 */
export function useTransport(): EngineTransport {
  const transport = useContext(OverlayTransportContext);
  if (transport === null) {
    throw new Error(
      "[xb] useTransport() called outside an OverlayTransportProvider",
    );
  }
  return transport;
}
