// @x-builder/client — v2 Skeleton primitive (token-driven, shadow-DOM-portable)
//
// A layout-preserving loading placeholder. Carries a `data-skeleton` marker so
// tests and consumers can detect the loading state, and a `role="status"` so it
// is announced. Styles travel inline as `var(--…)` references; no global CSS.

import type { CSSProperties, ReactElement } from "react";

export interface SkeletonProps {
  width?: string;
  height?: string;
}

/** A token-driven loading placeholder. */
export function Skeleton({ width, height }: SkeletonProps = {}): ReactElement {
  const style: CSSProperties = {
    display: "block",
    width: width ?? "100%",
    height: height ?? "var(--control-height-sm)",
    borderRadius: "var(--radius-md)",
    background: "var(--neutral-4)",
    opacity: 0.6,
  };

  return <div data-skeleton="" role="status" aria-label="Loading" style={style} />;
}
