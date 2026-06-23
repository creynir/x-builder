// @x-builder/overlay — `SuggestState` fixtures for SuggestAffordance (test-only)
//
// `SuggestAffordance` is purely presentational over
// an injected `SuggestState`, so its tests drive it entirely from the variants
// below. The `cooldown` / `signal` sub-objects are REAL `CooldownSignal` shapes
// imported from `@x-builder/shared` (`{ format, countInWindow, windowDays,
// lastPostedAt?, status, message }`) and the `format` fields are REAL
// `DetectedPostFormat` enum members — no invented fields, no re-derived Zod — so
// the fixtures exercise the exact shape the parent affordance holder maps from a
// `SuggestPostResponse` before passing it down.
//
// `SuggestState` is the overlay-local UI-state union declared by the impl
// (`../suggest/suggest-affordance`); these fixtures re-use that exported type so
// the component and its tests share one definition. Importing it is one of the
// things that drives the RED state (the module does not exist yet).

import type { CooldownSignal, DetectedPostFormat } from "@x-builder/shared";

import type { SuggestState } from "../suggest/suggest-affordance";

/** A warming cooldown signal for the `ready`-with-badge fixture. */
const warmingHotTake: CooldownSignal = {
  format: "hot_take",
  countInWindow: 2,
  windowDays: 7,
  status: "warming",
  message: "2 hot takes this week",
};

/** A blocking cooldown signal for the `cooldown_blocked` fixture. */
const blockingHotTake: CooldownSignal = {
  format: "hot_take",
  countInWindow: 4,
  windowDays: 7,
  status: "cooldown",
  message: "Cooldown active",
};

/** A guard so a fixture typo can never silently weaken the format assertions. */
export const READY_FORMAT: DetectedPostFormat = "hot_take";

/** Loading: a `suggestPost()` call is in flight. */
export const loadingState: SuggestState = "loading";

/** Idle: nothing requested yet (launcher only; card closed when `open===false`). */
export const idleState: SuggestState = "idle";

/**
 * Ready WITH a cooldown signal attached → the card shows the suggestion text +
 * rationale, the "Use this" button, and an inline warning Badge for the format's
 * cooldown context.
 */
export const readyState: SuggestState = {
  status: "ready",
  text: "Here's an idea for a hot take about TypeScript...",
  rationale: "You haven't posted a hot take in 3 days",
  format: READY_FORMAT,
  cooldown: warmingHotTake,
};

/**
 * Ready WITHOUT a cooldown signal → identical render path minus the badge
 * (the `cooldown.signals` empty / absent edge: no badge, clean render).
 */
export const readyNoCooldownState: SuggestState = {
  status: "ready",
  text: "A clean suggestion with no cooldown context attached.",
  rationale: "First time posting this format — nothing to throttle",
  format: READY_FORMAT,
};

/**
 * Cooldown blocked → a warning (NOT danger) Alert carrying the reason; the
 * "Use this" button is absent (the user is being asked to hold off).
 */
export const cooldownBlockedState: SuggestState = {
  status: "cooldown_blocked",
  reason: "You've posted 4 hot takes this week — give it a rest",
  signal: blockingHotTake,
};

/** Empty → the corpus is below the minimum; render the v2 EmptyState, no Alert. */
export const emptyState: SuggestState = { status: "empty", reason: "insufficient_corpus" };

/** Error → a danger Alert with a retry affordance that calls `onRefresh`. */
export const errorState: SuggestState = { status: "error", error: "generation_failed" };
