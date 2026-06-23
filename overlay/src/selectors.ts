// @x-builder/overlay — X DOM selectors + safe query helpers (XOB-019)
//
// THE single source of truth for unofficial x.com selector strings in the
// overlay. No other overlay module hardcodes a `data-testid` or structural X
// selector — everything routes through `XSelectors`.
//
// `safeQuery` / `safeQueryAll` wrap the native query APIs so a missing target
// OR a thrown `DOMException` (e.g. a syntactically invalid selector from a
// corrupted constant) never propagates: they increment a module-level miss
// counter and return `null` / `[]`. XOB-020's `ReadinessIndicator` reads the
// counter to surface an "X layout changed" flag when misses cross a threshold.

/** The five X target selectors the overlay anchors its affordances to. */
export const XSelectors = {
  COMPOSER_TEXTAREA: 'div[data-testid="tweetTextarea_0"]',
  COMPOSER_BUTTON: 'div[data-testid="tweetButton"]',
  COMPOSER_DIALOG: '[role="dialog"]',
  TWEET_ARTICLE: 'article[data-testid="tweet"]',
  TWEET_TEXT: 'div[data-testid="tweetText"]',
} as const;

/**
 * Module-level miss counter. Monotonic for the lifetime of the bundle; callers
 * snapshot it and compare deltas rather than absolute values.
 */
let missCount = 0;

/** Current cumulative selector-miss count (read-only accessor). */
export function selectorMissCount(): number {
  return missCount;
}

/**
 * `root.querySelector`, but never throws: returns the matched element, or
 * `null` on a miss / invalid-selector `DOMException` — incrementing the miss
 * counter in both failure cases.
 */
export function safeQuery(root: ParentNode, selector: string): Element | null {
  try {
    const found = root.querySelector(selector);
    if (found === null) {
      missCount += 1;
    }
    return found;
  } catch {
    missCount += 1;
    return null;
  }
}

/**
 * `root.querySelectorAll`, but never throws: returns the matched elements as a
 * plain array, or `[]` on a no-match / invalid-selector `DOMException` —
 * incrementing the miss counter in both empty cases.
 */
export function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    const found = Array.from(root.querySelectorAll(selector));
    if (found.length === 0) {
      missCount += 1;
    }
    return found;
  } catch {
    missCount += 1;
    return [];
  }
}
