// @x-builder/overlay — SuggestAffordance tests (browser mode → Playwright Chromium)
//
// RED: `../suggest-affordance` does not exist yet, so importing
// `SuggestAffordance` is what drives the failing state. These tests pin the
// ticket's 8 cases + the key edges against a PURELY PRESENTATIONAL component: it
// receives `suggestion` (a `SuggestState`), `onRefresh`, `onUse`, `open`, and
// `onToggle` as props and renders. The `suggestPost` transport, the route gate
// (home/profile detection), and the parent's composer-write gesture are OUT OF
// SCOPE here (owned by `AnchorLayer` / the parent affordance holder) —
// `SuggestAffordance` only renders per `suggestion` + `open` and emits its
// callbacks.
//
// `open` is a CONTROLLED prop: the parent owns the boolean and the component
// renders per `open`, calling `onToggle` to REQUEST a change. The component
// holds no internal open state.
//
// Fixtures are REAL shapes (`overlay/src/testing/suggest-state.ts`): the
// `cooldown` / `signal` sub-objects are valid `CooldownSignal` instances from
// `@x-builder/shared` and the `format` fields are real `DetectedPostFormat`
// members, so these tests exercise the exact shape the parent maps from a
// `SuggestPostResponse`.
//
// Harness: the established overlay shadow-host harness (`mountShadowHost`) with
// the design-token + neon sheets adopted, rendered via `vitest-browser-react`
// into the real shadow tree — same pattern as `static-engine-column.test.tsx`,
// `judge-strip.test.tsx`, and `ui-v2.test.tsx`. We assert what is stable in
// browser mode (skeleton markers, variant markers, text, button clicks,
// callback spies), not pixels.

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { mountShadowHost, type ShadowHostHandle } from "../../testing/shadow-host";
import {
  cooldownBlockedState,
  emptyState,
  errorState,
  idleState,
  loadingState,
  readyNoCooldownState,
  readyState,
} from "../../testing/suggest-state";

// Not-yet-existing module — importing it is what drives the RED state.
import { SuggestAffordance, type SuggestState } from "../suggest-affordance";

let harness: ShadowHostHandle;

function mount(ui: ReactNode): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

// --------------------------------------------------------------------------
// Shadow-aware query helpers.
// --------------------------------------------------------------------------

function buttons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
}

function skeletons(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-skeleton]"));
}

function byVariant(root: ParentNode, variant: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-variant="${variant}"]`));
}

/** Alerts in the subtree (assertive live regions from the v2 Alert primitive). */
function alerts(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="alert"]'));
}

/** The "Use this" button by its exact label policy (NOT "Post this"/"Publish"). */
function useThisButton(root: ParentNode): HTMLButtonElement | undefined {
  return buttons(root).find((b) => /use this/i.test(b.textContent ?? ""));
}

/** A retry/refresh affordance by label. */
function retryButton(root: ParentNode): HTMLButtonElement | undefined {
  return buttons(root).find((b) => /retry|try again|refresh/i.test(b.textContent ?? ""));
}

/** Default props with overridable fields; the card is OPEN by default so the
 * body states (loading/ready/blocked/empty/error) are exercised directly. */
function props(
  overrides: Partial<Parameters<typeof SuggestAffordance>[0]> = {},
): Parameters<typeof SuggestAffordance>[0] {
  return {
    suggestion: idleState,
    onRefresh: vi.fn(),
    onUse: vi.fn(),
    open: true,
    onToggle: vi.fn(),
    ...overrides,
  };
}

// Guard: assert the ready fixture really carries the exact text the "Use this"
// contract pins, so a future fixture edit cannot silently turn it tautological.
function readyText(): string {
  if (typeof readyState === "string" || readyState.status !== "ready") {
    throw new Error("readyState fixture must be the ready variant.");
  }
  return readyState.text;
}

// --------------------------------------------------------------------------
// 1. idle (closed) → launcher only; clicking the launcher requests onToggle.
// --------------------------------------------------------------------------

describe("SuggestAffordance — idle / launcher wiring", () => {
  it("renders only the launcher (no card body) when idle and closed", () => {
    const root = mount(
      <SuggestAffordance {...props({ suggestion: idleState, open: false })} />,
    );

    // A launcher control exists…
    expect(buttons(root).length).toBeGreaterThan(0);
    // …but no card-body affordances are present while closed.
    expect(useThisButton(root)).toBeUndefined();
    expect(skeletons(root)).toHaveLength(0);
    expect(alerts(root)).toHaveLength(0);
  });

  it("calls onToggle (not a load/transport) when the launcher is clicked", () => {
    const onToggle = vi.fn();
    const onRefresh = vi.fn();
    const onUse = vi.fn();
    const root = mount(
      <SuggestAffordance
        {...props({ suggestion: idleState, open: false, onToggle, onRefresh, onUse })}
      />,
    );

    // The launcher is the only button while closed; clicking it REQUESTS a
    // toggle. The component owns no open state and never loads on its own.
    const launcher = buttons(root)[0]!;
    launcher.click();

    expect(onToggle).toHaveBeenCalledTimes(1);
    // The presentational component fires no transport/load on click.
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// 2. loading → Skeleton placeholder in the card body; no post text.
// --------------------------------------------------------------------------

describe("SuggestAffordance — loading", () => {
  it("renders a Skeleton placeholder and no suggestion text", () => {
    const root = mount(<SuggestAffordance {...props({ suggestion: loadingState })} />);

    expect(skeletons(root).length).toBeGreaterThan(0);
    // No "Use this" while loading — there is no suggestion to use yet.
    expect(useThisButton(root)).toBeUndefined();
    // The ready fixture's text must NOT leak during loading.
    expect(root.textContent).not.toContain(readyText());
  });
});

// --------------------------------------------------------------------------
// 3. ready → suggested text + rationale + "Use this"; warning Badge when a
//    cooldown is attached.
// --------------------------------------------------------------------------

describe("SuggestAffordance — ready", () => {
  it("shows the suggestion text, the rationale, and a 'Use this' button", () => {
    const root = mount(<SuggestAffordance {...props({ suggestion: readyState })} />);

    if (typeof readyState === "string" || readyState.status !== "ready") {
      throw new Error("readyState fixture must be the ready variant.");
    }
    expect(root.textContent).toContain(readyState.text);
    expect(root.textContent).toContain(readyState.rationale);
    expect(useThisButton(root)).toBeDefined();
  });

  it("renders an inline warning Badge when a cooldown signal is attached", () => {
    const root = mount(<SuggestAffordance {...props({ suggestion: readyState })} />);

    // The cooldown context surfaces as a warning-variant Badge (data-variant),
    // NOT danger (the ready state is informational, not blocking).
    expect(byVariant(root, "warning").length).toBeGreaterThan(0);
    expect(byVariant(root, "danger")).toHaveLength(0);
  });

  it("renders NO badge when the ready suggestion carries no cooldown (clean render)", () => {
    // Edge: `cooldown.signals` empty / absent in the ready response → no badge,
    // no crash. Both the suggestion and "Use this" still render.
    const root = mount(
      <SuggestAffordance {...props({ suggestion: readyNoCooldownState })} />,
    );

    if (typeof readyNoCooldownState === "string" || readyNoCooldownState.status !== "ready") {
      throw new Error("readyNoCooldownState fixture must be the ready variant.");
    }
    expect(root.textContent).toContain(readyNoCooldownState.text);
    expect(useThisButton(root)).toBeDefined();
    // No cooldown context → no badge at all.
    expect(byVariant(root, "warning")).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 4. cooldown_blocked → warning (NOT danger) Alert with the reason; "Use this"
//    is absent.
// --------------------------------------------------------------------------

describe("SuggestAffordance — cooldown blocked", () => {
  it("renders a warning Alert with the reason and NO 'Use this' button", () => {
    const root = mount(
      <SuggestAffordance {...props({ suggestion: cooldownBlockedState })} />,
    );

    if (typeof cooldownBlockedState === "string" || cooldownBlockedState.status !== "cooldown_blocked") {
      throw new Error("cooldownBlockedState fixture must be the cooldown_blocked variant.");
    }

    // The block surfaces as a warning Alert — explicitly NOT danger (a hold, not
    // an error).
    const warningAlerts = alerts(root).filter(
      (a) => a.getAttribute("data-variant") === "warning",
    );
    expect(warningAlerts.length).toBeGreaterThan(0);
    expect(
      alerts(root).some((a) => a.getAttribute("data-variant") === "danger"),
    ).toBe(false);

    // The reason is surfaced verbatim.
    expect(root.textContent).toContain(cooldownBlockedState.reason);

    // "Use this" is absent — the user is being asked to hold off.
    expect(useThisButton(root)).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 5. empty → the v2 EmptyState (insufficient post history); NO Alert.
// --------------------------------------------------------------------------

describe("SuggestAffordance — empty", () => {
  it("renders an EmptyState about insufficient post history and NO Alert", () => {
    const root = mount(<SuggestAffordance {...props({ suggestion: emptyState })} />);

    // The empty state is the v2 EmptyState — its title indicates insufficient
    // post history (NOT an error Alert). Assert on the human message, not the
    // raw reason code.
    const text = (root.textContent ?? "").toLowerCase();
    expect(/post history|capture|history yet|posts/.test(text)).toBe(true);

    // Empty is NOT an error: no Alert (warning or danger) appears.
    expect(alerts(root)).toHaveLength(0);
    // And there is nothing to "use" yet.
    expect(useThisButton(root)).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 6. error → danger Alert + retry; clicking retry calls onRefresh once.
// --------------------------------------------------------------------------

describe("SuggestAffordance — error", () => {
  it("renders a danger Alert with a retry button that calls onRefresh once", () => {
    const onRefresh = vi.fn();
    const root = mount(
      <SuggestAffordance {...props({ suggestion: errorState, onRefresh })} />,
    );

    const dangerAlerts = alerts(root).filter(
      (a) => a.getAttribute("data-variant") === "danger",
    );
    expect(dangerAlerts.length).toBeGreaterThan(0);

    const retry = retryButton(root);
    expect(retry).toBeDefined();
    retry!.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// 7. "Use this" → calls onUse(text) EXACTLY once with the EXACT suggestion text.
// --------------------------------------------------------------------------

describe("SuggestAffordance — 'Use this' explicit gesture", () => {
  it("calls onUse with the exact suggestion text exactly once on click", () => {
    const onUse = vi.fn();
    const root = mount(
      <SuggestAffordance {...props({ suggestion: readyState, onUse })} />,
    );

    const useThis = useThisButton(root);
    expect(useThis).toBeDefined();

    useThis!.click();

    expect(onUse).toHaveBeenCalledTimes(1);
    // The EXACT suggestion text is handed back — not the rationale, not a slice.
    expect(onUse).toHaveBeenCalledWith(readyText());
  });
});

// --------------------------------------------------------------------------
// 8. Never auto-fires / no transport → rendering ready (even pre-click) emits
//    nothing; the component drives only its declared callbacks.
// --------------------------------------------------------------------------

describe("SuggestAffordance — never auto-posts / no transport", () => {
  it("does not call onUse (or onRefresh) merely by rendering a ready suggestion", () => {
    const onUse = vi.fn();
    const onRefresh = vi.fn();
    mount(
      <SuggestAffordance {...props({ suggestion: readyState, onUse, onRefresh })} />,
    );

    // Presentational: no callback fires without an explicit user gesture.
    expect(onUse).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("exposes no control that can fire onUse other than the explicit 'Use this' click", () => {
    // Non-tautological: click EVERY rendered button EXCEPT "Use this" and assert
    // onUse never fires — proving no hidden auto-poster / stray trigger exists.
    const onUse = vi.fn();
    const root = mount(
      <SuggestAffordance {...props({ suggestion: readyState, onUse })} />,
    );

    const useThis = useThisButton(root);
    for (const btn of buttons(root)) {
      if (btn === useThis) continue;
      btn.click();
    }
    expect(onUse).not.toHaveBeenCalled();

    // And the ONLY control that fires onUse is "Use this".
    useThis!.click();
    expect(onUse).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// SuggestState type sanity — the union is exported and exercises the impl's
// declared shape. (Compile-time only; runtime body intentionally minimal.)
// --------------------------------------------------------------------------

describe("SuggestAffordance — exported SuggestState type", () => {
  it("accepts the overlay-local SuggestState variants used by the fixtures", () => {
    const states: SuggestState[] = [
      idleState,
      loadingState,
      readyState,
      readyNoCooldownState,
      cooldownBlockedState,
      emptyState,
      errorState,
    ];
    // A trivial runtime touch keeps Vitest from flagging an assertion-free test;
    // the load-bearing check is that the array typechecks against the exported
    // union (proving the fixtures and the impl share one definition).
    expect(states).toHaveLength(7);
  });
});
