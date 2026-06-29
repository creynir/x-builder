import { beforeEach, describe, expect, it } from "vitest";

import {
  safeQuery,
  safeQueryAll,
  selectorMissCount,
  XSelectors,
} from "./selectors";

/**
 * `selectorMissCount` is a module-level counter that only grows; each test
 * snapshots it before acting and asserts the relative delta, so ordering and
 * cross-test accumulation never make these assertions brittle.
 */

const SCRATCH_ID = "xb-selectors-scratch";

function scratch(): HTMLElement {
  let host = document.getElementById(SCRATCH_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = SCRATCH_ID;
    document.body.appendChild(host);
  }
  return host;
}

beforeEach(() => {
  document.getElementById(SCRATCH_ID)?.remove();
});

describe("XSelectors constant", () => {
  it("exposes the centralized X target selector strings", () => {
    expect(XSelectors.COMPOSER_TEXTAREA).toBe(
      'div[data-testid="tweetTextarea_0"]',
    );
    expect(XSelectors.COMPOSER_BUTTON).toBe('div[data-testid="tweetButton"]');
    expect(XSelectors.COMPOSER_DIALOG).toBe('[role="dialog"]');
    expect(XSelectors.TWEET_ARTICLE).toBe('article[data-testid="tweet"]');
    expect(XSelectors.TWEET_TEXT).toBe('div[data-testid="tweetText"]');
    expect(XSelectors.TWEET_STATUS_LINK).toBe('a[href*="/status/"]');
  });
});

describe("safeQuery", () => {
  it("returns null and increments selectorMissCount by 1 when nothing matches", () => {
    const before = selectorMissCount();
    const result = safeQuery(document.body, XSelectors.COMPOSER_TEXTAREA);

    expect(result).toBeNull();
    expect(selectorMissCount()).toBe(before + 1);
  });

  it("returns the element and does NOT increment the miss count on a hit", () => {
    const host = scratch();
    const el = document.createElement("article");
    el.setAttribute("data-testid", "tweet");
    host.appendChild(el);

    const before = selectorMissCount();
    const result = safeQuery(host, XSelectors.TWEET_ARTICLE);

    expect(result).toBe(el);
    expect(selectorMissCount()).toBe(before);
  });

  it("catches an invalid selector string (DOMException), returns null, increments the miss count, never throws", () => {
    const before = selectorMissCount();
    let result: Element | null = "sentinel" as unknown as Element | null;

    // A syntactically invalid selector makes the native querySelector throw a
    // SyntaxError DOMException; safeQuery must swallow it.
    expect(() => {
      result = safeQuery(document.body, "div[unclosed=");
    }).not.toThrow();

    expect(result).toBeNull();
    expect(selectorMissCount()).toBe(before + 1);
  });
});

describe("safeQueryAll", () => {
  it("returns [] and increments selectorMissCount on a valid-but-no-match selector", () => {
    const before = selectorMissCount();
    const result = safeQueryAll(document.body, XSelectors.COMPOSER_TEXTAREA);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    expect(selectorMissCount()).toBe(before + 1);
  });

  it("returns the matching elements as an array and does not increment on a hit", () => {
    const host = scratch();
    const a = document.createElement("article");
    a.setAttribute("data-testid", "tweet");
    const b = document.createElement("article");
    b.setAttribute("data-testid", "tweet");
    host.append(a, b);

    const before = selectorMissCount();
    const result = safeQueryAll(host, XSelectors.TWEET_ARTICLE);

    expect(result).toEqual([a, b]);
    expect(selectorMissCount()).toBe(before);
  });

  it("catches an invalid selector, returns [], increments the miss count, never throws", () => {
    const before = selectorMissCount();
    let result: Element[] = ["sentinel"] as unknown as Element[];

    expect(() => {
      result = safeQueryAll(document.body, "div[unclosed=");
    }).not.toThrow();

    expect(result).toEqual([]);
    expect(selectorMissCount()).toBe(before + 1);
  });
});
