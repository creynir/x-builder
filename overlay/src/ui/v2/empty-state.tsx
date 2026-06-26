// @x-builder/client — v2 EmptyState primitive (token-driven, shadow-DOM-portable)
//
// A muted "nothing here yet" section: a title, a body (children), and an
// optional action region. It mirrors the legacy `../foundation.tsx` EmptyState
// prop shape — `{ title, children, action? }` — but carries its styles inline as
// `var(--…)` references into the seeded token closure (no global classnames), so
// it travels into the overlay shadow `:host` as well as the SPA `:root`. The
// action region renders ONLY when an `action` is provided. XOB-028 is its first
// consumer (the suggest card's "no post history" state).

import type { CSSProperties, ReactElement, ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

const SECTION_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  color: "var(--xb-text-muted)",
  textAlign: "center",
};

const TITLE_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-panel-title)",
  color: "var(--xb-text-muted)",
};

const BODY_STYLE: CSSProperties = {
  font: "var(--type-body-small)",
  color: "var(--xb-text-muted)",
};

const ACTION_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  marginTop: "var(--space-1)",
};

/** A token-driven empty-state section. */
export function EmptyState({ title, children, action }: EmptyStateProps): ReactElement {
  return (
    <section style={SECTION_STYLE}>
      <h2 style={TITLE_STYLE}>{title}</h2>
      <div style={BODY_STYLE}>{children}</div>
      {action ? <div style={ACTION_STYLE}>{action}</div> : null}
    </section>
  );
}
