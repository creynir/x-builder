// @x-builder/overlay — EngineTransport type seam (XOB-019)
//
// Re-exports the REAL shared `EngineTransport` interface (defined in XOB-002,
// `@x-builder/shared`). The overlay consumes the type only; there is no
// overlay-local copy of the interface so the 20-method contract stays single-
// sourced.

export type { EngineTransport } from "@x-builder/shared";
