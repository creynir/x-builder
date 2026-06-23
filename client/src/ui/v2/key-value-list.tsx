// @x-builder/client — v2 KeyValueList primitive (token-driven, shadow-DOM-portable)
//
// Renders metadata / evidence / timing detail as concise label→value rows. Both
// the key and the value are rendered; values that are IDs / timestamps use the
// mono data type. Styles travel inline as `var(--…)` references; no global CSS.

import type { CSSProperties, ReactElement, ReactNode } from "react";

export interface KeyValueItem {
  key: string;
  value: ReactNode;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
}

const LIST_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "var(--space-1) var(--space-3)",
  margin: 0,
  font: "var(--type-body-small)",
  color: "var(--xb-text)",
};

const KEY_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--xb-text-muted)",
};

const VALUE_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-data)",
  color: "var(--xb-text)",
  wordBreak: "break-word",
};

/** A token-driven key/value detail list. */
export function KeyValueList({ items }: KeyValueListProps): ReactElement {
  return (
    <dl style={LIST_STYLE}>
      {items.map((item) => (
        <div key={item.key} style={{ display: "contents" }}>
          <dt style={KEY_STYLE}>{item.key}</dt>
          <dd style={VALUE_STYLE}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
