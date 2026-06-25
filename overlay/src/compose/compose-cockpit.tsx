// @x-builder/overlay — ComposeCockpit (XOB-029, full overlay-side integration)
//
// The self-orchestrating compose cockpit. It takes ONLY `{ explainer }`, reads
// the engine through the `useTransport()` seam, detects X's compose modal via
// the `AnchorLayer` `ComposeContext`, and mounts the three zone components
// (ComposeGenerateRail / StaticEngineColumn / JudgeStrip) as modal-anchored
// pins. It OWNS the `ComposeMachineState` reducer + `ApplyState`, drives every
// transport call (categories, capture, analyze, judge, generate, apply,
// readiness), performs the explicit-gesture composer-write (generated / improved
// text into `tweetTextarea_0`, never auto-post), runs auto-apply-best candidate
// selection, and guards in-flight judge/apply against composer edits with a
// monotonic request token. A single per-frame rAF snapshot positions the pins
// and the one composition highlight layer off the SAME frame's geometry.
//
// Token-only styling, never a primary CTA, composer writes only on an explicit
// generate / Apply-all gesture: the cockpit never posts.

import {
  deriveApproved,
  type GenerateCategory,
  type GeneratedIdeaCandidate,
  type JudgeVerdict,
  type OverlayReadiness,
} from "@x-builder/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { JudgeAnnotation } from "@x-builder/shared";

import { useComposeContext } from "../anchor-layer";
import { writeIntoComposer } from "../composer-write";
import { CompositionHighlightLayer } from "../highlight/composition-highlight-layer";
import { ProvenanceController } from "../provenance/provenance-controller";
import { useTransport } from "../transport/use-transport";

import { ComposeGenerateRail } from "./compose-generate-rail";
import { ChannelDivider } from "./channel-divider";
import {
  composeReducer,
  initialComposeState,
  type ApplyState,
  type ComposeMachineState,
} from "./compose-machine";
import { StaticEngineColumn, type AnalyzeState } from "./static-engine-column";
import { JudgeStrip, type JudgeState } from "../judge/judge-strip";
import type { ExplainerSource } from "../explainer/types";
import type { ScoredPostItem } from "./types";
import { useComposeSnapshot, type SnapshotRect } from "./use-compose-snapshot";

export interface ComposeCockpitProps {
  /** MetricExplainer copy source — the ONLY external prop (self-orchestrating). */
  explainer: ExplainerSource;
}

/** A stable empty annotation array — one reference shared across renders so a
 *  no-annotation pass never re-arms the highlight layer's locate effect. */
const NO_ANNOTATIONS: readonly JudgeAnnotation[] = Object.freeze([]);

/** Whitespace-insensitive content key: tells our own programmatic write from a
 *  genuine user edit regardless of how Draft.js renders paragraph breaks. */
const contentKey = (text: string | null): string => (text ?? "").replace(/\s+/g, "");

/** The responsive collapse breakpoint (≤ this width ⇒ stacked single column). */
const STACK_BREAKPOINT_PX = 1180;

/** The composer-text → analyze debounce window (matches the ticket's 350 ms). */
const ANALYZE_DEBOUNCE_MS = 350;

/** `--space-5` (~20px) gap between the modal bottom and the JudgeStrip pin. */
const JUDGE_GAP_PX = 20;

/** Read whether the viewport is at/below the stack breakpoint right now. */
function isStackedWidth(): boolean {
  return window.innerWidth <= STACK_BREAKPOINT_PX;
}

/**
 * Track the responsive mode from a width signal the test can read honestly.
 * Seeds from `window.innerWidth` and follows a `matchMedia` breakpoint listener
 * (a tiny read; no JS layout switch — the stacked layout is pure CSS flex).
 */
function useStackedMode(): boolean {
  const [stacked, setStacked] = useState<boolean>(() => isStackedWidth());

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${STACK_BREAKPOINT_PX}px)`);
    const onChange = (): void => setStacked(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return stacked;
}

/** Choose the auto-apply-best candidate per the SCOPE DECISION rule. */
function chooseBestCandidate(candidates: GeneratedIdeaCandidate[]): GeneratedIdeaCandidate {
  // The approved candidates, by `deriveApproved` over their verdict (single
  // source of truth — never an overlay-local threshold).
  const approved = candidates.filter(
    (c) => c.verdict !== undefined && deriveApproved(c.verdict),
  );
  if (approved.length > 0) {
    // Highest `verdict.scores.overall` among the approved wins.
    return approved.reduce((best, c) =>
      (c.verdict?.scores.overall ?? 0) > (best.verdict?.scores.overall ?? 0) ? c : best,
    );
  }
  // None approved ⇒ fall back to the first candidate.
  return candidates[0]!;
}

/** Derive the StaticEngineColumn analyze state from the machine phase. */
function deriveAnalyzeState(phase: ComposeMachineState): AnalyzeState {
  switch (phase.phase) {
    case "idle":
    case "typing":
    case "generating":
      return { status: "idle" };
    case "static_ready":
      return { status: "ready", result: phase.analyzeResult };
    case "judging":
      return phase.analyzeResult !== undefined
        ? { status: "ready", result: phase.analyzeResult }
        : { status: "scoring" };
    case "judged":
      return phase.analyzeResult !== undefined
        ? { status: "ready", result: phase.analyzeResult }
        : { status: "idle" };
    case "judge_failed":
      // A judge failure keeps the (successful) static result visible, if any.
      return phase.analyzeResult !== undefined
        ? { status: "ready", result: phase.analyzeResult }
        : { status: "idle" };
    case "static_failed":
      return { status: "failed", error: phase.error };
    case "apply_failed":
      return phase.analyzeResult !== undefined
        ? { status: "ready", result: phase.analyzeResult }
        : { status: "idle" };
  }
}

/**
 * The judge UI state, DECOUPLED from the static `ComposeMachineState` (XOB #4):
 * the judge runs only on an explicit click (never auto on every keystroke), and a
 * landed verdict survives composer edits — the stale highlight clears (via the
 * `judgedText` mismatch) while the scores stay visible until the user re-runs.
 */
type JudgeUiState =
  | { status: "idle" }
  | { status: "judging" }
  | { status: "judged"; verdict: JudgeVerdict; judgedText: string }
  | { status: "failed"; error: string };

const ROOT_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  // Never push X's UI nor add page scroll: the cockpit floats over the modal.
  overflowX: "hidden",
  pointerEvents: "none",
  zIndex: "var(--xb-z-pin)",
};

const STACKED_ROOT_EXTRA: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-4)",
  overflowY: "auto",
};

const PIN_BASE_STYLE: CSSProperties = {
  position: "absolute",
  // Each pin scrolls internally on overflow; it never grows X's layout.
  overflow: "auto",
  // Keep the scroll INSIDE the pin: reaching the pin's top/bottom must not chain
  // the wheel to X's page behind it (XOB #2).
  overscrollBehavior: "contain",
  maxHeight: "80vh",
  pointerEvents: "auto",
};

const STACKED_PIN_STYLE: CSSProperties = {
  position: "relative",
  overflow: "auto",
  overscrollBehavior: "contain",
  maxHeight: "60vh",
  pointerEvents: "auto",
};

/** Inner orchestrator — only mounted when a composer is detected (active). */
function ActiveCockpit({
  explainer,
  composerEl,
  composerText,
}: {
  explainer: ExplainerSource;
  composerEl: HTMLElement;
  composerText: string;
}): ReactElement {
  const transport = useTransport();
  const [state, dispatch] = useReducer(composeReducer, initialComposeState);
  const stacked = useStackedMode();

  // L1 / open-time data.
  const [categories, setCategories] = useState<GenerateCategory[]>([]);
  const [followers, setFollowers] = useState<number | undefined>(undefined);
  const [readiness, setReadiness] = useState<OverlayReadiness | null>(null);

  // The judge UI, decoupled from the static machine (XOB #4). It runs manually
  // (a button), persists across edits, and is aborted-by-token like the rest.
  const [judgeUi, setJudgeUi] = useState<JudgeUiState>({ status: "idle" });
  const judgeTokenRef = useRef(0);

  // The monotonic request token: bumped on a composer edit; a stale resolution
  // (token !== current) is dropped, so an edit aborts the in-flight judge/apply.
  const tokenRef = useRef(0);
  // The green anchor mirror (kept in lockstep with the ProvenanceController's
  // anchor) so the analyze effect can synchronously tell our own generated write
  // (text === anchor ⇒ skip re-analyze) from a genuine user edit.
  const anchorRef = useRef<string | null>(null);
  // The most recent PROGRAMMATIC write (anchored or not). The debounced analyze
  // runner and the raw-input abort skip it: a write the cockpit itself made (its
  // judge flow is already handled) is never treated as a fresh user edit.
  const lastWriteRef = useRef<string | null>(null);
  // The live ProvenanceController `setAnchor`, captured each render for use in
  // the async write handlers.
  const setProvenanceAnchorRef = useRef<((text: string) => void) | null>(null);
  // The latest readiness, mirrored into a ref so the analyze runner reads the
  // open-fetched gate synchronously (no extra async hop in the analyze chain).
  const readinessRef = useRef<OverlayReadiness | null>(null);
  // The dialog element that hosts the composer (the pin anchor rect source).
  const dialogEl = composerEl.closest<HTMLElement>('[role="dialog"]');

  // The shadow-host-relative single per-frame snapshot for the pins (and the
  // same composer the one highlight layer rides).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useComposeSnapshot(rootRef.current, dialogEl, composerEl);

  // ---- Open-time fetches (categories, followers, readiness) ----------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cats, capture, ready] = await Promise.all([
        transport.getGenerateCategories().catch(() => [] as GenerateCategory[]),
        transport.getCaptureSummary().catch(() => undefined),
        transport.getOverlayReadiness().catch(() => null),
      ]);
      if (cancelled) return;
      setCategories(Array.isArray(cats) ? cats : []);
      // followers is optional (XOB capture summary carries no followers field in
      // the fake; undefined ⇒ StaticEngineColumn disabled-reach path).
      const summaryFollowers = (capture as { followers?: number } | undefined)?.followers;
      setFollowers(typeof summaryFollowers === "number" ? summaryFollowers : undefined);
      const resolved = ready !== null && (ready as OverlayReadiness).llm !== undefined ? ready : null;
      readinessRef.current = resolved;
      setReadiness(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [transport]);

  // ---- The explicit-gesture composer write ---------------------------------
  const writeComposer = useCallback(
    (text: string, anchor: boolean): void => {
      // A Draft.js-safe write (focus → select-all → synthetic paste). Draft
      // re-renders its model asynchronously, so anchor provenance and the
      // own-write dedupe to the REQUESTED text — Draft renders exactly that.
      writeIntoComposer(composerEl, text);
      lastWriteRef.current = text;
      if (anchor) {
        anchorRef.current = text;
        setProvenanceAnchorRef.current?.(text);
      }
    },
    [composerEl],
  );

  // Run the readiness-gated judge for `text` and store the verdict in the
  // decoupled judge UI. Guarded by the judge token so a later edit/run drops a
  // stale verdict. The verdict records the EXACT text it judged (`judgedText`) so
  // the highlight can clear the moment the live text diverges.
  const runJudge = useCallback(
    (text: string): void => {
      if (text.trim() === "") return;
      const ready = readinessRef.current;
      if (ready?.llm?.state !== "ready") {
        setJudgeUi({
          status: "failed",
          error: ready?.llm?.message ?? ready?.llm?.label ?? "Judge unavailable.",
        });
        return;
      }
      const token = ++judgeTokenRef.current;
      setJudgeUi({ status: "judging" });
      void (async () => {
        try {
          const verdict = await transport.judgeDraft({ text });
          if (judgeTokenRef.current !== token) return; // stale verdict dropped
          setJudgeUi({ status: "judged", verdict: verdict.verdict, judgedText: text });
        } catch (error) {
          if (judgeTokenRef.current !== token) return;
          setJudgeUi({
            status: "failed",
            error: error instanceof Error ? error.message : "judge_failed",
          });
        }
      })();
    },
    [transport],
  );

  // ---- The debounced analyze → judge runner --------------------------------
  // Keyed on the ComposeContext composer text. A ~350 ms debounce re-collapses a
  // change burst and kicks `analyzePosts`; on success it auto-kicks the
  // readiness-gated judge. Our own generated/improved write (text === the last
  // programmatic write) is skipped — its judge flow is handled at write time. A
  // request token guards stale resolutions (a later edit drops the in-flight
  // judge).
  useEffect(() => {
    const text = composerText;

    // Our own generated/improved write: the cockpit already drove the judge for
    // it; do not re-analyze (whitespace-insensitive — Draft re-renders the
    // paragraph breaks, so a byte match would miss our own write).
    if (text !== "" && contentKey(text) === contentKey(lastWriteRef.current)) {
      return;
    }

    if (text.trim() === "") {
      tokenRef.current += 1;
      dispatch({ type: "reset_idle" });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      const token = ++tokenRef.current;
      dispatch({ type: "typing" });

      void (async () => {
        let analyzeResult: ScoredPostItem;
        try {
          const response = await transport.analyzePosts({
            items: [{ id: "compose-draft", text }],
            scoringContext: followers !== undefined ? { followers } : {},
            presentation: { postCoachMode: "preview" },
          });
          if (tokenRef.current !== token) return; // aborted by a newer edit
          const first = response.items[0];
          if (first === undefined || first.status !== "scored") {
            dispatch({ type: "analyze_failed", error: "analysis_failed" });
            return;
          }
          analyzeResult = first;
        } catch (error) {
          if (tokenRef.current !== token) return;
          dispatch({
            type: "analyze_failed",
            error: error instanceof Error ? error.message : "analysis_failed",
          });
          return;
        }

        dispatch({ type: "analyze_succeeded", analyzeResult, followers });
        // The judge does NOT auto-run on edits (XOB #4) — only on an explicit
        // Run judge click. The static score above still updates live as you type.
      })();
    }, ANALYZE_DEBOUNCE_MS);

    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [composerText, transport, followers]);

  // ---- Raw-input abort: a genuine edit aborts in-flight work immediately ----
  useEffect(() => {
    const onInput = (): void => {
      const live = composerEl.textContent ?? "";
      // Our own programmatic write is not an abort trigger (its flow is handled).
      if (live !== "" && live === lastWriteRef.current) return;
      // A genuine user edit: bump both tokens (drop any in-flight analyze/apply
      // AND in-flight judge) and clear the apply affordance; the debounced runner
      // re-analyzes. A COMPLETED verdict is left intact — it stays visible (its
      // highlight clears via the judgedText mismatch) until the user re-runs (#4).
      tokenRef.current += 1;
      judgeTokenRef.current += 1;
      dispatch({ type: "typing" });
    };
    composerEl.addEventListener("input", onInput);
    return () => composerEl.removeEventListener("input", onInput);
  }, [composerEl]);

  // ---- Reset the judge on any genuine text change (XOB) ---------------------
  // A verdict only describes the text it judged, so ANY edit (and full removal)
  // invalidates it: reset to the initial "Run judge" state and drop any in-flight
  // judge. Our own programmatic writes (generate / apply) are NOT edits — they
  // set the judge themselves — so a write whose content matches `lastWriteRef`
  // (whitespace-insensitive) is skipped.
  useEffect(() => {
    if (contentKey(composerText) === contentKey(lastWriteRef.current)) {
      return;
    }
    judgeTokenRef.current += 1;
    setJudgeUi({ status: "idle" });
  }, [composerText]);

  // ---- Generate (auto-apply-best) ------------------------------------------
  const onGenerate = useCallback(
    (category: GenerateCategory): void => {
      const token = ++tokenRef.current;
      dispatch({ type: "generate_started", categoryId: category.id });
      void (async () => {
        try {
          const response = await transport.generateIdeas({ format: category.format });
          if (tokenRef.current !== token) return;
          const best = chooseBestCandidate(response.candidates);
          // A generated draft is ALWAYS "generated" provenance → green wash,
          // whether or not the candidate arrived pre-judged. The verdict only
          // governs the "✓ Judge approved" badge, never the green (XOB bug #1).
          writeComposer(best.text, true);
          // Draft adopts the text asynchronously, so analyze/judge the REQUESTED
          // text rather than reading the (stale) composer back synchronously.
          const written = best.text;

          // Statically analyze the generated text so the RIGHT static-engine
          // column fills in (XOB bug #5 — generated drafts previously skipped
          // analyze and the column sat on empty skeleton slots forever). The
          // static engine is deterministic/cheap; a failure is non-fatal — we
          // still surface the judge below.
          let analyzeResult: ScoredPostItem | undefined;
          try {
            const analysis = await transport.analyzePosts({
              items: [{ id: "compose-draft", text: written }],
              scoringContext: followers !== undefined ? { followers } : {},
              presentation: { postCoachMode: "preview" },
            });
            if (tokenRef.current !== token) return;
            const first = analysis.items[0];
            if (first !== undefined && first.status === "scored") {
              analyzeResult = first;
            }
          } catch {
            if (tokenRef.current !== token) return;
          }

          // Surface the static result in the right column regardless of judge path.
          if (analyzeResult !== undefined) {
            dispatch({ type: "analyze_succeeded", analyzeResult, followers });
          }

          if (best.verdict !== undefined) {
            // Pre-judged candidate: adopt its verdict (generated posts are judged
            // by default — #8), recording the generated text as the judged text.
            judgeTokenRef.current += 1;
            setJudgeUi({ status: "judged", verdict: best.verdict, judgedText: written });
          } else {
            // Verdict-less candidate: run the judge on the written text.
            runJudge(written);
          }
        } catch {
          if (tokenRef.current !== token) return;
          dispatch({ type: "reset_idle" });
        }
      })();
    },
    [transport, writeComposer, runJudge, followers],
  );

  // ---- Apply-all (improve) -------------------------------------------------
  const onApplyAll = useCallback((): void => {
    const text = composerEl.innerText ?? composerEl.textContent ?? "";
    if (text.trim() === "") return;
    const token = ++tokenRef.current;
    dispatch({ type: "apply_started" });
    void (async () => {
      try {
        const result = await transport.applyJudgeSuggestions({ text });
        if (tokenRef.current !== token) return; // edit aborted the apply
        // Write the improved text + re-pin the green anchor (provenance generated).
        writeComposer(result.text, true);
        // Adopt the post-apply verdict (judged against the improved text).
        judgeTokenRef.current += 1;
        setJudgeUi({ status: "judged", verdict: result.verdict, judgedText: result.text });
        dispatch({
          type: "apply_applied",
          verdict: result.verdict,
          improvedOverOriginal: result.improvedOverOriginal,
        });
      } catch (error) {
        if (tokenRef.current !== token) return;
        dispatch({
          type: "apply_failed",
          error: error instanceof Error ? error.message : "apply_failed",
        });
      }
    })();
  }, [composerEl, transport, writeComposer]);

  // ---- Retry handlers ------------------------------------------------------
  const onRetryStatic = useCallback((): void => {
    // Re-run the static analyze for the live text (paragraph-preserving).
    const text = composerEl.innerText ?? composerEl.textContent ?? "";
    if (text.trim() === "") return;
    const token = ++tokenRef.current;
    dispatch({ type: "typing" });
    void (async () => {
      try {
        const response = await transport.analyzePosts({
          items: [{ id: "compose-draft", text }],
          scoringContext: followers !== undefined ? { followers } : {},
          presentation: { postCoachMode: "preview" },
        });
        if (tokenRef.current !== token) return;
        const first = response.items[0];
        if (first === undefined || first.status !== "scored") {
          dispatch({ type: "analyze_failed", error: "analysis_failed" });
          return;
        }
        dispatch({ type: "analyze_succeeded", analyzeResult: first, followers });
      } catch (error) {
        if (tokenRef.current !== token) return;
        dispatch({
          type: "analyze_failed",
          error: error instanceof Error ? error.message : "analysis_failed",
        });
      }
    })();
  }, [composerEl, transport, followers]);

  // Manual judge: the always-present Run/Re-run button judges the LIVE composer
  // text (XOB #4). The judge never runs on its own.
  const onRunJudge = useCallback((): void => {
    runJudge(composerEl.innerText ?? composerEl.textContent ?? "");
  }, [composerEl, runJudge]);

  // ---- Derived child props --------------------------------------------------
  const analyzeState = deriveAnalyzeState(state.phase);
  const pendingCategory = state.phase.phase === "generating" ? state.phase.categoryId : undefined;

  const latestVerdict: JudgeVerdict | null =
    judgeUi.status === "judged" ? judgeUi.verdict : null;
  const judgeReady = readiness?.llm?.state === "ready";
  const canRunJudge = composerText.trim().length > 0 && judgeReady;

  // Map the decoupled judge UI onto the JudgeStrip display state.
  const judgeState: JudgeState =
    judgeUi.status === "judging"
      ? { status: "running" }
      : judgeUi.status === "judged"
        ? { status: "judged", verdict: judgeUi.verdict }
        : judgeUi.status === "failed"
          ? { status: "failed", error: judgeUi.error }
          : judgeReady
            ? { status: "waiting" }
            : {
                status: "unavailable",
                hint: readiness?.llm?.message ?? readiness?.llm?.label ?? "Judge unavailable.",
              };

  // A reference-stable annotations array (the frozen empty singleton when there
  // are none) so the highlight layer's locate effect re-arms only on real change.
  // An edit resets the judge (latestVerdict → null), so the highlights clear on
  // their own — no stale gating needed.
  const annotations = useMemo<JudgeAnnotation[]>(
    () =>
      latestVerdict !== null && latestVerdict.annotations.length > 0
        ? latestVerdict.annotations
        : (NO_ANNOTATIONS as JudgeAnnotation[]),
    [latestVerdict],
  );

  // Pin placement off the single snapshot (host-relative). Wide layout pins the
  // three zones over the modal; stacked layout flows them in one column.
  const railStyle = widePinStyle(snapshot.modal, "left");
  const staticStyle = widePinStyle(snapshot.modal, "right");
  const judgeStyle = wideJudgeStyle(snapshot.modal);

  return (
    <div
      ref={rootRef}
      data-cockpit={stacked ? "stacked" : "wide"}
      style={stacked ? { ...ROOT_STYLE, ...STACKED_ROOT_EXTRA } : ROOT_STYLE}
    >
      <ProvenanceController
        composerEl={composerEl}
        composerText={composerText}
        annotations={annotations}
        latestVerdict={latestVerdict}
      >
        {(ctx) => {
          // Capture the live setAnchor for the async write handlers.
          setProvenanceAnchorRef.current = ctx.setAnchor;
          return (
            <>
              <div data-cockpit-pin style={stacked ? STACKED_PIN_STYLE : railStyle}>
                <ComposeGenerateRail
                  categories={categories}
                  pending={pendingCategory}
                  onGenerate={onGenerate}
                />
              </div>

              <div data-cockpit-pin style={stacked ? STACKED_PIN_STYLE : staticStyle}>
                {stacked ? <ChannelDivider leading="Static engine" trailing="AI judge" /> : null}
                <StaticEngineColumn
                  analyzeState={analyzeState}
                  followers={followers}
                  onRetryStatic={onRetryStatic}
                  explainer={explainer}
                />
              </div>

              <div data-cockpit-pin style={stacked ? STACKED_PIN_STYLE : judgeStyle}>
                {stacked ? <ChannelDivider leading="Static engine" trailing="AI judge" /> : null}
                <JudgeStrip
                  judge={judgeState}
                  provenance={ctx.provenanceState}
                  applyState={state.applyState as ApplyState}
                  onRunJudge={onRunJudge}
                  canRunJudge={canRunJudge}
                  approved={ctx.approved}
                  onApplyAll={onApplyAll}
                  explainer={explainer}
                />
              </div>

              {/* The ONE composition highlight layer, riding the same composer the
                  snapshot tracks (single rect source — no second measure loop).
                  `showGreen` is gated on the provenance ctx; in `generated` state
                  the layer paints the green wash and ignores annotations. */}
              <CompositionHighlightLayer
                composerEl={composerEl}
                annotations={ctx.showGreen ? (NO_ANNOTATIONS as JudgeAnnotation[]) : annotations}
                showGreen={ctx.showGreen}
              />
            </>
          );
        }}
      </ProvenanceController>
    </div>
  );
}

/** Position a side pin (LEFT rail / RIGHT static) against the modal box. */
function widePinStyle(modal: SnapshotRect | null, side: "left" | "right"): CSSProperties {
  if (modal === null) {
    return { ...PIN_BASE_STYLE, top: 0, left: side === "left" ? 0 : undefined, right: side === "right" ? 0 : undefined, width: "320px" };
  }
  const width = 320;
  const gap = JUDGE_GAP_PX;
  if (side === "left") {
    return { ...PIN_BASE_STYLE, top: `${modal.top}px`, left: `${modal.left - width - gap}px`, width: `${width}px` };
  }
  return { ...PIN_BASE_STYLE, top: `${modal.top}px`, left: `${modal.left + modal.width + gap}px`, width: `${width}px` };
}

/** Position the UNDER judge pin below the modal bottom + `--space-5` gap. */
function wideJudgeStyle(modal: SnapshotRect | null): CSSProperties {
  if (modal === null) {
    return { ...PIN_BASE_STYLE, bottom: 0, left: 0, width: "480px" };
  }
  return {
    ...PIN_BASE_STYLE,
    top: `${modal.top + modal.height + JUDGE_GAP_PX}px`,
    left: `${modal.left}px`,
    width: `${modal.width}px`,
  };
}

/**
 * The compose cockpit. Self-orchestrating: it renders nothing until the
 * `ComposeContext` reports an active composer, then mounts the full integration.
 */
export function ComposeCockpit({ explainer }: ComposeCockpitProps): ReactNode {
  const compose = useComposeContext();
  // While X's discard/"save post?" confirmation sheet is up it layers OVER the
  // (still-present) compose modal; the cockpit pins would cover it (XOB bug #6),
  // so the whole cockpit stands down until the sheet is dismissed.
  if (!compose.isActive || compose.composerEl === null || compose.confirmationActive) {
    return null;
  }
  return (
    <ActiveCockpit
      explainer={explainer}
      composerEl={compose.composerEl}
      composerText={compose.composerText}
    />
  );
}
