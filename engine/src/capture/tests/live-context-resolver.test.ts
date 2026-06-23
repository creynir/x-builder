import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AnalyzePostsRequest,
  type RepeatHistoryEntry,
} from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyPostFormat } from "../../deterministic/format-classifier";
import {
  JsonFilePostLibraryRepository,
  type CanonicalOwnPostInput,
} from "../../server/post-library-repository";
import { RepetitionWindowService } from "../repetition-window-service";
// Imported from the not-yet-existing module under test: this import alone keeps
// the suite RED until Green creates ../live-context-resolver.
import { LiveContextResolver } from "../live-context-resolver";

// ---------------------------------------------------------------------------
// Deterministic clock. RepetitionWindowService's window cutoff is
// now() - windowDays * 86_400_000, so every fixture createdAt is expressed
// relative to this fixed instant for an exact, timezone-free partition.
// ---------------------------------------------------------------------------
const FIXED_NOW_ISO = "2026-06-20T12:00:00.000Z";
const fixedNow = (): Date => new Date(FIXED_NOW_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDaysAgo = (days: number): string =>
  new Date(new Date(FIXED_NOW_ISO).getTime() - days * DAY_MS).toISOString();

// ---------------------------------------------------------------------------
// Fixture text strings. Their classification is pinned by the guard test below
// so the repeatHistory assertion cannot silently drift if the classifier moves.
//   - hot_take : "Hot take:" / "Unpopular opinion:" / ... prefix (rule 1).
//   - plain    : single-line statement with no question -> wisdom_one_liner
//                (used as median-only filler where format does not matter).
// ---------------------------------------------------------------------------
const HOT_TAKE_TEXTS = [
  "Hot take: shipping fast beats shipping perfect every single time.",
  "Unpopular opinion: most startup advice is survivorship bias dressed up as wisdom.",
  "Real talk: your landing page does not need another testimonial section.",
] as const;

const FILLER_TEXT =
  "Shipping notes for the week ahead and a few small reminders for the team folks.";

const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let idCounter = 0;

// An original post carrying a single x_live_capture snapshot with a controlled
// impressions value and createdAt. The default text is format-neutral filler so
// median fixtures do not accidentally seed repeatHistory signals.
const liveImpressionPost = (
  impressions: number | undefined,
  createdAt: string,
  overrides: Partial<CanonicalOwnPostInput> = {},
): CanonicalOwnPostInput => {
  idCounter += 1;
  const platformPostId = `190000000000000${String(idCounter).padStart(4, "0")}`;

  return {
    id: `live-${idCounter}`,
    platform: "x",
    platformPostId,
    text: FILLER_TEXT,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "x_live_capture",
        capturedAt: createdAt,
        ...(impressions === undefined ? {} : { impressions }),
        likes: 4,
      },
    ],
    sourceRefs: [
      {
        source: "x_live_capture",
        captureSessionId: "session-1",
        rawId: platformPostId,
      },
    ],
    ...overrides,
  };
};

// An original post carrying an archive snapshot only (no live impressions). Used
// to drive the RepetitionWindowService for repeatHistory cases.
const archivePost = (
  text: string,
  createdAt: string,
  overrides: Partial<CanonicalOwnPostInput> = {},
): CanonicalOwnPostInput => {
  idCounter += 1;
  const platformPostId = `180000000000000${String(idCounter).padStart(4, "0")}`;

  return {
    id: `arch-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: { favoriteCount: 2, retweetCount: 1 },
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: createdAt,
        importedAt: FIXED_NOW_ISO,
        favoriteCount: 2,
        retweetCount: 1,
      },
    ],
    sourceRefs: [
      {
        source: "archive_tweets_js",
        importRunId: "import-1",
        rawId: platformPostId,
        sourceHash:
          "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd",
      },
    ],
    ...overrides,
  };
};

const requestWith = (
  scoringContext: AnalyzePostsRequest["scoringContext"] = {},
): AnalyzePostsRequest => ({
  items: [
    {
      id: "candidate-1",
      text: "genuine question: why do agent handoffs fail when context is hidden?",
      sourceFormat: "debate-question",
    },
  ],
  scoringContext,
  presentation: { postCoachMode: "preview" },
});

// ---------------------------------------------------------------------------
// Per-test isolation: fresh mkdtemp root + real repository, deterministic clock.
// ---------------------------------------------------------------------------
let root: string;
let repository: JsonFilePostLibraryRepository;
let windowService: RepetitionWindowService;
let resolver: LiveContextResolver;

beforeEach(async () => {
  idCounter = 0;
  root = await mkdtemp(join(tmpdir(), "x-builder-live-context-"));
  repository = new JsonFilePostLibraryRepository({ root });
  windowService = new RepetitionWindowService(repository, fixedNow);
  resolver = new LiveContextResolver(repository, windowService);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LiveContextResolver fixture classification guard", () => {
  it("classifies each fixture text to its intended detected format", () => {
    for (const text of HOT_TAKE_TEXTS) {
      expect(classifyPostFormat(text)).toBe("hot_take");
    }
    // Filler must NOT classify as hot_take, or it would pollute repeatHistory in
    // the median-only cases.
    expect(classifyPostFormat(FILLER_TEXT)).not.toBe("hot_take");
  });
});

describe("LiveContextResolver.mergeAnalysisRequest — followers", () => {
  it("patches followers from the most recent profile snapshot when the request omits it", async () => {
    // Two snapshots; the most recent by capturedAt wins.
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 8000,
      capturedAt: isoDaysAgo(10),
    });
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 12000,
      capturedAt: isoDaysAgo(1),
    });

    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.followers).toBe(12000);
  });

  it("leaves followers untouched when the request already supplies it", async () => {
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 12000,
      capturedAt: isoDaysAgo(1),
    });

    const merged = await resolver.mergeAnalysisRequest(
      requestWith({ followers: 5000 }),
    );

    expect(merged.scoringContext.followers).toBe(5000);
  });

  it("does not patch followers when no profile snapshot is present", async () => {
    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.followers).toBeUndefined();
  });
});

describe("LiveContextResolver.mergeAnalysisRequest — trailingMedianImpressions", () => {
  it("computes the integer median of five live-impression originals", async () => {
    // [100, 200, 300, 400, 500] -> median 300 (the middle element).
    await repository.upsertPosts([
      liveImpressionPost(100, isoDaysAgo(5)),
      liveImpressionPost(200, isoDaysAgo(4)),
      liveImpressionPost(300, isoDaysAgo(3)),
      liveImpressionPost(400, isoDaysAgo(2)),
      liveImpressionPost(500, isoDaysAgo(1)),
    ]);

    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.trailingMedianImpressions).toBe(300);
  });

  it("returns the single value as the median when only one live impression exists", async () => {
    await repository.upsertPosts([liveImpressionPost(777, isoDaysAgo(2))]);

    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.trailingMedianImpressions).toBe(777);
  });

  it("uses the lower of the two middle values (floored) for an even count", async () => {
    // [100, 200, 300, 400] -> two middle values 200 and 300 -> lower-middle 200.
    await repository.upsertPosts([
      liveImpressionPost(100, isoDaysAgo(4)),
      liveImpressionPost(200, isoDaysAgo(3)),
      liveImpressionPost(300, isoDaysAgo(2)),
      liveImpressionPost(400, isoDaysAgo(1)),
    ]);

    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.trailingMedianImpressions).toBe(200);
  });

  it("does not patch trailingMedianImpressions when no live impressions exist", async () => {
    // Archive-only originals carry no x_live_capture impressions.
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(2)),
    ]);

    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.trailingMedianImpressions).toBeUndefined();
  });

  it("leaves trailingMedianImpressions untouched when the request already supplies it", async () => {
    await repository.upsertPosts([
      liveImpressionPost(100, isoDaysAgo(2)),
      liveImpressionPost(900, isoDaysAgo(1)),
    ]);

    const merged = await resolver.mergeAnalysisRequest(
      requestWith({ trailingMedianImpressions: 4242 }),
    );

    expect(merged.scoringContext.trailingMedianImpressions).toBe(4242);
  });
});

describe("LiveContextResolver.mergeAnalysisRequest — repeatHistory", () => {
  it("patches repeatHistory from the window service when the request omits it", async () => {
    // Two in-window hot_take originals -> a non-empty repeat history.
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1)),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2)),
    ]);

    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.repeatHistory).toBeDefined();
    const repeatHistory = merged.scoringContext.repeatHistory ?? [];
    expect(repeatHistory.length).toBeGreaterThanOrEqual(1);

    const hotTakeEntry = repeatHistory.find(
      (entry: RepeatHistoryEntry) => entry.format === "hot_take",
    );
    expect(hotTakeEntry).toBeDefined();
    expect(hotTakeEntry?.countLast7d).toBe(2);
  });

  it("does not patch repeatHistory when the window service has no signals", async () => {
    // No originals at all -> empty report -> empty repeat history -> no patch.
    const merged = await resolver.mergeAnalysisRequest(requestWith({}));

    expect(merged.scoringContext.repeatHistory).toBeUndefined();
  });

  it("leaves repeatHistory untouched when the request already supplies it", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1)),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2)),
    ]);

    const supplied = [
      {
        format: "story" as const,
        lastPostedAt: isoDaysAgo(3),
        countLast7d: 1,
      },
    ];

    const merged = await resolver.mergeAnalysisRequest(
      requestWith({ repeatHistory: supplied }),
    );

    expect(merged.scoringContext.repeatHistory).toEqual(supplied);
  });
});

describe("LiveContextResolver.mergeAnalysisRequest — composition", () => {
  it("preserves unrelated scoringContext fields and the request items", async () => {
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 12000,
      capturedAt: isoDaysAgo(1),
    });

    const request = requestWith({ plannedHourUtc: 9, willAttachMedia: true });
    const merged = await resolver.mergeAnalysisRequest(request);

    expect(merged.items).toEqual(request.items);
    expect(merged.scoringContext.plannedHourUtc).toBe(9);
    expect(merged.scoringContext.willAttachMedia).toBe(true);
    expect(merged.scoringContext.followers).toBe(12000);
  });
});
