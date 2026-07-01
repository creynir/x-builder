// @x-builder/overlay — AnchorLayer skeleton + anchor registry (XOB-019)
//
// Watches `document.body` for the X SPA's DOM churn and keeps a node→pin
// registry (`Map<Element, AffordanceHandle>`) that downstream tickets (XOB-025+)
// will populate with real pins. At THIS ticket the registry stays empty: the
// reconcile pass calls `safeQueryAll` on the `XSelectors` targets, mounts no
// pins, and zero matches is a valid, error-free state.
//
// Observer discipline:
//   - A single `MutationObserver(document.body, {childList, subtree})`.
//   - Callbacks are rAF-gated and ~150ms debounced (cancel-and-reschedule), so
//     a heavy SPA re-render burst collapses to a single trailing reconcile.
//   - The observer disconnects when the tab is hidden (`visibilitychange`) and
//     on unmount; both disconnects are wrapped in try/catch to survive a
//     document teardown during fast navigation.

import type { ReplyComposerContext, ReplyThreadDomEvidence } from "@x-builder/shared";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { safeQuery, safeQueryAll, XSelectors } from "./selectors";

/** Internal node→pin handle. The registry is empty until XOB-025+ mount pins. */
export interface AffordanceHandle {
  anchorEl: Element;
  rect: DOMRect;
  type: "composer" | "tweet";
}

/** Node→pin registry, shared with descendants for read access (`.size` etc.). */
export type AnchorRegistry = Map<Element, AffordanceHandle>;

const AnchorRegistryContext = createContext<AnchorRegistry | null>(null);

/**
 * Read the anchor registry from the nearest `AnchorLayer`. Throws if used
 * outside one (dev invariant), mirroring the transport seam.
 */
export function useAnchorRegistry(): AnchorRegistry {
  const registry = useContext(AnchorRegistryContext);
  if (registry === null) {
    throw new Error("[xb] useAnchorRegistry() called outside an AnchorLayer");
  }
  return registry;
}

// ---------------------------------------------------------------------------
// ComposeContext (XOB-029) — additive compose-modal detection seam
// ---------------------------------------------------------------------------

/**
 * The live compose surface the cockpit (XOB-029) orchestrates over. `isActive`
 * is `true` while X's compose modal is in the DOM (a `[role="dialog"]`
 * containing `div[data-testid="tweetTextarea_0"]`, OR the `/compose/post`
 * route); `composerEl` is the live contenteditable composer; `composerText` is
 * the composer's `.textContent`, debounced ~350 ms so a typing burst collapses
 * to one trailing read. When inactive every field is empty/`null`.
 */
export type ComposeMode = "post" | "reply";

export interface ReplyDraftSplit {
  mode: ComposeMode;
  authoredBody: string;
  structuralPrefix: string;
  leadingHandleState: ReplyComposerContext["leadingTargetHandle"]["state"];
  merge(body: string): string;
}

export interface ComposeContextValue {
  /** The live `div[data-testid="tweetTextarea_0"]` composer, or `null`. */
  composerEl: HTMLElement | null;
  /** `true` while X's compose modal is detected in the DOM / route. */
  isActive: boolean;
  /** `post` for normal compose, `reply` only when same-dialog target evidence exists. */
  mode: ComposeMode;
  /** Same-dialog reply target metadata, present only in reply mode. */
  replyContext?: ReplyComposerContext;
  /** Body/prefix split derived from the live composer text and reply context. */
  draftSplit: ReplyDraftSplit;
  /** The composer's `.textContent`, debounced ~350 ms; `""` when inactive. */
  composerText: string;
  /** `true` while X's discard/"save post?" confirmation sheet is layered up. */
  confirmationActive: boolean;
}

const ComposeContextContext = createContext<ComposeContextValue | null>(null);

/**
 * Read the live `ComposeContext` from the nearest `AnchorLayer`. Throws when
 * used outside one (dev invariant), mirroring `useAnchorRegistry`.
 */
export function useComposeContext(): ComposeContextValue {
  const value = useContext(ComposeContextContext);
  if (value === null) {
    throw new Error("[xb] useComposeContext() called outside an AnchorLayer");
  }
  return value;
}

/** The debounce window for the `ComposeContext` composer-text read. */
const COMPOSE_TEXT_DEBOUNCE_MS = 350;

type ReplyTargetMetadata = Omit<
  ReplyComposerContext,
  "leadingTargetHandle" | "replyThreadDomEvidence" | "replyThreadContext"
> & {
  observedAt: string;
};

function normalizeDomText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function parseStatusUrl(value: string):
  | { handle: string; statusId: string; targetUrl: string }
  | null {
  try {
    const url = new URL(value, location.origin);
    const host = url.hostname.toLowerCase();
    const isXHost =
      host === "x.com" ||
      host === "www.x.com" ||
      host === "mobile.x.com" ||
      host === "twitter.com" ||
      host === "www.twitter.com" ||
      host === "mobile.twitter.com";
    if (!isXHost) return null;

    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)\/?$/);
    if (match === null) return null;

    const handle = match[1];
    const statusId = match[2];
    if (handle === undefined || statusId === undefined) return null;

    return {
      handle,
      statusId,
      targetUrl: "https://x.com/" + handle + "/status/" + statusId,
    };
  } catch {
    return null;
  }
}

function isTopLevelArticleInDialog(article: Element): boolean {
  return article.parentElement?.closest(XSelectors.TWEET_ARTICLE) === null;
}

function directTweetTextElement(article: Element): Element | null {
  return (
    safeQueryAll(article, XSelectors.TWEET_TEXT).find(
      (el) => el.closest(XSelectors.TWEET_ARTICLE) === article,
    ) ?? null
  );
}

function directStatusLink(article: Element): HTMLAnchorElement | null {
  const link = safeQueryAll(article, XSelectors.TWEET_STATUS_LINK).find(
    (el) => el instanceof HTMLAnchorElement && el.closest(XSelectors.TWEET_ARTICLE) === article,
  );
  return link instanceof HTMLAnchorElement ? link : null;
}

function readDisplayName(article: Element, statusLink: HTMLAnchorElement): string | undefined {
  const statusText = normalizeDomText(statusLink.textContent);
  for (const child of Array.from(article.childNodes)) {
    if (child === statusLink) continue;
    const text = normalizeDomText(child.textContent);
    if (text.length === 0 || text === statusText || text.startsWith("@")) continue;
    return text.slice(0, 160);
  }
  return undefined;
}

function detectReplyTarget(composerEl: HTMLElement | null): ReplyTargetMetadata | null {
  if (composerEl === null) return null;

  const dialog = composerEl.closest(XSelectors.COMPOSER_DIALOG);
  if (!(dialog instanceof HTMLElement)) return null;

  const articles = safeQueryAll(dialog, XSelectors.TWEET_ARTICLE).filter(
    (article) => !article.contains(composerEl) && isTopLevelArticleInDialog(article),
  );

  for (const article of articles) {
    const textEl = directTweetTextElement(article);
    const statusLink = directStatusLink(article);
    if (textEl === null || statusLink === null) continue;

    const targetText = normalizeDomText(
      textEl instanceof HTMLElement ? textEl.innerText : textEl.textContent,
    );
    const status = parseStatusUrl(statusLink.href);
    if (targetText.length === 0 || status === null) continue;

    return {
      source: "same_dialog_dom",
      targetAuthorHandle: status.handle,
      targetDisplayName: readDisplayName(article, statusLink),
      targetText,
      targetStatusId: status.statusId,
      targetUrl: status.targetUrl,
      observedAt: new Date().toISOString(),
    };
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function structuralPrefixFor(text: string, targetHandle: string): string {
  const firstMention = text.match(/^@([A-Za-z0-9_]{1,15})(?:\s+|$)/);
  if (firstMention === null || firstMention[1]?.toLowerCase() !== targetHandle.toLowerCase()) {
    return "";
  }

  return text.match(/^((?:@[A-Za-z0-9_]{1,15}(?:\s+|$))+)/)?.[1] ?? firstMention[0];
}

function stripDuplicateTargetHandle(body: string, targetHandle: string): string {
  const leadingWhitespace = body.match(/^\s*/)?.[0] ?? "";
  const withoutWhitespace = body.slice(leadingWhitespace.length);
  const duplicate = new RegExp("^@" + escapeRegExp(targetHandle) + "(?:\\s+|$)", "i").exec(
    withoutWhitespace,
  );
  if (duplicate === null) return body;
  return withoutWhitespace.slice(duplicate[0].length);
}

function createDraftSplit(
  composerText: string,
  replyTarget: ReplyTargetMetadata | null,
): ReplyDraftSplit {
  if (replyTarget === null) {
    return {
      mode: "post",
      authoredBody: composerText,
      structuralPrefix: "",
      leadingHandleState: "user_deleted",
      merge(body) {
        return body;
      },
    };
  }

  const structuralPrefix = structuralPrefixFor(composerText, replyTarget.targetAuthorHandle);
  const leadingHandleState = structuralPrefix.length > 0 ? "present" : "user_deleted";
  const authoredBody =
    leadingHandleState === "present" ? composerText.slice(structuralPrefix.length) : composerText;

  return {
    mode: "reply",
    authoredBody,
    structuralPrefix,
    leadingHandleState,
    merge(body) {
      if (leadingHandleState === "user_deleted") return body;
      return structuralPrefix + stripDuplicateTargetHandle(body, replyTarget.targetAuthorHandle);
    },
  };
}

function makeReplyContext(
  replyTarget: ReplyTargetMetadata | null,
  draftSplit: ReplyDraftSplit,
): ReplyComposerContext | undefined {
  if (replyTarget === null) return undefined;
  const { observedAt, ...targetContext } = replyTarget;
  const replyThreadDomEvidence: ReplyThreadDomEvidence = {
    source: "same_dialog_dom",
    observedAt,
    role: "current_target",
    currentTarget: {
      authorHandle: replyTarget.targetAuthorHandle,
      ...(replyTarget.targetDisplayName === undefined
        ? {}
        : { displayName: replyTarget.targetDisplayName }),
      ...(replyTarget.targetStatusId === undefined
        ? {}
        : { statusId: replyTarget.targetStatusId }),
      ...(replyTarget.targetUrl === undefined ? {} : { url: replyTarget.targetUrl }),
      text: replyTarget.targetText,
      observedAt,
    },
    diagnostics: {
      status: "same_dialog_only",
      missing: [
        { field: "immediate_parent", reason: "not_observed" },
        { field: "root", reason: "not_observed" },
      ],
      uiMessages: ["Only the same-dialog target post is available."],
      promptMessages: ["No observed parent/root thread context was available."],
    },
  };

  return {
    ...targetContext,
    replyThreadDomEvidence,
    leadingTargetHandle: {
      handle: replyTarget.targetAuthorHandle,
      state: draftSplit.leadingHandleState,
    },
  };
}

function sameReplyTarget(a: ReplyTargetMetadata | null, b: ReplyTargetMetadata | null): boolean {
  const withoutObservedAt = (value: ReplyTargetMetadata | null): Omit<ReplyTargetMetadata, "observedAt"> | null => {
    if (value === null) return null;
    const { observedAt: _observedAt, ...rest } = value;
    return rest;
  };
  return JSON.stringify(withoutObservedAt(a)) === JSON.stringify(withoutObservedAt(b));
}

/**
 * Detect X's compose surface. The composer is active when its contenteditable
 * lives inside a `[role="dialog"]` (the real modal shape) OR the location is the
 * `/compose/post` route. Returns the live composer element, or `null`.
 */
function detectComposer(): HTMLElement | null {
  const dialog = safeQuery(document.body, XSelectors.COMPOSER_DIALOG);
  if (dialog !== null) {
    const inDialog = safeQuery(dialog, XSelectors.COMPOSER_TEXTAREA);
    if (inDialog instanceof HTMLElement) {
      return inDialog;
    }
  }
  if (location.pathname.includes("/compose/post")) {
    const composer = safeQuery(document.body, XSelectors.COMPOSER_TEXTAREA);
    if (composer instanceof HTMLElement) {
      return composer;
    }
  }
  return null;
}

/**
 * Detect X's discard/"save post?" confirmation sheet. Uses a raw query (NOT
 * `safeQuery`) because this element is EXPECTED to be absent almost always —
 * routing it through the miss-counter would spuriously inflate the "X layout
 * changed" signal on every quiet reconcile. A thrown selector degrades to
 * `false` (sheet treated as absent).
 */
function detectConfirmationDialog(): boolean {
  try {
    return document.body.querySelector(XSelectors.CONFIRMATION_DIALOG) !== null;
  } catch {
    return false;
  }
}

/** ~150ms debounce window; absorbs SPA navigation re-render bursts. */
const RECONCILE_DEBOUNCE_MS = 150;

/** rAF that degrades to a microtask-ish timeout when unavailable (JSDOM). */
function scheduleFrame(cb: () => void): number {
  const raf = (
    globalThis as { requestAnimationFrame?: (fn: FrameRequestCallback) => number }
  ).requestAnimationFrame;
  if (typeof raf === "function") {
    return raf(() => cb());
  }
  return setTimeout(cb, 0) as unknown as number;
}

/** Cancel a handle from `scheduleFrame`, matching the rAF/timeout it returned. */
function cancelFrame(handle: number): void {
  const caf = (
    globalThis as { cancelAnimationFrame?: (h: number) => void }
  ).cancelAnimationFrame;
  if (typeof caf === "function") {
    caf(handle);
  }
  clearTimeout(handle);
}

/**
 * The register/reconcile mutation API a descendant uses to publish a pin's
 * anchor into the layer registry and to align the registry with the live DOM.
 * Additive over the XOB-019 read-only registry: `useAnchorRegistry()` keeps
 * returning the same `Map`, and `register`/`unregister` are last-call-wins.
 */
export interface AnchorMutationApi {
  /** Publish (or overwrite) the handle keyed by its anchor element. */
  register(handle: AffordanceHandle): void;
  /** Remove the handle keyed by `anchorEl`, if present. */
  unregister(anchorEl: Element): void;
  /** Drop every registry entry whose anchor element left the document. */
  reconcile(): void;
}

const AnchorMutationContext = createContext<AnchorMutationApi | null>(null);

/**
 * The register/reconcile mutation API of the nearest `AnchorLayer`. Throws when
 * used outside one (dev invariant), mirroring `useAnchorRegistry`.
 */
export function useAnchorMutation(): AnchorMutationApi {
  const api = useContext(AnchorMutationContext);
  if (api === null) {
    throw new Error("[xb] useAnchorMutation() called outside an AnchorLayer");
  }
  return api;
}

export interface AnchorLayerProps {
  children?: ReactNode;
}

/**
 * Mounts the `MutationObserver` reconcile loop, provides the anchor registry +
 * its register/reconcile mutation API, and publishes the live `ComposeContext`
 * (compose-modal detection + the ~350 ms-debounced composer text). The registry
 * stays empty unless a descendant calls `register` (XOB-025+); zero matches
 * remains a valid, error-free state.
 */
export function AnchorLayer({ children }: AnchorLayerProps): ReactNode {
  // L3: the registry is owned here and stable for the layer's lifetime.
  const registryRef = useRef<AnchorRegistry>(new Map());

  // Compose detection state, published via ComposeContext. `composerEl` is the
  // live element; `composerText` is its ~350 ms-debounced `.textContent`.
  const [composerEl, setComposerEl] = useState<HTMLElement | null>(null);
  const [composerText, setComposerText] = useState<string>("");
  const [replyTarget, setReplyTarget] = useState<ReplyTargetMetadata | null>(null);
  const [confirmationActive, setConfirmationActive] = useState<boolean>(false);

  // Stable register/reconcile API (last-call-wins; never re-bound across renders).
  const mutationApi = useRef<AnchorMutationApi>({
    register(handle) {
      registryRef.current.set(handle.anchorEl, handle);
    },
    unregister(anchorEl) {
      registryRef.current.delete(anchorEl);
    },
    reconcile() {
      for (const anchorEl of Array.from(registryRef.current.keys())) {
        if (!anchorEl.isConnected) {
          registryRef.current.delete(anchorEl);
        }
      }
    },
  });

  useEffect(() => {
    const registry = registryRef.current;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let frameHandle: number | null = null;

    /**
     * Reconcile pass: query the X targets, align the registry, and refresh the
     * compose-detection state. Zero affordance matches is valid — no `XSelectors`
     * target auto-mounts a pin; descendants publish pins via the mutation API.
     */
    const reconcile = (): void => {
      // Touch the selectors so the reconcile path is real (miss-counted), even
      // though no pins are auto-produced.
      safeQueryAll(document.body, XSelectors.COMPOSER_TEXTAREA);
      safeQueryAll(document.body, XSelectors.TWEET_ARTICLE);
      // Drop any registry entries whose anchor left the DOM.
      mutationApi.current.reconcile();
      void registry;

      // Refresh compose detection: an identity-stable update (the same element is
      // a no-op to React) so a quiet SPA tick causes no churn. The composer TEXT
      // is owned by the debounce effect below, not re-read here.
      const nextComposer = detectComposer();
      setComposerEl((prev) => (prev === nextComposer ? prev : nextComposer));
      const nextReplyTarget = detectReplyTarget(nextComposer);
      setReplyTarget((prev) => (sameReplyTarget(prev, nextReplyTarget) ? prev : nextReplyTarget));

      // Track X's confirmation sheet so the cockpit can stand down while it is up.
      const nextConfirmation = detectConfirmationDialog();
      setConfirmationActive((prev) => (prev === nextConfirmation ? prev : nextConfirmation));
    };

    /** Cancel any pending tick and schedule a fresh rAF-gated reconcile. */
    const scheduleReconcile = (): void => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (frameHandle !== null) cancelFrame(frameHandle);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        frameHandle = scheduleFrame(() => {
          frameHandle = null;
          reconcile();
        });
      }, RECONCILE_DEBOUNCE_MS);
    };

    const observer = new MutationObserver(() => {
      scheduleReconcile();
    });

    /** Disconnect defensively — document teardown can make this throw. */
    const disconnect = (): void => {
      try {
        observer.disconnect();
      } catch {
        // Page is unloading; nothing to clean up.
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        disconnect();
      }
    };

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Initial synchronous detection so the first settled render reflects an
    // already-open composer without waiting for a mutation.
    reconcile();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (frameHandle !== null) cancelFrame(frameHandle);
      disconnect();
    };
  }, []);

  // The ~350 ms-debounced composer-text read: re-seed on element change, then
  // collapse a typing burst to one trailing read on `input`.
  useEffect(() => {
    if (composerEl === null) {
      setComposerText("");
      return;
    }

    // Read via `innerText`, NOT `textContent`: Draft.js concatenates paragraph
    // blocks with no separator in `textContent` ("a\n\nb" → "ab"), so the judge
    // saw run-together text and quoted across paragraphs. `innerText` preserves
    // the rendered line breaks, so analyze/judge see real paragraphs (the
    // highlight layer keeps indexing `textContent` for within-paragraph quotes).
    const readText = (): string => composerEl.innerText ?? composerEl.textContent ?? "";

    // Seed synchronously so the first analyze sees the already-present draft.
    setComposerText(readText());

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRead = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setComposerText(readText());
      }, COMPOSE_TEXT_DEBOUNCE_MS);
    };

    // `input` catches typing, but X's Draft.js editor does NOT fire a native
    // `input` for a paste (it intercepts the paste and re-renders via its model),
    // nor for programmatic writes — so a MutationObserver on the composer subtree
    // catches every text change (paste, Draft re-render, our own writes) and the
    // analyze/judge flow fires regardless of how the text arrived (XOB #1).
    composerEl.addEventListener("input", scheduleRead);
    const observer = new MutationObserver(scheduleRead);
    observer.observe(composerEl, { childList: true, subtree: true, characterData: true });

    return () => {
      composerEl.removeEventListener("input", scheduleRead);
      try {
        observer.disconnect();
      } catch {
        // Document teardown during fast navigation; nothing to clean up.
      }
      if (timer !== null) clearTimeout(timer);
    };
  }, [composerEl]);

  const activeReplyTarget = composerEl === null ? null : replyTarget;
  const activeComposerText = composerEl === null ? "" : composerText;
  const draftSplit = createDraftSplit(activeComposerText, activeReplyTarget);
  const replyContext = makeReplyContext(activeReplyTarget, draftSplit);
  const composeValue: ComposeContextValue = {
    composerEl,
    isActive: composerEl !== null,
    mode: draftSplit.mode,
    ...(replyContext === undefined ? {} : { replyContext }),
    draftSplit,
    composerText: activeComposerText,
    confirmationActive,
  };

  return (
    <AnchorRegistryContext.Provider value={registryRef.current}>
      <AnchorMutationContext.Provider value={mutationApi.current}>
        <ComposeContextContext.Provider value={composeValue}>
          {children}
        </ComposeContextContext.Provider>
      </AnchorMutationContext.Provider>
    </AnchorRegistryContext.Provider>
  );
}
