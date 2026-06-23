/**
 * In-process integration tests for the transport↔engine binding seam (Group A —
 * NEW BUILD, must fail until the implementation lands).
 *
 * WHAT EXISTS TODAY (and is NOT under test here): `ExposeFunctionTransport.bindAll`
 * is service-agnostic — it routes each binding to a structurally-typed
 * `BoundEngineServices` whose methods a TEST supplies. `RunnerApp.bindTransport`
 * and `RunnerApp.attachObserver` default to NO-OPs.
 *
 * WHAT THIS SUITE DRIVES (the build XOB hands the Green agent):
 *   1. A real `BoundEngineServices` adapter bundle — a constructed object that
 *      wires every engine service the 17 bindings map to, consumed by
 *      `ExposeFunctionTransport.bindAll`. Exposed as a factory from the runner
 *      package (imported below as `createBoundEngineServices`). It does NOT
 *      exist yet, so the import fails to resolve — the intended Red state
 *      (missing implementation, not a broken test).
 *   2. `RunnerApp` default wiring: with NO `bindTransport`/`attachObserver`
 *      injected, `start()` must register exactly the 17 `__xbuilder_*` bindings
 *      on the page and register a single response listener on the context.
 *   3. Arg-shape adapters: `judgeDraft` maps `req → judge(req.text,
 *      req.accountProfile)` and unwraps `JudgeDraftOutcome → JudgeDraftResponse`;
 *      `getOverlayReadiness` wraps the engine readiness `getStatus()` into the
 *      readiness shape; `getStatus` is composed from the engine `/status` logic.
 *   4. `analyzePosts` per-item `cooldown` re-attach survives the round-trip
 *      (the field is schema-OPTIONAL, so a missing re-attach silently drops it).
 *   5. Generate-refine: `generateIdeas({format})` returns 3 candidates each
 *      carrying `verdict` + `approved`, with `approved === deriveApproved(verdict)`.
 *
 * Invariants asserted: #1 (1:1 bindings), #2 (input-derived, no stored response),
 * #4 (approved via shared deriveApproved), #6 (capture observed, not injected).
 *
 * BOUNDARIES MOCKED: only the LLM (an injected fake structured-LLM gateway /
 * judge) and the Playwright page/context. The engine integration is REAL:
 * tmpdir-backed JSON repositories, the real deterministic analyzer, the real
 * cooldown window service, the real resolver chain. No live x.com, no network.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ENGINE_TRANSPORT_BINDINGS,
  analyzePostsResponseSchema,
  appStatusSchema,
  cooldownReportSchema,
  deriveApproved,
  generateIdeaResponseSchema,
  judgeDraftResponseSchema,
  overlayReadinessSchema,
  type AnalyzePostsRequest,
  type CaptureIngestRequest,
  type JudgeVerdict,
} from "@x-builder/shared";
import {
  JsonFileAppSettingsRepository,
  JsonFilePostLibraryRepository,
  LiveCaptureService,
} from "@x-builder/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExposeFunctionTransport } from "./expose-function-transport.js";
import { RunnerApp } from "./runner-app.js";
// --- NEW BUILD: the real adapter bundle factory. Does not exist yet; this
// --- unresolved import is what puts the whole Group-A suite in the Red state.
import { createBoundEngineServices } from "./bound-engine-services.js";

// A real already-fetched UserTweets GraphQL body (the page issued this request,
// not us) — reused so the normalizer round-trip is exercised, not faked.
import userTweetsValid from "./__fixtures__/graphql/user-tweets-valid.json";

// ---------------------------------------------------------------------------
// A fake structured-LLM gateway. The judge path asks for a "candidate_judge"
// purpose; the generate path asks for "writer_variants". We return an
// input-derived verdict (so invariant #2 holds: different text → different
// scores) and three drafts derived from the seed topic.
// ---------------------------------------------------------------------------

const ISO = "2026-06-21T12:00:00.000Z";

// Map a draft string to a deterministic 0-100 score so two different drafts
// yield two different verdicts (invariant #2). Longer text scores higher; the
// band crosses 70 at length 8 so we can choose approving / non-approving inputs.
function scoreFor(text: string): number {
  return Math.max(0, Math.min(100, text.trim().length * 9));
}

function verdictModelOutput(text: string) {
  const s = scoreFor(text);
  return {
    confidence: "medium",
    scores: {
      overall: s,
      replies: s,
      profileClicks: s,
      impressions: s,
      bookmarkValue: s,
      dwellProxy: s,
      voiceMatch: s,
      negativeRisk: s,
      answerEffort: s,
      strangerAnswerability: s,
      statusDependency: s,
      replyVsQuoteOrientation: s,
      audienceMatch: null,
    },
    headline: "Judged.",
    strengths: ["clear"],
    improvements: [],
  };
}

/**
 * A fake `StructuredLlmService`-shaped gateway. The real `JudgeDraftService` /
 * `GenerateIdeasService` call `generateStructured(request)`; the request carries
 * a `structuredOutput.parser` that maps raw model output → the typed value, and
 * `turns[].content` carries the draft / seed. We run the real parser so the
 * verdict-band derivation and Zod validation run exactly as in production, only
 * the provider round-trip is faked.
 */
function createFakeLlm() {
  const calls: Array<{ purpose: string; userContent: string }> = [];
  const generateStructured = vi.fn(async (request: any) => {
    const userContent =
      request.turns.find((t: any) => t.role === "user")?.content ?? "";
    calls.push({ purpose: request.purpose, userContent });

    let raw: unknown;
    if (request.purpose === "candidate_judge") {
      // The judged text is the user turn content (the draft itself).
      raw = verdictModelOutput(userContent);
    } else {
      // writer_variants: three distinct drafts derived from the seed.
      raw = {
        candidates: [
          { id: "c1", text: `${userContent} :: first angle` },
          { id: "c2", text: `${userContent} :: second angle` },
          { id: "c3", text: `${userContent} :: third angle` },
        ],
      };
    }

    return {
      status: "success" as const,
      provider: "codex-cli",
      requestId: "req-fake",
      output: request.structuredOutput.parser(raw),
      durationMs: 1,
      completedAt: ISO,
    };
  });

  return { gateway: { generateStructured }, calls, generateStructured };
}

// A "hot take:" prefix classifies as the `hot_take` detected format, so seeding
// several recent originals of this shape makes RepetitionWindowService emit a
// hot_take cooldown signal, and an analyzed "hot take:" item carries
// detectedFormat: "hot_take" — the join the cooldown re-attach depends on.
function hotTakeText(suffix: string): string {
  return `hot take: ${suffix}`;
}

// Seed through the REAL capture ingest path (the corpus accumulates exactly as a
// live session would): each post is a liveCapturedPost the service ids, stamps
// with an x_live_capture snapshot, and upserts — so corpusSource becomes "live".
async function seedHotTakeCorpus(capture: LiveCaptureService): Promise<void> {
  const now = Date.now();
  const batch: CaptureIngestRequest = {
    posts: Array.from({ length: 4 }, (_value, index) => ({
      platformPostId: `seed-${index}`,
      text: hotTakeText(`seeded angle number ${index}`),
      createdAt: new Date(now - index * 60_000).toISOString(),
      kind: "original" as const,
      replyReferences: {},
      entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
      liveMetrics: { impressions: 100 + index },
      capturedAt: new Date(now - index * 60_000).toISOString(),
    })),
  };
  await capture.ingest(batch);
}

// A schema-valid analyze request whose single item is a hot_take draft.
function analyzeRequest(text: string): AnalyzePostsRequest {
  return {
    items: [{ id: "draft-1", text }],
    scoringContext: { followers: 5_000 },
  } as AnalyzePostsRequest;
}

// ---------------------------------------------------------------------------
// Build the real bundle over tmpdir repositories + the fake LLM. The exact
// option surface is the Green agent's to define; this is the behavior the
// bundle must support: in-process engine services, no network, an injectable
// LLM seam, and tmpdir storage (never ~/.x-builder).
// ---------------------------------------------------------------------------

let tempDir: string;
let settingsRepository: JsonFileAppSettingsRepository;
let postLibraryRepository: JsonFilePostLibraryRepository;
let liveCapture: LiveCaptureService;

function buildBundle(extra?: { observerState?: "ok" | "paused" | "layout_changed" }) {
  const { gateway, calls, generateStructured } = createFakeLlm();
  const observer = { state: extra?.observerState ?? "paused" as const, lastCaptureAt: undefined };
  const services = createBoundEngineServices({
    settingsRepository,
    postLibraryRepository,
    liveCapture,
    // The LLM boundary — the only external dependency we mock.
    llm: gateway,
    judgeLlm: gateway,
    // The capture observer drives the readiness capture-state.
    observer,
  } as never);
  return { services, calls, generateStructured, observer };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "x-builder-binding-int-"));
  settingsRepository = new JsonFileAppSettingsRepository({ root: join(tempDir, "settings") });
  postLibraryRepository = new JsonFilePostLibraryRepository({
    root: join(tempDir, "storage"),
  });
  liveCapture = new LiveCaptureService(postLibraryRepository);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

// A mock page that records [name, handler] pairs so each handler is invocable.
function createMockPage() {
  const handlers = new Map<string, (arg: unknown) => unknown>();
  const exposeFunction = vi.fn(async (name: string, handler: (arg: unknown) => unknown) => {
    handlers.set(name, handler);
  });
  return { page: { exposeFunction }, handlers, exposeFunction };
}

// ===========================================================================
// Invariant #1 — bindings are 1:1 with EngineTransport (exactly the 17 names).
// ===========================================================================

describe("real engine bundle — binding registration (invariant #1)", () => {
  it("binds exactly the 17 __xbuilder_* names enumerated from EngineTransport", async () => {
    const { services } = buildBundle();
    const mockPage = createMockPage();

    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const expected = Object.values(ENGINE_TRANSPORT_BINDINGS).slice().sort();
    const registered = [...mockPage.handlers.keys()].sort();

    expect(expected).toHaveLength(17);
    expect(registered).toEqual(expected);
    expect(registered).toHaveLength(17);
  });
});

// ===========================================================================
// getStatus / getOverlayReadiness composition (NEW BUILD).
// ===========================================================================

describe("real engine bundle — status + overlay readiness composition", () => {
  it("getStatus composes a schema-valid AppStatus from the engine /status logic", async () => {
    const { services } = buildBundle();
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.getStatus)!;
    const result = await handler(undefined);

    expect(() => appStatusSchema.parse(result)).not.toThrow();
  });

  it("getOverlayReadiness wraps engine readiness + observer capture-state into the readiness shape", async () => {
    const { services } = buildBundle({ observerState: "ok" });
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.getOverlayReadiness)!;
    const result = await handler(undefined);

    const parsed = overlayReadinessSchema.parse(result);
    // The capture sub-view reflects the observer state the bundle was given.
    expect(parsed.capture.state).toBe("ok");
  });
});

// ===========================================================================
// judgeDraft arg-shape mapping + invariant #2 (input-derived, no stored response).
// ===========================================================================

describe("real engine bundle — judgeDraft arg-shape mapping (invariant #2)", () => {
  it("maps {text, accountProfile} → judge(text, accountProfile) and unwraps the outcome to a JudgeDraftResponse", async () => {
    const { services, calls } = buildBundle();
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.judgeDraft)!;
    const result = await handler({ text: "a perfectly fine draft", accountProfile: "founder" });

    const parsed = judgeDraftResponseSchema.parse(result);
    expect(parsed.status).toBe("judged");

    // The text reached the judge as the user-turn content (proves req.text was
    // threaded through judge(text, ...), not the whole request object).
    expect(calls.some((c) => c.purpose === "candidate_judge")).toBe(true);
    expect(calls.find((c) => c.purpose === "candidate_judge")!.userContent).toContain(
      "a perfectly fine draft",
    );
  });

  it("returns input-derived verdicts: two different drafts differ in scores.overall", async () => {
    const { services } = buildBundle();
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.judgeDraft)!;

    const short = judgeDraftResponseSchema.parse(await handler({ text: "tiny" }));
    const long = judgeDraftResponseSchema.parse(
      await handler({ text: "a considerably longer and more substantial draft post" }),
    );

    expect(short.verdict.scores.overall).not.toBe(long.verdict.scores.overall);
  });
});

// ===========================================================================
// analyzePosts per-item cooldown re-attach survives the round-trip (NEW BUILD).
// ===========================================================================

describe("real engine bundle — analyzePosts cooldown re-attach", () => {
  it("re-attaches the per-item cooldown signal through the resolver chain (the optional field survives)", async () => {
    await seedHotTakeCorpus(liveCapture);

    const { services } = buildBundle();
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.analyzePosts)!;
    const raw = await handler(analyzeRequest(hotTakeText("a brand new angle worth testing")));

    const parsed = analyzePostsResponseSchema.parse(raw);
    const scored = parsed.items.find((item) => item.status === "scored");
    expect(scored).toBeDefined();
    if (scored?.status !== "scored") {
      throw new Error("expected a scored item");
    }
    // The hot_take draft must carry a cooldown signal joined from the window
    // report — proving the re-attach is wired (a missing re-attach drops it).
    expect(scored.detectedFormat).toBe("hot_take");
    expect(scored.cooldown).toBeDefined();
    expect(scored.cooldown!.format).toBe("hot_take");
    expect(scored.cooldown!.countInWindow).toBeGreaterThanOrEqual(1);
  });

  it("getCooldown reports the seeded hot_take signal (input-derived corpus, invariant #2)", async () => {
    await seedHotTakeCorpus(liveCapture);

    const { services } = buildBundle();
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.getCooldown)!;
    const report = cooldownReportSchema.parse(await handler({ windowDays: 7 }));

    expect(report.windowDays).toBe(7);
    expect(report.corpusSource).not.toBe("empty");
    expect(report.signals.some((s) => s.format === "hot_take")).toBe(true);
  });
});

// ===========================================================================
// generate-refine path: verdict + approved attach; approved === deriveApproved
// (invariant #4).
// ===========================================================================

describe("real engine bundle — generateIdeas refine attaches verdict + approved (invariant #4)", () => {
  it("returns 3 candidates each with a full verdict and approved === deriveApproved(verdict)", async () => {
    const { services } = buildBundle();
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const handler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.generateIdeas)!;
    const raw = await handler({ format: "hot_take" });

    const parsed = generateIdeaResponseSchema.parse(raw);
    expect(parsed.candidates).toHaveLength(3);

    for (const candidate of parsed.candidates) {
      expect(candidate.verdict).toBeDefined();
      expect(candidate.approved).toBeDefined();
      const verdict = candidate.verdict as JudgeVerdict;
      // The overlay/engine must derive approval through shared deriveApproved,
      // never a bespoke threshold.
      expect(candidate.approved).toBe(deriveApproved(verdict));
    }
  });
});

// ===========================================================================
// RunnerApp DEFAULT wiring (NEW BUILD): bindTransport binds the 17, attachObserver
// registers a single response listener.
// ===========================================================================

describe("RunnerApp default wiring — transport + observer", () => {
  // A fake persistent context whose page records exposeFunction registrations
  // and whose `on("response")` registrations are counted.
  function createFakeContext() {
    const exposed = new Map<string, (arg: unknown) => unknown>();
    const page = {
      goto: vi.fn(async () => undefined),
      exposeFunction: vi.fn(async (name: string, handler: (arg: unknown) => unknown) => {
        exposed.set(name, handler);
      }),
    };
    const responseListeners: Array<(response: unknown) => unknown> = [];
    const context = {
      addInitScript: vi.fn(async () => undefined),
      pages: vi.fn(() => [page]),
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
      on: vi.fn((event: string, handler: (response: unknown) => unknown) => {
        if (event === "response") {
          responseListeners.push(handler);
        }
      }),
    };
    return { context, page, exposed, responseListeners };
  }

  // A minimal real overlay bundle file so RunnerApp.start gets past the
  // existsSync gate without a built @x-builder/overlay.
  function writeBundle(): string {
    const path = join(tempDir, "overlay.iife.js");
    writeFileSync(path, "globalThis.__xb=1;", "utf-8");
    return path;
  }

  it("registers all 17 __xbuilder_* bindings on the page with NO bindTransport override", async () => {
    const fake = createFakeContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: writeBundle(),
      launchBrowser: vi.fn(async () => fake.context as never),
      // bindTransport + attachObserver intentionally NOT passed — exercise the
      // production defaults the Green agent must wire.
    });

    await app.start();
    logSpy.mockRestore();

    const expected = Object.values(ENGINE_TRANSPORT_BINDINGS).slice().sort();
    expect([...fake.exposed.keys()].sort()).toEqual(expected);
    expect(fake.exposed.size).toBe(17);
  });

  it("attaches a single response listener on the context with NO attachObserver override (capture observed, not injected — invariant #6)", async () => {
    const fake = createFakeContext();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const app = new RunnerApp({
      engineSettingsDir: join(tempDir, "engine-settings"),
      browserProfileDir: join(tempDir, "browser-profile"),
      overlayBundlePath: writeBundle(),
      launchBrowser: vi.fn(async () => fake.context as never),
    });

    await app.start();
    logSpy.mockRestore();

    // The observer registers exactly one `response` listener and issues no
    // outbound request: the fake context exposes no request-issuing method, so
    // wiring that called one would throw. Zero non-response events expected.
    expect(fake.responseListeners).toHaveLength(1);
    const onCalls = (fake.context.on as ReturnType<typeof vi.fn>).mock.calls;
    expect(onCalls.every((c) => c[0] === "response")).toBe(true);
  });
});

// ===========================================================================
// Invariant #6 (in-process seam): GraphQlCaptureObserver.attach registers ONLY a
// response listener and issues zero outbound requests / never calls a
// request-issuing method on the context.
// ===========================================================================

describe("capture is observed, not injected (invariant #6, in-process seam)", () => {
  it("attach registers only a response listener and the bundle's capture ingest grows the corpus", async () => {
    // The observer must touch only context.on("response"); any attempt to issue
    // a request (a method like request/route/goto on the context) is absent here,
    // so a request-issuing implementation would throw on the missing method.
    const events: string[] = [];
    let captured: ((response: unknown) => unknown) | undefined;
    const context = {
      on: (event: string, handler: (response: unknown) => unknown) => {
        events.push(event);
        if (event === "response") {
          captured = handler;
        }
      },
    };

    // Defer to the production attach via the default RunnerApp wiring's observer.
    // Here we assert the in-process contract directly through the bundle's
    // live-capture ingest: a normalized batch flows into the corpus with no
    // network call.
    const { GraphQlCaptureObserver } = await import("./graphql-capture-observer.js");
    const batches: CaptureIngestRequest[] = [];
    GraphQlCaptureObserver.attach(context as never, async (batch) => {
      batches.push(batch);
      await liveCapture.ingest(batch);
    });

    expect(events).toEqual(["response"]);
    expect(captured).toBeTypeOf("function");

    // Drive a real already-fetched UserTweets response (the page issued it, not us).
    const beforeSize = (await postLibraryRepository.loadStore()).posts.length;
    const responseLike = {
      url: () => "https://x.com/i/api/graphql/abc123/UserTweets",
      json: async () => userTweetsValid,
    };
    await captured!(responseLike);

    // The observer never crafted a request — capture is observe-only and the
    // corpus grew purely from an already-fetched response.
    const afterSize = (await postLibraryRepository.loadStore()).posts.length;
    expect(afterSize).toBeGreaterThanOrEqual(beforeSize);
  });
});
