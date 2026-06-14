import { expect, type Page, type Route } from "@playwright/test";

// The live client shell builds its EngineApiClient against this base URL
// (AppShell's defaultEngineBaseUrl). Every engine call is intercepted here via
// Playwright route fixtures — there is no real engine or CLI in the loop.
export const engineBaseUrl = "http://127.0.0.1:4173";

export const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "content-type": "application/json",
} as const;

export type SlotState = "ready" | "unavailable";

export type ReadinessState =
  | "checking"
  | "ready"
  | "partial"
  | "unavailable"
  | "failed"
  | "stale"
  | "disabled"
  | "unconfigured";

// Mirrors @x-builder/shared judgeProviderLabels. The catalog is the single
// source of truth for the SELECT options + the verdict-attribution mapping; the
// status badge, by contrast, renders the server-supplied llm.label verbatim.
export const judgeProviderLabels: Record<string, string> = {
  "codex-cli": "Codex judge",
  "claude-cli": "Claude judge",
  "cursor-cli": "Cursor judge",
};

export type EngineStubOptions = {
  // The provider id persisted in settings (drives the SELECT value).
  selectedProvider?: string;
  // Readiness of the selected judge slot. The status badge + judge gating both
  // derive from this single carrier (status.llm.state / status.llm.label).
  slotState?: SlotState;
  // The server-authored label for the judge slot (status.llm.label). Defaults to
  // the catalog label for the selected provider, but can be any string — the
  // status path performs no client-side provider-name mapping.
  slotLabel?: string;
  // Message surfaced alongside an unavailable slot.
  slotMessage?: string;
  // The model id the judge response is attributed to. Defaults to the selected
  // provider id so "Judged by {label}" resolves through the catalog.
  judgeModel?: string;
  checkedAt?: string;
  // Per-route hooks for specs that need to count requests, fail a route, or
  // sequence responses across retries. These replace bespoke per-spec stubs.
  onStatus?: (route: Route) => Promise<void> | void;
  onSettings?: (route: Route) => Promise<void> | void;
  onJudge?: (route: Route) => Promise<void> | void;
  onGenerate?: (route: Route) => Promise<void> | void;
  onAnalyze?: (route: Route) => Promise<void> | void;
};

export type ResolvedEngineStub = Required<
  Pick<
    EngineStubOptions,
    "selectedProvider" | "slotState" | "slotLabel" | "judgeModel" | "checkedAt"
  >
> & {
  slotMessage?: string;
};

const defaultCheckedAt = "2026-06-08T08:00:00.000Z";

function catalogLabel(providerId: string): string {
  return judgeProviderLabels[providerId] ?? providerId;
}

export function resolveEngineStub(
  options: EngineStubOptions = {},
): ResolvedEngineStub {
  const selectedProvider = options.selectedProvider ?? "codex-cli";
  const slotState = options.slotState ?? "ready";

  return {
    checkedAt: options.checkedAt ?? defaultCheckedAt,
    judgeModel: options.judgeModel ?? selectedProvider,
    selectedProvider,
    slotLabel: options.slotLabel ?? catalogLabel(selectedProvider),
    slotMessage: options.slotMessage,
    slotState,
  };
}

function subsystem(
  label: string,
  state: ReadinessState,
  checkedAt: string,
  message?: string,
) {
  return {
    checkedAt,
    details: {},
    label,
    ...(message === undefined ? {} : { message }),
    retryable: state !== "ready",
    state,
  };
}

// Schema-shaped to the real /status contract (appStatusSchema). The judge slot
// (llm) carries the server label + state; engine/deterministic/storage stay
// ready so that only judge readiness varies across flows.
export function statusBody(options: EngineStubOptions = {}) {
  const resolved = resolveEngineStub(options);
  const { checkedAt, slotLabel, slotMessage, slotState } = resolved;

  return {
    deterministic: subsystem("Deterministic scorer", "ready", checkedAt),
    engine: subsystem("Engine", "ready", checkedAt),
    generatedAt: checkedAt,
    lastRun: { state: "none" },
    llm: subsystem(
      slotLabel,
      slotState,
      checkedAt,
      slotState === "ready" ? undefined : slotMessage,
    ),
    overall: slotState === "ready" ? "ready" : "partial",
    storage: subsystem("Storage", "ready", checkedAt),
    version: "e2e",
  };
}

// Schema-shaped to the real /settings contract (appSettingsResponseSchema). The
// model fields always round-trip; the live settings form renders all three
// model inputs regardless, so their presence is behavior-neutral for the form.
export function settingsBody(options: EngineStubOptions = {}) {
  const resolved = resolveEngineStub(options);

  return {
    settings: {
      claudeModel: "",
      codexModel: "",
      cursorModel: "",
      engineBaseUrl,
      judgeProvider: resolved.selectedProvider,
      showDeterministicDetails: true,
      storagePath: "~/.x-builder/e2e",
    },
    source: "defaults" as const,
  };
}

// Schema-shaped to the real judgeVerdictSchema (judge.ts): the producer emits all
// thirteen dimensions. The four behavioral dimensions are required; audienceMatch
// is required on the wire but nullable (an explicit number when an account profile
// anchors audience fit, null otherwise).
export type JudgeVerdict = {
  verdict: "post_now" | "slight_rework" | "major_rework" | "do_not_post";
  confidence: "low" | "medium" | "high";
  scores: {
    overall: number;
    replies: number;
    profileClicks: number;
    impressions: number;
    bookmarkValue: number;
    dwellProxy: number;
    voiceMatch: number;
    negativeRisk: number;
    answerEffort: number;
    strangerAnswerability: number;
    statusDependency: number;
    replyVsQuoteOrientation: number;
    audienceMatch: number | null;
  };
  headline: string;
  strengths: string[];
  improvements: string[];
};

export const sampleVerdict: JudgeVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores: {
    overall: 78,
    replies: 80,
    profileClicks: 72,
    impressions: 65,
    bookmarkValue: 60,
    dwellProxy: 70,
    voiceMatch: 85,
    negativeRisk: 10,
    answerEffort: 55,
    strangerAnswerability: 48,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: 41,
  },
  headline: "Strong hook, weak closer.",
  strengths: [
    "Opens with a concrete claim",
    "Ends on a reply-friendly question",
  ],
  improvements: ["Trim the middle paragraph", "Cut one hedge word"],
};

// Schema-shaped to the real /drafts/judge contract (judgeDraftResponseSchema).
export function judgeBody(
  options: EngineStubOptions = {},
  verdict: JudgeVerdict = sampleVerdict,
) {
  const resolved = resolveEngineStub(options);

  return {
    judgedAt: resolved.checkedAt,
    model: resolved.judgeModel,
    status: "judged" as const,
    verdict,
  };
}

export async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: corsHeaders,
    status,
  });
}

export async function fulfillPreflight(route: Route) {
  await route.fulfill({ headers: corsHeaders, status: 204 });
}

export function requestJson(route: Route): unknown {
  const postData = route.request().postData();

  if (postData === null) {
    throw new Error(`Expected JSON request body for ${route.request().url()}.`);
  }

  return JSON.parse(postData);
}

export type CapturedEngineRequests = {
  analyze: number;
  generate: number;
  judge: number;
  settings: number;
  status: number;
};

// The single parameterized engine-stub builder. It wires /status, /settings,
// /drafts/judge (plus /ideas/generate + /posts/analyze) from one
// { selectedProvider, slotState, slotLabel, judgeModel } description, replacing
// the per-spec literal payloads. Per-route hooks let a spec fail/sequence/count
// a route without re-declaring the others.
export async function stubEngine(
  page: Page,
  options: EngineStubOptions = {},
): Promise<CapturedEngineRequests> {
  const captured: CapturedEngineRequests = {
    analyze: 0,
    generate: 0,
    judge: 0,
    settings: 0,
    status: 0,
  };

  await page.route(`${engineBaseUrl}/status`, async (route) => {
    captured.status += 1;

    if (options.onStatus !== undefined) {
      await options.onStatus(route);
      return;
    }

    await fulfillJson(route, 200, statusBody(options));
  });

  await page.route(`${engineBaseUrl}/settings`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    captured.settings += 1;

    if (options.onSettings !== undefined) {
      await options.onSettings(route);
      return;
    }

    await fulfillJson(route, 200, settingsBody(options));
  });

  await page.route(`${engineBaseUrl}/ideas/generate`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    captured.generate += 1;

    if (options.onGenerate !== undefined) {
      await options.onGenerate(route);
      return;
    }

    await fulfillJson(route, 503, {
      code: "engine_unreachable",
      message: "The local engine could not be reached. Try again.",
      retryable: true,
      scope: "app",
      status: 503,
    });
  });

  await page.route(`${engineBaseUrl}/posts/analyze`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    captured.analyze += 1;

    if (options.onAnalyze !== undefined) {
      await options.onAnalyze(route);
      return;
    }

    await fulfillJson(route, 503, {
      code: "deterministic_analysis_failed",
      message: "Deterministic scoring is temporarily unavailable.",
      retryable: true,
      scope: "deterministic",
      status: 503,
    });
  });

  await page.route(`${engineBaseUrl}/drafts/judge`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    captured.judge += 1;

    if (options.onJudge !== undefined) {
      await options.onJudge(route);
      return;
    }

    await fulfillJson(route, 200, judgeBody(options));
  });

  return captured;
}

// Maps a provider id to the badge text the status bar renders ("{label} ready"
// / "{label} unavailable"), so flow assertions read the same way the shell does.
export function statusBadgeText(label: string, slotState: SlotState): string {
  return `${label} ${slotState}`;
}

export function expectCatalogLabel(providerId: string): string {
  return catalogLabel(providerId);
}
