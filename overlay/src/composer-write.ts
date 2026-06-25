// @x-builder/overlay — Draft.js-safe composer write
//
// X's compose field is a Draft.js contenteditable. Two naive approaches fail:
//   • `composerEl.textContent = text` injects a raw text node Draft never adopts
//     into its model — the post stays empty and the node renders out of place.
//   • `execCommand("insertText", …)` DOUBLE-inserts: the browser writes the text
//     into the DOM AND Draft's beforeinput handler re-renders its model with the
//     same text, so the draft appears twice (XOB bug #1).
//
// The reliable single-insert path is a synthetic `paste`: Draft's onPaste reads
// `clipboardData.getData("text/plain")` and inserts it into its model exactly
// once, replacing the current selection. We select-all first so the paste
// REPLACES any existing draft rather than appending. We drive Chromium, where
// `ClipboardEvent` + `DataTransfer` are constructable.

/**
 * Replace the composer's content with `text` via a synthetic paste (Draft adopts
 * it once). Selects all existing content first so the write replaces, not
 * appends. Degrades to a `textContent` set + dispatched `input` only when
 * `ClipboardEvent`/`DataTransfer` are unavailable (JSDOM under unit tests).
 *
 * Returns nothing: Draft re-renders its model asynchronously, so reading
 * `textContent` back synchronously here would be stale. Callers use the text
 * they requested (Draft will render exactly that).
 */
export function writeIntoComposer(composerEl: HTMLElement, text: string): void {
  const doc = composerEl.ownerDocument;
  const win: typeof globalThis & {
    DataTransfer?: typeof DataTransfer;
    ClipboardEvent?: typeof ClipboardEvent;
  } = (doc.defaultView as unknown as typeof globalThis) ?? globalThis;

  composerEl.focus();

  // Select all existing content so the paste REPLACES it (Draft inserts the
  // pasted text at the current selection).
  const selection = doc.getSelection();
  if (selection !== null) {
    const range = doc.createRange();
    range.selectNodeContents(composerEl);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const DataTransferCtor = win.DataTransfer;
  const ClipboardEventCtor = win.ClipboardEvent;
  if (typeof DataTransferCtor === "function" && typeof ClipboardEventCtor === "function") {
    try {
      const data = new DataTransferCtor();
      data.setData("text/plain", text);
      const pasteEvent = new ClipboardEventCtor("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      composerEl.dispatchEvent(pasteEvent);
      return;
    } catch {
      // Fall through to the degraded path.
    }
  }

  // Degraded fallback (no ClipboardEvent/DataTransfer): set textContent + fire
  // input so callers and the debounced analyze flow still observe the change.
  composerEl.textContent = text;
  composerEl.dispatchEvent(new Event("input", { bubbles: true }));
}
