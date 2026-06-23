// @x-builder/overlay — ComposeCockpit integration fixtures (test-only)
//
// The X-shaped DOM the ComposeCockpit integration suite mounts against, plus the
// transport-response builders the suite injects through `FakeEngineTransport`.
//
// `insertXComposer()` materialises the REAL X compose modal shape into
// `document.body`:
//
//   <div role="dialog" aria-label="Compose post">
//     <div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" />
//     <button data-testid="tweetButton">Post</button>
//   </div>
//
// matching `XSelectors.COMPOSER_DIALOG` (`[role="dialog"]`) ⊃
// `XSelectors.COMPOSER_TEXTAREA` (`div[data-testid="tweetTextarea_0"]`). Browser
// mode (Playwright Chromium) lays this out for real, so the cockpit's compose
// detection, its rect tracker, and the contenteditable composer-write gesture all
// run against a genuine, laid-out, editable node — never a jsdom stand-in.
//
// The element is positioned absolutely with a non-zero box so the rAF rect
// tracker reads a stable, non-zero modal/composer rect. `removeXComposer()` (and
// `removeXComposerDialog()`, which removes ONLY the dialog) tear it down so the
// "unmount on dialog close" case can prove a clean teardown.
//
// The response builders produce the REAL shared shapes (`GenerateIdeaResponse`,
// `JudgeDraftResponse`, `ApplyJudgeSuggestionsResponse`, `GenerateCategory[]`,
// etc.) — no re-derived Zod, no invented fields — reusing `makeJudgeVerdict` and
// the `readyResult` so the cockpit exercises exactly the bytes the engine
// emits. A `deferred()` helper builds a hand-resolved promise so the in-flight
// abort case can hold a `judgeDraft`/`applyJudgeSuggestions` call open while the
// user edits, then resolve it AFTER the abort to prove the stale result is
// dropped.

import {
  deriveApproved,
  type ApplyJudgeSuggestionsResponse,
  type CaptureSummary,
  type GenerateCategory,
  type GeneratedIdeaCandidate,
  type GenerateIdeaResponse,
  type JudgeDraftResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import { makeJudgeVerdict } from "./fixtures";

// ---------------------------------------------------------------------------
// X-shaped fixture DOM
// ---------------------------------------------------------------------------

/** `data-xb-fixture` marker on the dialog wrapper so teardown can find it. */
const FIXTURE_MARK = "x-composer";

/** The contenteditable composer test id (the X selector target). */
const COMPOSER_TESTID = "tweetTextarea_0";

export interface XComposerHandle {
  /** The `[role="dialog"]` modal element. */
  dialog: HTMLDivElement;
  /** The contenteditable `div[data-testid="tweetTextarea_0"]` composer. */
  composer: HTMLDivElement;
  /** The `data-testid="tweetButton"` Post button (never clicked by the cockpit). */
  postButton: HTMLButtonElement;
  /** Remove the whole fixture (dialog + composer + button) from the body. */
  remove(): void;
  /** Remove ONLY the dialog subtree (the "dialog close" teardown signal). */
  removeDialog(): void;
}

/**
 * Insert the X compose modal fixture into `document.body` and return handles to
 * its parts. The dialog is absolutely positioned with a non-zero box so the rAF
 * rect tracker reads a stable rect; the composer carries a real text node only
 * when `text` is supplied (default: empty, the just-opened composer).
 */
export function insertXComposer(text = ""): XComposerHandle {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Compose post");
  dialog.dataset.xbFixture = FIXTURE_MARK;
  // Anchor the modal so getBoundingClientRect returns a stable, non-zero box.
  dialog.style.position = "absolute";
  dialog.style.top = "80px";
  dialog.style.left = "120px";
  dialog.style.width = "600px";
  dialog.style.height = "320px";

  const composer = document.createElement("div");
  composer.dataset.testid = COMPOSER_TESTID;
  composer.setAttribute("contenteditable", "true");
  composer.setAttribute("role", "textbox");
  composer.style.width = "560px";
  composer.style.minHeight = "120px";
  composer.style.font = "16px/1.4 monospace";
  composer.style.whiteSpace = "pre-wrap";
  composer.style.wordBreak = "break-word";
  if (text !== "") {
    composer.append(document.createTextNode(text));
  }

  const postButton = document.createElement("button");
  postButton.dataset.testid = "tweetButton";
  postButton.textContent = "Post";

  dialog.append(composer, postButton);
  document.body.append(dialog);

  return {
    dialog,
    composer,
    postButton,
    remove() {
      dialog.remove();
    },
    removeDialog() {
      dialog.remove();
    },
  };
}

/** Remove every leftover X composer fixture from the body (bulk teardown). */
export function removeAllXComposers(): void {
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(`[data-xb-fixture="${FIXTURE_MARK}"]`),
  )) {
    el.remove();
  }
}

/**
 * Write `text` into the composer and fire an `input` event — the same gesture
 * sequence a user typing produces, so the cockpit's debounced composer-text read
 * and its in-flight abort trigger both observe a real edit. Replaces the
 * composer's content wholesale (last edit wins).
 */
export function typeInComposer(composer: HTMLElement, text: string): void {
  composer.textContent = text;
  composer.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Deferred promise — for the in-flight abort case
// ---------------------------------------------------------------------------

export interface Deferred<T> {
  /** The pending promise handed to the transport override. */
  promise: Promise<T>;
  /** Resolve the promise (the engine's late reply, after the user aborted). */
  resolve(value: T): void;
  /** Reject the promise (e.g. an AbortError the cockpit may surface). */
  reject(reason?: unknown): void;
}

/** A hand-resolved promise so a test controls exactly when a call settles. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Transport-response builders (REAL shared shapes)
// ---------------------------------------------------------------------------

const ISO_NOW = "2026-06-22T00:00:00.000Z";

/**
 * Build a `GenerateIdeaResponse` from three `{ overall, approved? }` specs. The
 * candidate's `verdict` is `makeJudgeVerdict({ scores: { overall } })` (label
 * derived from `overall`, so `deriveApproved` agrees with the band) UNLESS the
 * spec sets `verdict: null`, which omits the verdict entirely (the
 * fallback-to-normal-judge-flow branch). `approved` defaults to
 * `deriveApproved(verdict)` so the auto-apply-best selection (highest overall
 * among approved) reads a self-consistent flag.
 *
 * The candidate `format` is fixed to the one-liner enum value; the cockpit reads
 * `text`/`verdict`/`approved`, NOT `format`, per the ticket SCOPE DECISION.
 */
export interface CandidateSpec {
  text: string;
  overall?: number;
  /** `null` ⇒ candidate carries NO verdict (the normal-judge-flow fallback). */
  verdict?: number | null;
  /** Override the derived `approved` flag. */
  approved?: boolean;
}

export function makeGenerateResponse(specs: [CandidateSpec, CandidateSpec, CandidateSpec]): GenerateIdeaResponse {
  const candidates = specs.map((spec, index): GeneratedIdeaCandidate => {
    const overall = spec.overall ?? 80;
    const hasVerdict = spec.verdict !== null;
    const verdict: JudgeVerdict | undefined = hasVerdict
      ? makeJudgeVerdict({ scores: { overall: spec.verdict ?? overall } })
      : undefined;
    const approved =
      spec.approved ?? (verdict !== undefined ? deriveApproved(verdict) : false);
    const candidate: GeneratedIdeaCandidate = {
      id: `candidate-${index + 1}`,
      format: "one-liner",
      text: spec.text,
    };
    if (verdict !== undefined) candidate.verdict = verdict;
    candidate.approved = approved;
    return candidate;
  });
  return { candidates: [candidates[0]!, candidates[1]!, candidates[2]!] };
}

/** Build a `JudgeDraftResponse` for a given `overall` (defaults to 80). */
export function makeJudgeResponse(overall = 80): JudgeDraftResponse {
  return {
    status: "judged",
    verdict: makeJudgeVerdict({ scores: { overall } }),
    model: "fake-judge-v1",
    judgedAt: ISO_NOW,
  };
}

/** Build an `ApplyJudgeSuggestionsResponse`; defaults to an improved, approved apply. */
export function makeApplyResponse(
  overrides: Partial<ApplyJudgeSuggestionsResponse> = {},
): ApplyJudgeSuggestionsResponse {
  const verdict = overrides.verdict ?? makeJudgeVerdict({ scores: { overall: 88 } });
  return {
    text: "improved draft text",
    verdict,
    approved: deriveApproved(verdict),
    improvedOverOriginal: true,
    ...overrides,
  };
}

/** The cold-start generate categories (reused from the rail fixtures' shape). */
export function makeGenerateCategories(): GenerateCategory[] {
  return [
    {
      id: "hot_take",
      label: "Hot take",
      format: "hot_take",
      basis: "default",
      cooldownStatus: "clear",
      sampleCount: 0,
    },
    {
      id: "founder_story",
      label: "Build-in-public",
      format: "founder_story",
      basis: "default",
      cooldownStatus: "clear",
      sampleCount: 0,
    },
  ];
}

/** A populated capture summary (the followers source). */
export function makeCapture(overrides: Partial<CaptureSummary> = {}): CaptureSummary {
  return { postsCaptured: 42, lastCaptureAt: ISO_NOW, ...overrides };
}
