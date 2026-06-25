// @x-builder/overlay — SuggestController (XOB-028, parent affordance holder)
//
// The page-persistent parent that drives the otherwise-presentational
// `SuggestAffordance`. It mirrors `SettingsAffordance`'s structure: it owns the
// `open` toggle, reads the engine through `useTransport()`, loads on the
// open-when-idle transition via `transport.suggestPost()`, maps the
// `SuggestPostResponse` into the overlay-local `SuggestState`, and performs the
// explicit-gesture composer-write on "Use this" (the SAME contenteditable write
// `ComposeCockpit` uses — set `textContent`, fire `input`; NEVER auto-post).
//
// Route gate: suggest is the NON-compose surface, so the controller renders
// nothing while `ComposeContext.isActive` (the cockpit owns that state). A
// tighter home/profile URL gate was deferred at XOB-028 (no route detector was
// built); `!isActive` is the minimum-correct gate and the route refinement is a
// follow-up. The component itself stays presentational — this file is logic.

import type { CooldownSignal, SuggestPostResponse } from "@x-builder/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";

import { useComposeContext } from "../anchor-layer";
import { writeIntoComposer } from "../composer-write";
import { safeQuery, XSelectors } from "../selectors";
import { useTransport } from "../transport/use-transport";
import { SuggestAffordance, type SuggestState } from "./suggest-affordance";

/**
 * Map the engine's `SuggestPostResponse` into the overlay-local `SuggestState`.
 *
 * - `insufficient_corpus` → `empty` (corpus below the floor).
 * - `ready` with no suggestion → `empty` (defensive: nothing to show).
 * - `ready` whose chosen lane is in active cooldown → `cooldown_blocked`.
 * - `ready` otherwise → `ready`, attaching the format's cooldown signal ONLY
 *   when it is `warming` (the informational Badge); `clear`/absent → no badge.
 */
function mapResponse(response: SuggestPostResponse): SuggestState {
  if (response.status === "insufficient_corpus") {
    return { status: "empty", reason: "insufficient_corpus" };
  }

  const suggestion = response.suggestions[0];
  if (suggestion === undefined) {
    return { status: "empty", reason: "insufficient_corpus" };
  }

  const signal: CooldownSignal | undefined = response.cooldown.signals.find(
    (candidate) => candidate.format === suggestion.format,
  );

  if (signal?.status === "cooldown") {
    return { status: "cooldown_blocked", reason: signal.message, signal };
  }

  return {
    status: "ready",
    text: suggestion.text,
    rationale: suggestion.rationale,
    format: suggestion.format,
    // Only the warming signal surfaces a Badge; a clear/absent signal renders clean.
    ...(signal?.status === "warming" ? { cooldown: signal } : {}),
  };
}

/**
 * The suggest-post parent. Page-persistent like `SettingsAffordance`, hidden
 * while the compose modal is active. Owns `open` + the loaded `SuggestState`,
 * loads on the open-when-idle edge, and wires the affordance's callbacks.
 */
export function SuggestController(): ReactElement | null {
  const transport = useTransport();
  const compose = useComposeContext();

  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestState>("idle");

  /** Load a suggestion: flip to `loading`, call the engine, map → state. */
  const load = useCallback((): void => {
    setSuggestion("loading");
    transport
      .suggestPost({ windowDays: 7, excludeFormats: [], count: 3 })
      .then((response) => setSuggestion(mapResponse(response)))
      .catch((error: unknown) =>
        setSuggestion({
          status: "error",
          error: error instanceof Error ? error.message : "generation_failed",
        }),
      );
  }, [transport]);

  // Load on the open-when-idle edge: opening the card with nothing loaded yet
  // kicks the single `suggestPost()` call. A reopen after a result keeps it.
  useEffect(() => {
    if (open && suggestion === "idle") {
      load();
    }
  }, [open, suggestion, load]);

  const onToggle = useCallback((): void => setOpen((value) => !value), []);
  const onRefresh = useCallback((): void => load(), [load]);

  /**
   * "Use this": the explicit-gesture composer write — set `textContent`, fire
   * `input` (the SAME write `ComposeCockpit` performs; NEVER auto-posts). The
   * suggest surface is the non-compose route, where `ComposeContext.composerEl`
   * is `null` (the cockpit only publishes the modal composer), so the target is
   * the live inline composer found through the centralized `XSelectors` (no new
   * detection system — the one canonical selector source).
   */
  const onUse = useCallback((text: string): void => {
    const composerEl = safeQuery(document.body, XSelectors.COMPOSER_TEXTAREA);
    if (!(composerEl instanceof HTMLElement)) return;
    // The SAME Draft.js-safe edit gesture the cockpit uses (focus → select-all →
    // insertText); a raw textContent set does not enter X's editor model.
    writeIntoComposer(composerEl, text);
  }, []);

  // Suggest is the non-compose surface: stay unmounted while the cockpit is up.
  if (compose.isActive) {
    return null;
  }

  return (
    <SuggestAffordance
      suggestion={suggestion}
      open={open}
      onToggle={onToggle}
      onRefresh={onRefresh}
      onUse={onUse}
    />
  );
}
