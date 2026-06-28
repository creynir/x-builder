// The runner-driven overlay E2E harness.
//
// Boots a REAL RunnerApp against a route-mocked persistent context: the real
// overlay bundle is injected via addInitScript, the real 24 __xbuilder_* engine
// bindings are bound through the real BoundEngineServices adapter over tmpdir
// repositories, and the real GraphQlCaptureObserver and ExternalXSignalsCaptureObserver observe the page's own
// GraphQL responses. The ONLY mocked boundaries are x.com's network (route layer,
// mock-route-handlers.ts) and the LLM provider (the deterministic fake below).
//
// Seams used (all injectable on RunnerApp, no source/config edits):
//   • launchBrowser  — launch a persistent context with an isolated tmpdir
//                      userDataDir, install the mock-x route layer + request log
//                      BEFORE returning the context (so routes precede goto).
//   • bindTransport  — build the real BoundEngineServices bundle (createBound-
//                      EngineServices) over the runner-built tmpdir repositories,
//                      injecting the fake structured-LLM + a ready-llm readiness
//                      service + the shared capture observer.
//   • attachObserver — register the SAME GraphQlCaptureObserver on the context so
//                      its capture state is shared with the bundle's readiness.
//
// NEVER touches ~/.x-builder: engineSettingsDir + browserProfileDir are tmpdirs.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type BrowserContext, type Page } from "@playwright/test";
// Deep imports into the built runner package. @x-builder/runner is hoisted to the
// top-level node_modules (resolvable from e2e-tests); its dist files are reachable
// by path. createBoundEngineServices is the in-process engine-bundle adapter;
// GraphQlCaptureObserver and ExternalXSignalsCaptureObserver are observe-only capture listeners.
import { RunnerApp } from "@x-builder/runner";
import { createBoundEngineServices } from "@x-builder/runner/dist/bound-engine-services.js";
import { ExternalXSignalsCaptureObserver } from "@x-builder/runner/dist/external-x-signals-capture-observer.js";
import { GraphQlCaptureObserver } from "@x-builder/runner/dist/graphql-capture-observer.js";

import { installMockX, type MockXLog } from "./mock-route-handlers";

const ISO = "2026-06-21T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Fake structured-LLM gateway (the only external boundary that is faked).
//
// The real JudgeDraftService / GenerateIdeasService / ApplyJudgeSuggestionsService
// call `generateStructured(request)`; the request carries a
// `structuredOutput.parser` that maps raw model output → the typed value, and
// `turns[].content` carries the draft / seed. We run the REAL parser so the
// verdict-band derivation and Zod validation run exactly as in production — only
// the provider round-trip is faked. Purposes:
//   • candidate_judge    → a JudgeVerdict model output (scores/annotations/…)
//   • writer_variants    → { candidates: [{id,text}] } (3 drafts from the seed)
//   • writer_first_pass  → { text } (the rewrite for Apply-all)
// ---------------------------------------------------------------------------

/** Per-purpose behavior knobs a test can flip before/while the harness runs. */
export interface FakeLlmPolicy {
  /**
   * Judge behavior: "ok" returns a deterministic input-derived verdict;
   * "hang" never resolves (simulates a judge timeout — inv#3); "fail" returns a
   * failed provider result (inv#4).
   */
  judge: "ok" | "hang" | "fail";
  /**
   * The annotation quote the judge emits. Tests type a draft CONTAINING this
   * substring so the highlight layer locates a real Range (blue underlay). When a
   * test edits the substring out, the locate pass drops the rect silently (Flow E
   * / inv#6). An empty string emits no annotation.
   */
  annotationQuote: string;
  /**
   * Artificial latency (ms) for the judge's "ok" path, so the cockpit's "AI judge
   * running" pulse is observable. Does not apply to "hang"/"fail".
   */
  judgeLatencyMs: number;
}

export function defaultLlmPolicy(): FakeLlmPolicy {
  return { judge: "ok", annotationQuote: "specific phrase", judgeLatencyMs: 250 };
}

/** A simple promise delay (used to make the judge "ok" pulse observable). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The signature the Apply-all rewrite appends (see the writer_first_pass branch).
// Only a rewritten draft carries it, so the re-judge can score it strictly above
// the original WITHOUT relying on raw length (the displayed drafts and the
// generated-candidate drafts vary wildly in length across flows). This keeps the
// never-worse guard honest while letting the displayed band be deterministic.
const REWRITE_SIGNATURE = "more answerable closing question";

// Deterministic, input-derived overall score that maps cleanly onto the real
// `deriveJudgeVerdict` bands (shared, untouched: >=85 post_now, >=70 slight_rework,
// >=40 major_rework). Three tiers, checked in priority order:
//   1. A rewrite (carries REWRITE_SIGNATURE)            -> 88  (post_now, approved)
//      — strictly above the displayed-draft tier so the Apply-all never-worse
//        guard keeps the improved text regardless of either draft's length.
//   2. A draft carrying the annotation quote            -> 78  (slight_rework)
//      — the user-typed / edited draft that the flows display while user_written;
//        slight_rework is the correct state for OFFERING Apply-all (post_now +
//        Apply-all would be contradictory).
//   3. Anything else (e.g. generate→judge candidates)   -> 90  (post_now, approved)
//      — keeps the generated candidates pre-approved for the Flow B entry path.
// The score is still input-derived (different inputs -> different tiers), so two
// distinct drafts can differ and the verdict is never a stored constant.
function scoreFor(text: string, annotationQuote: string): number {
  if (text.includes(REWRITE_SIGNATURE)) {
    return 88;
  }
  if (annotationQuote.length > 0 && text.includes(annotationQuote)) {
    return 78;
  }
  return 90;
}

function verdictModelOutput(text: string, annotationQuote: string): unknown {
  const s = scoreFor(text, annotationQuote);
  const score13 = {
    overall: s,
    replies: s,
    profileClicks: s,
    impressions: s,
    bookmarkValue: s,
    dwellProxy: s,
    voiceMatch: s,
    negativeRisk: 12,
    answerEffort: s,
    strangerAnswerability: s,
    statusDependency: 20,
    replyVsQuoteOrientation: s,
    audienceMatch: null,
  };
  // Emit an annotation ONLY when the quote is actually present in the draft, so
  // the produced verdict.annotations[].quote is a real substring the highlight
  // layer can locate. When the quote was edited out, the judge naturally returns
  // no annotation for it (the legitimate, non-degrade path); the degrade path is
  // separately exercised by feeding a stale annotation whose quote is gone.
  const annotations =
    annotationQuote.length > 0 && text.includes(annotationQuote)
      ? [
          {
            quote: annotationQuote,
            severity: "suggestion",
            recommendation: "Tighten this phrase for a clearer hook.",
          },
        ]
      : [];
  return {
    confidence: "medium",
    scores: score13,
    headline: "Solid hook, tighten the close.",
    strengths: ["Opens with a concrete claim"],
    improvements: ["Cut one hedge word"],
    annotations,
  };
}

export interface FakeLlm {
  gateway: { generateStructured: (request: unknown) => Promise<unknown> };
  policy: FakeLlmPolicy;
  /** Per-purpose call counts, for assertions about which LLM paths ran. */
  calls: { candidate_judge: number; writer_variants: number; writer_first_pass: number };
}

function createFakeLlm(policy: FakeLlmPolicy): FakeLlm {
  const calls = { candidate_judge: 0, writer_variants: 0, writer_first_pass: 0 };

  const generateStructured = async (request: any): Promise<unknown> => {
    const userContent: string =
      request.turns.find((t: any) => t.role === "user")?.content ?? "";
    const purpose: string = request.purpose;
    if (purpose === "candidate_judge" || purpose === "writer_variants" || purpose === "writer_first_pass") {
      calls[purpose] += 1;
    }

    if (purpose === "candidate_judge") {
      if (policy.judge === "hang") {
        // Never resolves: simulates a judge that times out. The static column
        // must still fill (inv#3); the cockpit's token guard handles the rest.
        return new Promise<never>(() => {});
      }
      if (policy.judge === "fail") {
        return {
          status: "failed" as const,
          provider: "codex-cli",
          requestId: "req-fake-fail",
          code: "provider_error",
          message: "Judge provider failed.",
          retryable: true,
          durationMs: 1,
          completedAt: ISO,
        };
      }
      // A small artificial latency so the cockpit's "AI judge running" pulse
      // renders long enough to be observable (an instantly-resolving judge would
      // flip running → judged within one microtask burst, before Playwright could
      // catch the pulse). Only the "ok" path delays; "hang"/"fail" are untouched,
      // so inv#3 (hang) and inv#4 (fail) keep their behavior. The delay is short
      // (default 250 ms) so the suite stays fast and is not timing-fragile —
      // assertions still use auto-waiting, never a hard sleep.
      await delay(policy.judgeLatencyMs);
      const raw = verdictModelOutput(userContent, policy.annotationQuote);
      return {
        status: "success" as const,
        provider: "codex-cli",
        requestId: "req-fake-judge",
        output: request.structuredOutput.parser(raw),
        durationMs: policy.judgeLatencyMs,
        completedAt: ISO,
      };
    }

    if (purpose === "writer_first_pass") {
      // The Apply-all rewrite. Make it strictly longer than the original so the
      // re-judge scores higher and the never-worse guard keeps the improved text.
      const improved = `${userContent} Now with a sharper, more answerable closing question.`;
      return {
        status: "success" as const,
        provider: "codex-cli",
        requestId: "req-fake-rewrite",
        output: request.structuredOutput.parser({ text: improved }),
        durationMs: 1,
        completedAt: ISO,
      };
    }

    // writer_variants: three distinct drafts derived from the seed. Each is long
    // enough that its subsequent judge pass lands in the approved band so the
    // generate→judge refine returns pre-approved candidates (Flow B).
    const raw = {
      candidates: [
        { id: "c1", text: `${userContent} :: a first sharp angle worth posting today.` },
        { id: "c2", text: `${userContent} :: a second distinct angle that reads like a person.` },
        { id: "c3", text: `${userContent} :: a third angle with a concrete, answerable hook.` },
      ],
    };
    return {
      status: "success" as const,
      provider: "codex-cli",
      requestId: "req-fake-generate",
      output: request.structuredOutput.parser(raw),
      durationMs: 1,
      completedAt: ISO,
    };
  };

  return { gateway: { generateStructured }, policy, calls };
}

// A readiness service reporting the judge (llm) subsystem READY. The cockpit
// gates the judge kick on readiness.llm.state === "ready"; the default engine
// readiness service would probe a (here unconfigured) provider and report it
// unavailable, which would suppress the judge flow. Injecting a ready status is
// the correct E2E posture: the provider boundary is the fake LLM, and "is a judge
// configured" is not what these flows exercise.
function readySubsystem(label: string) {
  return {
    state: "ready" as const,
    label,
    retryable: false,
    checkedAt: ISO,
    details: {},
  };
}

function readyReadinessService() {
  return {
    getStatus: () =>
      Promise.resolve({
        overall: "ready" as const,
        version: "e2e",
        generatedAt: ISO,
        engine: readySubsystem("Engine"),
        deterministic: readySubsystem("Deterministic scorer"),
        llm: readySubsystem("Judge"),
        storage: readySubsystem("Storage"),
        lastRun: { state: "none" as const },
      }),
  };
}

/** A running harness instance. */
export interface SeedCapturedPostInput {
  platformPostId: string;
  text: string;
  impressions?: number;
  id?: string;
}

export interface RunnerHarness {
  app: RunnerApp;
  page: Page;
  context: BrowserContext;
  log: MockXLog;
  llm: FakeLlm;
  /** Mount the overlay (bounded wait; throws a descriptive error on failure). */
  mountOverlay(): Promise<void>;
  /** Invoke a page-exposed `__xbuilder_<method>` engine binding directly. */
  callBinding(method: string, arg?: unknown): Promise<unknown>;
  /** Seed a captured own post into the temp post library used by bound services. */
  seedCapturedPost(input: SeedCapturedPostInput): Promise<void>;
  stop(): Promise<void>;
}

export interface StartRunnerOptions {
  /** Override the fake-LLM policy (judge ok/hang/fail, annotation quote). */
  llmPolicy?: Partial<FakeLlmPolicy>;
  /** Initial viewport (defaults to a WIDE layout so the cockpit is three-zone). */
  viewport?: { width: number; height: number };
}

/**
 * Start a RunnerApp wired to the mock-x context + fake LLM, navigate to x.com,
 * and wait until the overlay shadow host is mounted. Returns the live page,
 * request log, fake LLM, and a `stop()` that closes the context and cleans the
 * tmpdirs.
 */
export async function startRunner(options: StartRunnerOptions = {}): Promise<RunnerHarness> {
  const policy: FakeLlmPolicy = { ...defaultLlmPolicy(), ...options.llmPolicy };
  const llm = createFakeLlm(policy);

  const tempDir = mkdtempSync(join(tmpdir(), "x-builder-e2e-"));
  const engineSettingsDir = join(tempDir, "engine-settings");
  const browserProfileDir = join(tempDir, "browser-profile");

  // Captured so attachObserver and bindTransport share one observer instance:
  // bindTransport (runs first) hands it to the readiness composer; attachObserver
  // (runs second) registers it on the context.
  const observer = new GraphQlCaptureObserver();

  let context!: BrowserContext;
  let log!: MockXLog;
  let seedCapturedPostImpl: ((input: SeedCapturedPostInput) => Promise<void>) | undefined;

  const app = new RunnerApp({
    engineSettingsDir,
    browserProfileDir,
    // Launch a persistent context (the production launch shape), install the mock
    // routes + request log BEFORE returning so routes precede the runner's goto.
    launchBrowser: async (opts) => {
      context = await chromium.launchPersistentContext(opts.userDataDir, {
        headless: true,
        viewport: options.viewport ?? { width: 1440, height: 900 },
      });
      log = await installMockX(context);
      return context as never;
    },
    // Build the REAL adapter bundle over the runner-built tmpdir repositories,
    // injecting the fake LLM (both gateways) + a ready readiness service + the
    // shared observer.
    bindTransport: async (page, services) => {
      const { ExposeFunctionTransport } = await import("@x-builder/runner");
      const postLibraryRepository = services.postLibraryRepository!;
      seedCapturedPostImpl = async (input: SeedCapturedPostInput): Promise<void> => {
        await postLibraryRepository.upsertPosts([
          {
            id: input.id ?? input.platformPostId,
            platform: "x",
            platformPostId: input.platformPostId,
            text: input.text,
            createdAt: ISO,
            kind: "original",
            language: "en",
            replyReferences: {},
            entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
            weakMetrics: {},
            metricSnapshots: [
              {
                source: "x_live_capture",
                capturedAt: ISO,
                impressions: input.impressions ?? 1_000,
                likes: 10,
                reposts: 2,
                replies: 3,
              },
            ],
            sourceRefs: [],
          },
        ]);
      };
      const bundle = createBoundEngineServices({
        settingsRepository: services.settingsRepository!,
        postLibraryRepository,
        externalXSignalsService: services.externalXSignalsService,
        liveCapture: services.liveCapture as never,
        llm: llm.gateway as never,
        judgeLlm: llm.gateway as never,
        observer,
        readinessService: readyReadinessService(),
      } as never);
      await ExposeFunctionTransport.bindAll(page as never, bundle);
    },
    // Register observe-only listeners on the context. External registered
    // sources are written to the external ledger and skipped by own-post capture.
    attachObserver: (ctx, onBatch, services) => {
      const externalObserver = services.externalXSignalsService
        ? new ExternalXSignalsCaptureObserver(services.externalXSignalsService).attachTo(
            ctx as never,
          )
        : undefined;
      observer.attachTo(
        ctx as never,
        async (batch) => {
          await onBatch(batch);
        },
        {
          shouldSkip: externalObserver
            ? (observation) => externalObserver.isRegisteredExternalObservation(observation)
            : undefined,
        },
      );
    },
  });

  await app.start();

  const page = context.pages()[0]!;
  if (process.env.XB_E2E_DEBUG) {
    page.on("console", (m) => console.log("[page]", m.type(), m.text()));
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  }
  // Wait for the mock document to have loaded the composer (proves goto reached
  // the route-served x.com document). This is independent of the overlay.
  await page.waitForSelector('div[data-testid="tweetTextarea_0"]', { state: "attached" });

  return {
    app,
    page,
    context,
    log,
    llm,
    mountOverlay: () => mountOverlay(page),
    callBinding: (method: string, arg?: unknown) => callBinding(page, method, arg),
    seedCapturedPost: async (input: SeedCapturedPostInput): Promise<void> => {
      if (seedCapturedPostImpl === undefined) {
        throw new Error("Runner harness post-library seeding was not initialized.");
      }
      await seedCapturedPostImpl(input);
    },
    stop: async () => {
      await app.stop();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/**
 * Trigger the overlay's single page entrypoint (`window.__xbBootstrap`, assigned
 * by the injected bundle) and wait — BOUNDED — until the shadow host is mounted
 * AND its React tree has rendered something. A clean throw (not a 30s hang) when
 * the overlay fails to come up keeps a broken-bundle failure legible.
 *
 * The injected bundle assigns `window.__xbBootstrap` at module-eval time; if the
 * bundle throws on evaluation (e.g. a `process is not defined` reference in a
 * browser), the global is never assigned and this throws a descriptive error.
 */
export async function mountOverlay(page: Page): Promise<void> {
  const hasBootstrap = await page
    .waitForFunction(() => typeof (window as { __xbBootstrap?: unknown }).__xbBootstrap === "function", null, {
      timeout: 5_000,
    })
    .then(() => true)
    .catch(() => false);

  if (!hasBootstrap) {
    throw new Error(
      "Overlay never exposed window.__xbBootstrap — the injected overlay bundle " +
        "failed to evaluate in the page (it never assigned its global). The overlay " +
        "cannot mount in the runner.",
    );
  }

  await page.evaluate(() => (window as { __xbBootstrap?: () => void }).__xbBootstrap?.());

  // The host is created synchronously by bootstrap(); the React tree is deferred
  // to requestIdleCallback. Wait (bounded) for the shadow tree to carry rendered
  // content, not just the empty mount node.
  await page.waitForFunction(
    () => {
      const host = document.getElementById("xb-overlay-root");
      const shadow = host?.shadowRoot;
      return !!shadow && (shadow.textContent ?? "").trim().length > 0;
    },
    null,
    { timeout: 5_000 },
  );
}

/**
 * Invoke a page-exposed `__xbuilder_<method>` engine binding directly (the same
 * functions the overlay's transport seam is meant to call). Lets the
 * capture/transport invariants (#1/#2, Flow D) be asserted independently of the
 * overlay UI rendering.
 */
export async function callBinding(page: Page, method: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    async ({ binding, value }) => {
      const fn = (window as unknown as Record<string, (a: unknown) => Promise<unknown>>)[binding];
      if (typeof fn !== "function") {
        throw new Error(`Binding ${binding} is not exposed on the page.`);
      }
      return fn(value);
    },
    { binding: `__xbuilder_${method}`, value: arg },
  );
}
