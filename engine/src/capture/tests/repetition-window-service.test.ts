import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cooldownReportSchema,
  type CooldownReport,
  type CooldownSignal,
  type RepeatHistoryEntry,
} from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyPostFormat } from "../../deterministic/format-classifier";
import {
  JsonFilePostLibraryRepository,
  type CanonicalOwnPostInput,
} from "../../server/post-library-repository";
// Imported from the not-yet-existing module under test: this import alone makes the
// suite RED until Green creates ../repetition-window-service.
import { RepetitionWindowService } from "../repetition-window-service";

// ---------------------------------------------------------------------------
// Deterministic clock. The window cutoff is now() - windowDays * 86_400_000.
// Every fixture's createdAt is expressed relative to this fixed instant so the
// in/out-of-window partition is exact and timezone-free.
// ---------------------------------------------------------------------------
const FIXED_NOW_ISO = "2026-06-20T12:00:00.000Z";
const fixedNow = (): Date => new Date(FIXED_NOW_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDaysAgo = (days: number): string =>
  new Date(new Date(FIXED_NOW_ISO).getTime() - days * DAY_MS).toISOString();

// ---------------------------------------------------------------------------
// Fixture text strings whose classification was verified against the real
// classifier (engine/src/deterministic/format-classifier.ts) before authoring:
//   - hot_take      : "Hot take:" / "Unpopular opinion:" / ... prefix (rule 1).
//   - founder_story : 3+ lines, first person, founder stake, reversal word,
//                     and a hard-proof token ($amount / "first paid customer") (rule 10).
//   - story         : 3+ first-person lines that match nothing stronger (rule 12).
//   - other         : whitespace-only text trims to "" -> "other" (early return).
// A guard test below re-asserts each of these classifies as intended, so the
// window-count assertions cannot silently drift if the classifier changes.
// ---------------------------------------------------------------------------
const HOT_TAKE_TEXTS = [
  "Hot take: shipping fast beats shipping perfect every single time.",
  "Unpopular opinion: most startup advice is survivorship bias dressed up as wisdom.",
  "Real talk: your landing page does not need another testimonial section.",
  "Popular opinion: writing tests first actually saves you time later on.",
  "Hot take: meetings that could be emails are quietly killing your team.",
] as const;

const FOUNDER_STORY_TEXTS = [
  "I quit my job to start a company.\nFor months we had zero revenue and almost no runway.\nBut then we landed our first paid customer and closed $5,000 in sales.",
  "We launched our product to total silence.\nOur startup burned through most of its funding fast.\nThen everything turned out fine: we signed our first deal worth $12k.",
] as const;

const STORY_TEXTS = [
  "I woke up early today.\nI walked to the corner cafe near my place.\nI ordered the same coffee I always get.",
  "I went for a long walk this morning.\nI thought about nothing in particular.\nI came back home feeling calm.",
] as const;

// Whitespace-only: still satisfies the store schema's text min length (1) at
// length 3, but trims to empty so the classifier returns "other".
const OTHER_TEXT = "   ";

const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let idCounter = 0;

// Build a canonical post input with a controlled createdAt and an archive
// snapshot by default. Each call gets a unique id + platformPostId so posts
// never collide on the repository's platform key.
const archivePost = (
  text: string,
  createdAt: string,
  overrides: Partial<CanonicalOwnPostInput> = {},
): CanonicalOwnPostInput => {
  idCounter += 1;
  const platformPostId = `180000000000000${String(idCounter).padStart(4, "0")}`;

  return {
    id: `post-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: { favoriteCount: 3, retweetCount: 1 },
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: createdAt,
        importedAt: FIXED_NOW_ISO,
        favoriteCount: 3,
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

// Build a post carrying an x_live_capture snapshot/ref (a true discriminated
// union arm) for live / merged corpus-source cases.
const livePost = (
  text: string,
  createdAt: string,
  overrides: Partial<CanonicalOwnPostInput> = {},
): CanonicalOwnPostInput => {
  idCounter += 1;
  const platformPostId = `190000000000000${String(idCounter).padStart(4, "0")}`;

  return {
    id: `post-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "x_live_capture",
        capturedAt: FIXED_NOW_ISO,
        impressions: 1200,
        likes: 9,
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

// ---------------------------------------------------------------------------
// Per-test isolation: fresh mkdtemp root + real repository instance, deterministic clock.
// ---------------------------------------------------------------------------
let root: string;
let repository: JsonFilePostLibraryRepository;
let service: RepetitionWindowService;

beforeEach(async () => {
  idCounter = 0;
  root = await mkdtemp(join(tmpdir(), "x-builder-repetition-window-"));
  repository = new JsonFilePostLibraryRepository({ root });
  service = new RepetitionWindowService(repository, fixedNow);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("RepetitionWindowService fixture classification guard", () => {
  // Pins the fixture-to-format mapping the window-count assertions depend on.
  it("classifies each fixture text to its intended detected format", () => {
    for (const text of HOT_TAKE_TEXTS) {
      expect(classifyPostFormat(text)).toBe("hot_take");
    }
    for (const text of FOUNDER_STORY_TEXTS) {
      expect(classifyPostFormat(text)).toBe("founder_story");
    }
    for (const text of STORY_TEXTS) {
      expect(classifyPostFormat(text)).toBe("story");
    }
    expect(classifyPostFormat(OTHER_TEXT)).toBe("other");
  });
});

describe("RepetitionWindowService.compute", () => {
  // Coverage 1 + AC: 4 hot_take in-window + 1 hot_take 30d ago -> one signal,
  // countInWindow 4, status cooldown; the old post is not counted.
  it("counts four in-window hot_take posts as a cooldown signal and excludes a 30-day-old post", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1)),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2)),
      archivePost(HOT_TAKE_TEXTS[2], isoDaysAgo(3)),
      archivePost(HOT_TAKE_TEXTS[3], isoDaysAgo(6)),
      archivePost(HOT_TAKE_TEXTS[4], isoDaysAgo(30)),
    ]);

    const report = await service.compute(7);

    expect(cooldownReportSchema.safeParse(report).success).toBe(true);
    expect(report.windowDays).toBe(7);
    expect(report.signals).toHaveLength(1);

    const signal = report.signals[0];
    expect(signal?.format).toBe("hot_take");
    expect(signal?.countInWindow).toBe(4);
    expect(signal?.status).toBe("cooldown");
    expect(signal?.windowDays).toBe(7);
    // lastPostedAt is the most-recent createdAt across ALL hot_take posts (in-window 1d wins over 30d).
    expect(signal?.lastPostedAt).toBe(isoDaysAgo(1));
    // Message references the count and the window length, within the 240-char bound.
    expect(signal?.message).toContain("4");
    expect(signal?.message).toContain("7");
    expect((signal?.message.length ?? 0)).toBeLessThanOrEqual(240);
  });

  // Coverage 2: 2 founder_story in-window -> warming.
  it("reports a warming signal for exactly two in-window founder_story posts", async () => {
    await repository.upsertPosts([
      archivePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(1)),
      archivePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(4)),
    ]);

    const report = await service.compute(7);

    expect(report.signals).toHaveLength(1);
    const signal = report.signals[0];
    expect(signal?.format).toBe("founder_story");
    expect(signal?.countInWindow).toBe(2);
    expect(signal?.status).toBe("warming");
  });

  // Coverage 3: 1 story in-window -> clear.
  it("reports a clear signal for a single in-window story post", async () => {
    await repository.upsertPosts([archivePost(STORY_TEXTS[0], isoDaysAgo(2))]);

    const report = await service.compute(7);

    expect(report.signals).toHaveLength(1);
    const signal = report.signals[0];
    expect(signal?.format).toBe("story");
    expect(signal?.countInWindow).toBe(1);
    expect(signal?.status).toBe("clear");
  });

  // Coverage 4 + AC: empty corpus -> corpusSource empty, no signals, no throw.
  it("returns an empty report for an empty corpus without throwing", async () => {
    const report = await service.compute(7);

    expect(report.corpusSource).toBe("empty");
    expect(report.signals).toEqual([]);
    expect(report.windowDays).toBe(7);
    expect(cooldownReportSchema.safeParse(report).success).toBe(true);
  });

  // Coverage 5 + AC: reply / repost_reference kind posts excluded from window counts.
  it("excludes reply and repost_reference kind posts from window counts even when recent", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1), { kind: "reply" }),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2), { kind: "repost_reference" }),
      archivePost(HOT_TAKE_TEXTS[2], isoDaysAgo(3), { kind: "original" }),
    ]);

    const report = await service.compute(7);

    expect(report.signals).toHaveLength(1);
    const signal = report.signals[0];
    expect(signal?.format).toBe("hot_take");
    // Only the single original counts; the recent reply + repost_reference are dropped.
    expect(signal?.countInWindow).toBe(1);
    expect(signal?.status).toBe("clear");
  });

  // AC: a corpus of only reply-kind posts -> no signals.
  it("emits no signals when every post is a reply even if recent", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1), { kind: "reply" }),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2), { kind: "reply" }),
    ]);

    const report = await service.compute(7);

    expect(report.signals).toEqual([]);
  });

  // Coverage 6 + Edge: "other" format posts excluded from signals even if in-window.
  it("excludes the other format from signals even when those posts are in-window", async () => {
    await repository.upsertPosts([
      archivePost(OTHER_TEXT, isoDaysAgo(1)),
      archivePost(OTHER_TEXT, isoDaysAgo(2)),
      archivePost(STORY_TEXTS[0], isoDaysAgo(3)),
    ]);

    const report = await service.compute(7);

    // Only the story signal survives; "other" posts produce no signal.
    expect(report.signals).toHaveLength(1);
    expect(report.signals[0]?.format).toBe("story");
    expect(report.signals.some((signal: CooldownSignal) => signal.format === "other")).toBe(false);
  });

  // Edge: corpus of only "other" -> no signals.
  it("emits no signals for a corpus that classifies entirely as other", async () => {
    await repository.upsertPosts([
      archivePost(OTHER_TEXT, isoDaysAgo(1)),
      archivePost(OTHER_TEXT, isoDaysAgo(2)),
    ]);

    const report = await service.compute(7);

    expect(report.signals).toEqual([]);
  });

  // Edge: window boundary is inclusive (>= windowCutoff). A post created exactly
  // windowDays ago sits on the cutoff and must be counted.
  it("counts a post sitting exactly on the inclusive window boundary", async () => {
    await repository.upsertPosts([archivePost(STORY_TEXTS[0], isoDaysAgo(7))]);

    const report = await service.compute(7);

    expect(report.signals).toHaveLength(1);
    expect(report.signals[0]?.format).toBe("story");
    expect(report.signals[0]?.countInWindow).toBe(1);
  });

  // Edge: a format that appears only outside the window -> no signal (no count 0 signals).
  it("emits no signal for a format that appears only outside the window", async () => {
    await repository.upsertPosts([archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(20))]);

    const report = await service.compute(7);

    expect(report.signals).toEqual([]);
  });

  // Edge: lastPostedAt reflects the most recent post of a format across ALL posts,
  // even when the most recent is outside the window. Two in-window + one newer-but-
  // out-of-window would be contradictory; instead use an older in-window pair and
  // confirm lastPostedAt picks the newest in the format set.
  it("sets lastPostedAt to the newest createdAt across all posts of the format", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(5)),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(1)),
    ]);

    const report = await service.compute(7);

    expect(report.signals).toHaveLength(1);
    expect(report.signals[0]?.lastPostedAt).toBe(isoDaysAgo(1));
  });

  // Signals are sorted descending by countInWindow.
  it("sorts signals in descending order of countInWindow", async () => {
    await repository.upsertPosts([
      // 1 story
      archivePost(STORY_TEXTS[0], isoDaysAgo(1)),
      // 3 hot_take
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1)),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2)),
      archivePost(HOT_TAKE_TEXTS[2], isoDaysAgo(3)),
      // 2 founder_story
      archivePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(1)),
      archivePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(2)),
    ]);

    const report = await service.compute(7);

    expect(report.signals.map((signal: CooldownSignal) => signal.format)).toEqual([
      "hot_take",
      "founder_story",
      "story",
    ]);
    expect(report.signals.map((signal: CooldownSignal) => signal.countInWindow)).toEqual([
      3, 2, 1,
    ]);
  });

  // corpusSource: archive only.
  it("reports corpusSource archive when every post carries only archive snapshots", async () => {
    await repository.upsertPosts([
      archivePost(STORY_TEXTS[0], isoDaysAgo(1)),
      archivePost(STORY_TEXTS[1], isoDaysAgo(2)),
    ]);

    const report = await service.compute(7);

    expect(report.corpusSource).toBe("archive");
  });

  // corpusSource: live only.
  it("reports corpusSource live when every post carries only live snapshots", async () => {
    await repository.upsertPosts([
      livePost(STORY_TEXTS[0], isoDaysAgo(1)),
      livePost(STORY_TEXTS[1], isoDaysAgo(2)),
    ]);

    const report = await service.compute(7);

    expect(report.corpusSource).toBe("live");
  });

  // Coverage 8: mixed archive + live corpus -> merged.
  it("reports corpusSource merged for a mixed archive-and-live corpus", async () => {
    await repository.upsertPosts([
      archivePost(STORY_TEXTS[0], isoDaysAgo(1)),
      livePost(STORY_TEXTS[1], isoDaysAgo(2)),
    ]);

    const report = await service.compute(7);

    expect(report.corpusSource).toBe("merged");
  });
});

describe("RepetitionWindowService.asRepeatHistory", () => {
  // Coverage 7 + AC: maps a two-signal report to two RepeatHistoryEntry values
  // with the correct format / countLast7d / lastPostedAt.
  it("maps each signal to a repeat-history entry with matching count, format, and lastPostedAt", () => {
    const report: CooldownReport = {
      windowDays: 7,
      generatedAt: FIXED_NOW_ISO,
      corpusSource: "archive",
      signals: [
        {
          format: "hot_take",
          countInWindow: 4,
          windowDays: 7,
          lastPostedAt: isoDaysAgo(1),
          status: "cooldown",
          message: "4 hot_take posts in the last 7 days.",
        },
        {
          format: "founder_story",
          countInWindow: 2,
          windowDays: 7,
          lastPostedAt: isoDaysAgo(3),
          status: "warming",
          message: "2 founder_story posts in the last 7 days.",
        },
      ],
    };

    const history = service.asRepeatHistory(report);

    expect(history).toHaveLength(2);
    expect(history).toEqual<RepeatHistoryEntry[]>([
      { format: "hot_take", lastPostedAt: isoDaysAgo(1), countLast7d: 4 },
      { format: "founder_story", lastPostedAt: isoDaysAgo(3), countLast7d: 2 },
    ]);
  });

  // Empty report -> empty history (no throw).
  it("returns an empty history for a report with no signals", () => {
    const report: CooldownReport = {
      windowDays: 7,
      generatedAt: FIXED_NOW_ISO,
      corpusSource: "empty",
      signals: [],
    };

    expect(service.asRepeatHistory(report)).toEqual([]);
  });

  // lastPostedAt fallback: when a signal omits lastPostedAt, the entry still gets a
  // datetime (now fallback). We assert the entry is a valid datetime string, not a
  // specific value, since the fallback is the service's injected now.
  it("falls back to a datetime for lastPostedAt when a signal omits it", () => {
    const report: CooldownReport = {
      windowDays: 7,
      generatedAt: FIXED_NOW_ISO,
      corpusSource: "archive",
      signals: [
        {
          format: "story",
          countInWindow: 1,
          windowDays: 7,
          status: "clear",
          message: "1 story post in the last 7 days.",
        },
      ],
    };

    const history = service.asRepeatHistory(report);

    expect(history).toHaveLength(1);
    expect(history[0]?.format).toBe("story");
    expect(history[0]?.countLast7d).toBe(1);
    expect(typeof history[0]?.lastPostedAt).toBe("string");
    expect(Number.isNaN(Date.parse(history[0]?.lastPostedAt ?? ""))).toBe(false);
  });
});
