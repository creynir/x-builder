// @x-builder/overlay — useComposerText (XOB-023)
//
// Debounced read of the live composer text (L4). Mirrors the cancel-and-
// reschedule debounce discipline `useComposerRect` / `raf-debounce` established:
// never re-read synchronously on every keystroke, but on a trailing `debounceMs`
// window, so a rapid typing burst collapses to one trailing read. The trailing
// read commits the new text with `flushSync` so the provenance flip is observable
// immediately on the debounce tick (Visual AC: "flip is immediate on the first
// differing keystroke after debounce") rather than on a later React tick.
//
// A `null` composer (no active compose session) reads as `""` and registers no
// listeners. The immediate first read seeds the value so the first settled
// render has the composer text without waiting a full debounce window; every
// later `input` rides the debounce. The listener + any pending timer are torn
// down on unmount and whenever `composerEl` changes.

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** Read the composer's text, treating a `null` element as the empty string. */
function readComposerText(composerEl: HTMLElement | null): string {
  return composerEl?.textContent ?? "";
}

/**
 * Track the composer's text on a `debounceMs` debounce (default 80ms). Returns
 * `""` when `composerEl === null`. Updates after the debounce window on each
 * `input`; the trailing read commits synchronously (`flushSync`) so consumers
 * re-derive on the same tick the debounce fires.
 */
export function useComposerText(
  composerEl: HTMLElement | null,
  debounceMs = 80,
): string {
  const [text, setText] = useState<string>(() => readComposerText(composerEl));

  useEffect(() => {
    // Seed synchronously on mount / composer change so the first settled render
    // reflects the current text (including the null ⇒ "" reset).
    setText(readComposerText(composerEl));

    if (composerEl === null) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const onInput = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        flushSync(() => {
          setText(readComposerText(composerEl));
        });
      }, debounceMs);
    };

    composerEl.addEventListener("input", onInput);

    return () => {
      composerEl.removeEventListener("input", onInput);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, [composerEl, debounceMs]);

  return text;
}
