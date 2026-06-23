// @x-builder/overlay — SuggestAffordance + SuggestCard (home/profile suggest-post)
//
// A purely presentational, cooldown-aware suggest-post affordance. It renders a
// persistent launcher (the suggest entry point near the compose cluster) and,
// when `open`, an anchored card body that reflects the injected `SuggestState`:
// the loading skeleton, the ready suggestion (text + rationale + an optional
// warning cooldown Badge + a "Use this" ghost button), the cooldown-blocked
// warning Alert, the empty-corpus v2 EmptyState, and the error danger Alert with
// a retry. `open` is a CONTROLLED prop — the parent owns the boolean and this
// component holds no internal open state, calling `onToggle` to REQUEST a change.
//
// Everything here is presentational: the `suggestPost` transport, the route gate
// (home/profile detection), and the parent's composer-write gesture are OUT OF
// SCOPE (owned by `AnchorLayer` / the parent affordance holder). The component
// drives only its declared callbacks and never auto-fires `onUse`/`onRefresh` —
// "Use this" hands back the EXACT suggestion text on an explicit click, and the
// component never posts. The v2 primitives are consumed cross-package the same
// way `static-engine-column.tsx` and `judge/judge-strip.tsx` do; all visuals come
// from `--xb-*` / `--space-*` / `--type-*` tokens resolved on the shadow `:host`.

import type { CooldownSignal, DetectedPostFormat } from "@x-builder/shared";
import type { CSSProperties, ReactElement } from "react";

import { Alert } from "../../../client/src/ui/v2/alert";
import { Badge } from "../../../client/src/ui/v2/badge";
import { Button } from "../../../client/src/ui/v2/button";
import { EmptyState } from "../../../client/src/ui/v2/empty-state";
import { IconButton } from "../../../client/src/ui/v2/icon-button";
import { Skeleton } from "../../../client/src/ui/v2/skeleton";

/**
 * The overlay-local suggest UI-state union. The parent affordance holder maps a
 * `SuggestPostResponse` into one of these before passing it down; the test
 * fixtures (`../testing/suggest-state.ts`) re-use this exported type so the
 * component and its tests share one definition.
 */
export type SuggestState =
  | "idle"
  | "loading"
  | {
      status: "ready";
      text: string;
      rationale: string;
      format: DetectedPostFormat;
      cooldown?: CooldownSignal;
    }
  | { status: "cooldown_blocked"; reason: string; signal: CooldownSignal }
  | { status: "empty"; reason: string }
  | { status: "error"; error: string };

export interface SuggestAffordanceProps {
  suggestion: SuggestState;
  onRefresh: () => void;
  onUse: (text: string) => void;
  open: boolean;
  onToggle: () => void;
}

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  marginTop: "var(--space-2)",
  padding: "var(--space-3)",
  background: "var(--xb-surface-panel)",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--xb-glow-md)",
};

const TEXT_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-body)",
  color: "var(--xb-text)",
};

const RATIONALE_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-body-small)",
  color: "var(--xb-text-muted)",
};

/**
 * The "Use this" control: a ghost Button (transparent fill — never the primary
 * `--xb-accent` CTA, never judge-cyan) carrying a single `--xb-accent` edge on a
 * wrapping span, since the v2 Button exposes no `style`/`className` (same pattern
 * XOB-027's apply affordance used for the judge edge). Clicking it hands the
 * EXACT suggestion `text` back to the parent on the explicit gesture only.
 */
function UseThisButton({ text, onUse }: { text: string; onUse: (text: string) => void }): ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        borderRadius: "var(--radius-md)",
        border: "var(--border-width-thin) solid var(--xb-accent)",
        boxShadow: "var(--xb-glow-sm)",
      }}
    >
      <Button variant="ghost" onClick={() => onUse(text)}>
        Use this
      </Button>
    </span>
  );
}

/** The ready body: suggestion text + rationale + optional cooldown Badge + Use this. */
function ReadyBody({
  text,
  rationale,
  cooldown,
  onUse,
}: {
  text: string;
  rationale: string;
  cooldown?: CooldownSignal;
  onUse: (text: string) => void;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {cooldown ? <Badge variant="warning">{cooldown.message}</Badge> : null}
      <p style={TEXT_STYLE}>{text}</p>
      <p style={RATIONALE_STYLE}>{rationale}</p>
      <UseThisButton text={text} onUse={onUse} />
    </div>
  );
}

/** The card body for the current suggestion; `idle` renders nothing (parent loads). */
function SuggestCard({
  suggestion,
  onRefresh,
  onUse,
}: {
  suggestion: SuggestState;
  onRefresh: () => void;
  onUse: (text: string) => void;
}): ReactElement {
  return (
    <div style={CARD_STYLE}>
      {suggestion === "loading" ? <Skeleton height="var(--space-12)" /> : null}

      {typeof suggestion === "object" && suggestion.status === "ready" ? (
        <ReadyBody
          text={suggestion.text}
          rationale={suggestion.rationale}
          cooldown={suggestion.cooldown}
          onUse={onUse}
        />
      ) : null}

      {typeof suggestion === "object" && suggestion.status === "cooldown_blocked" ? (
        <Alert variant="warning">
          <span>{suggestion.reason}</span>
        </Alert>
      ) : null}

      {typeof suggestion === "object" && suggestion.status === "empty" ? (
        <EmptyState title="No post history yet">
          Capture some posts first — there isn’t enough post history yet to suggest from.
        </EmptyState>
      ) : null}

      {typeof suggestion === "object" && suggestion.status === "error" ? (
        <Alert variant="danger">
          <span>Couldn’t generate a suggestion. {suggestion.error}</span>
          <div style={{ marginTop: "var(--space-2)" }}>
            <Button variant="ghost" onClick={onRefresh}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * The suggest affordance. Renders the persistent launcher always; the card body
 * renders only when `open === true` (controlled). The launcher requests a toggle
 * and never loads/uses on its own.
 */
export function SuggestAffordance({
  suggestion,
  onRefresh,
  onUse,
  open,
  onToggle,
}: SuggestAffordanceProps): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          borderRadius: "var(--radius-md)",
          border: "var(--border-width-thin) solid var(--xb-accent)",
          boxShadow: "var(--xb-glow-sm)",
        }}
      >
        <IconButton label="Suggest a post" icon={<span aria-hidden="true">✦</span>} onClick={onToggle} />
      </span>

      {open ? (
        <SuggestCard suggestion={suggestion} onRefresh={onRefresh} onUse={onUse} />
      ) : null}
    </div>
  );
}
