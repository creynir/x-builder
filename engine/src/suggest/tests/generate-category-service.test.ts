import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiErrorSchema,
  type ExternalXSignalPattern,
  generateCategorySchema,
  type GenerateCategory,
} from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyPostFormat } from "../../deterministic/format-classifier";
import { RepetitionWindowService } from "../../capture/repetition-window-service";
import {
  PostLibraryStorageError,
  type CanonicalOwnPostInput,
  type PostLibraryRepository,
} from "../../server/post-library-repository";
import { SqlitePostLibraryRepository } from "../../server/sqlite-post-library-repository";
import { openEngineDatabase } from "../../server/open-engine-database";
import { buildServer } from "../../server/server";
import { SqliteExternalXSignalsRepository } from "../../external/sqlite-external-x-signals-repository";
// Imported from the not-yet-existing module under test: this import alone makes the
// suite RED until Green creates ../generate-category-service.
import { GenerateCategoryService } from "../generate-category-service";

// ---------------------------------------------------------------------------
// Deterministic clock. Cooldown is computed by RepetitionWindowService over a
// 7-day window: now() - 7 * 86_400_000. Every fixture's createdAt is expressed
// relative to this fixed instant so the in/out-of-window partition is exact.
// ---------------------------------------------------------------------------
const FIXED_NOW_ISO = "2026-06-20T12:00:00.000Z";
const fixedNow = (): Date => new Date(FIXED_NOW_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDaysAgo = (days: number): string =>
  new Date(new Date(FIXED_NOW_ISO).getTime() - days * DAY_MS).toISOString();

// ---------------------------------------------------------------------------
// Fixture text strings whose classification was verified against the real
// classifier (engine/src/deterministic/format-classifier.ts) before authoring:
//   - hot_take          : "Hot take:" / "Unpopular opinion:" / "Real talk:" /
//                         "Popular opinion:" prefix (rule 1).
//   - founder_story     : 3+ lines, first person, founder stake, reversal word,
//                         and a hard-proof token ($amount / "first paid customer") (rule 10).
//   - audience_question : tribe vocative ("Founders," / "Builders," / "Creators,")
//                         + a question (rule 7).
//   - story             : 3+ first-person lines that match nothing stronger (rule 12).
//   - other             : whitespace-only text trims to "" -> "other" (early return).
// A guard test below re-asserts each of these classifies as intended so the
// ranking assertions cannot silently drift if the classifier changes.
// ---------------------------------------------------------------------------
const HOT_TAKE_TEXTS = [
  "Hot take: shipping fast beats shipping perfect every single time.",
  "Unpopular opinion: most startup advice is survivorship bias dressed up as wisdom.",
  "Real talk: your landing page does not need another testimonial section.",
  "Popular opinion: writing tests first actually saves you time later on.",
  "Hot take: meetings that could be emails are quietly killing your team.",
  "Hot take: cold outreach still beats every clever growth hack out there.",
  "Unpopular opinion: most dashboards are vanity metrics nobody ever acts on.",
  "Real talk: hiring too early kills more startups than hiring too late.",
] as const;

const FOUNDER_STORY_TEXTS = [
  "I quit my job to start a company.\nFor months we had zero revenue and almost no runway.\nBut then we landed our first paid customer and closed $5,000 in sales.",
  "We launched our product to total silence.\nOur startup burned through most of its funding fast.\nThen everything turned out fine: we signed our first deal worth $12k.",
] as const;

const AUDIENCE_QUESTION_TEXTS = [
  "Founders, what is the one tool you cannot live without these days?",
  "Builders, how do you stay focused when everything feels urgent at once?",
  "Creators, what is your go-to way to beat a content slump lately?",
] as const;

const STORY_TEXTS = [
  "I woke up early today.\nI walked to the corner cafe near my place.\nI ordered the same coffee I always get.",
  "I went for a long walk this morning.\nI thought about nothing in particular.\nI came back home feeling calm.",
] as const;

// Whitespace-only: still satisfies the store schema's text min length (1) at
// length 3, but trims to empty so the classifier returns "other".
const OTHER_TEXT = "   ";

const RANKING_FORMAT_TEXTS = {
  genuine_question: "Genuine question: why do teams keep hiding pricing?",
  hot_take: HOT_TAKE_TEXTS[0],
  founder_story: FOUNDER_STORY_TEXTS[0],
  audience_question: AUDIENCE_QUESTION_TEXTS[0],
  story: STORY_TEXTS[0],
  insight_share:
    "Reliable onboarding is mostly constraint design.\nThe best flows remove decisions before users notice them.",
  ab_choice: "- Ship the narrow version\n- Wait for perfect scope",
  fill_blank_tribal:
    "Startup has traction\nProduct is sticky\nCustomer has",
  cta_farm: "Drop your landing page below and I'll review it.",
  fantasy_question: "If you had $10k to fix onboarding, what would you do?",
  binary_choice: "Ship now or wait?",
  nuanced_question: "Be honest, do you actually prefer shipping fast or waiting?",
  recognition_roast: "We all know that one founder who calls every bug a learning.",
  wisdom_one_liner: "Specific proof beats clever positioning every launch week.",
  milestone: "We hit 100 users this week.",
  connect: "Let's connect.",
} as const;

const EXPECTED_GENERATION_FORMATS = [
  "fill_blank_tribal",
  "cta_farm",
  "fantasy_question",
  "binary_choice",
  "recognition_roast",
  "audience_question",
  "genuine_question",
  "ab_choice",
  "milestone",
  "founder_story",
  "story",
  "insight_share",
  "hot_take",
  "nuanced_question",
  "wisdom_one_liner",
] as const;

const externalPattern = (
  overrides: Partial<ExternalXSignalPattern> = {},
): ExternalXSignalPattern => ({
  id: "external-pattern-category-sentinel",
  patternType: "format",
  label: "Outside ranking pattern",
  statement:
    "EXTERNAL_NO_CONTAMINATION_STATEMENT_CATEGORY_SENTINEL: outside winners must not rerank own categories.",
  confidence: 0.9,
  supportCount: 6,
  sourceIds: [],
  evidenceIds: [],
  evidence: [
    {
      evidenceId: "external-evidence-category-sentinel",
      sourceId: "external-source-category-sentinel",
      screenName: "external_builder",
      platformPostId: "1888888888888888888",
      text: "EXTERNAL_NO_CONTAMINATION_EVIDENCE_PREVIEW_CATEGORY_SENTINEL should not affect ranking.",
      metrics: { replies: 200 },
    },
  ],
  generatedAt: FIXED_NOW_ISO,
  version: "external-x-signals:v1",
  ...overrides,
});

const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let idCounter = 0;

// Build an original-kind post carrying an archive snapshot. weakMetrics.favoriteCount
// is the weak reply proxy when no live capture exists. Each call gets a unique
// id + platformPostId so posts never collide on the repository's platform key.
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
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: createdAt,
        importedAt: FIXED_NOW_ISO,
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

// Build an original-kind post carrying an x_live_capture snapshot with a concrete
// reply count. Live replies are the preferred reply metric for ranking.
const livePost = (
  text: string,
  createdAt: string,
  replies: number,
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
        replies,
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

// A repository whose every read fails with PostLibraryStorageError. Used to drive
// GenerateCategoryService.getCategories into its storage-failure path for the
// HTTP 500 route test.
const failingRepository = (): PostLibraryRepository => ({
  loadStore: async () => {
    throw new PostLibraryStorageError("boom");
  },
  upsertPosts: async () => {
    throw new PostLibraryStorageError("boom");
  },
  saveImportRun: async () => undefined,
  saveDerivedInsights: async () => undefined,
  setActiveContext: async () => undefined,
  pushProfileSnapshot: async () => undefined,
});

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const findByFormat = (
  categories: GenerateCategory[],
  format: GenerateCategory["format"],
): GenerateCategory | undefined =>
  categories.find((category) => category.format === format);

// ---------------------------------------------------------------------------
// Per-test isolation: fresh mkdtemp root + real repository instance, a real
// RepetitionWindowService against the same repo, deterministic clock.
// ---------------------------------------------------------------------------
let root: string;
let db: ReturnType<typeof openEngineDatabase>;
let repository: PostLibraryRepository;
let windowService: RepetitionWindowService;
let service: GenerateCategoryService;

beforeEach(async () => {
  idCounter = 0;
  root = await mkdtemp(join(tmpdir(), "x-builder-generate-category-"));
  db = openEngineDatabase(":memory:");
  repository = new SqlitePostLibraryRepository(db);
  windowService = new RepetitionWindowService(repository, fixedNow);
  service = new GenerateCategoryService(repository, windowService);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("GenerateCategoryService fixture classification guard", () => {
  // Pins the fixture-to-format mapping the ranking assertions depend on.
  it("classifies each fixture text to its intended detected format", () => {
    for (const text of HOT_TAKE_TEXTS) {
      expect(classifyPostFormat(text)).toBe("hot_take");
    }
    for (const text of FOUNDER_STORY_TEXTS) {
      expect(classifyPostFormat(text)).toBe("founder_story");
    }
    for (const text of AUDIENCE_QUESTION_TEXTS) {
      expect(classifyPostFormat(text)).toBe("audience_question");
    }
    for (const text of STORY_TEXTS) {
      expect(classifyPostFormat(text)).toBe("story");
    }
    for (const [format, text] of Object.entries(RANKING_FORMAT_TEXTS)) {
      expect(classifyPostFormat(text)).toBe(format);
    }
    expect(classifyPostFormat(OTHER_TEXT)).toBe("other");
  });
});

describe("GenerateCategoryService.getCategories cold-start path", () => {
  // Coverage 1 + AC: corpus with fewer than 10 originals -> the fixed generator defaults.
  it("returns the fifteen fixed defaults for a corpus with fewer than ten originals", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1)),
      archivePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(2)),
      archivePost(STORY_TEXTS[0], isoDaysAgo(3)),
    ]);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    for (const category of categories) {
      expect(generateCategorySchema.safeParse(category).success).toBe(true);
      expect(category.basis).toBe("default");
      expect(category.sampleCount).toBe(0);
      expect(category.cooldownStatus).toBe("clear");
    }
    expect(categories.map((category) => category.format)).toEqual(EXPECTED_GENERATION_FORMATS);
    expect(categories.map((category) => category.id)).toEqual(
      EXPECTED_GENERATION_FORMATS.map((format) => `default_${format}`),
    );
  });

  // AC: an empty corpus (0 posts) -> exactly 15 defaults.
  it("returns the fifteen fixed defaults for an empty corpus", async () => {
    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories.every((category) => category.basis === "default")).toBe(true);
    expect(categories.every((category) => category.sampleCount === 0)).toBe(true);
    expect(categories.every((category) => category.cooldownStatus === "clear")).toBe(true);
    expect(categories.map((category) => category.format)).toEqual(EXPECTED_GENERATION_FORMATS);
  });

  // Edge: posts exist but none are originals (all replies / reposts) -> the
  // original count is 0, below the threshold, so the cold-start defaults return.
  it("returns the fifteen fixed defaults when posts exist but none are originals", async () => {
    await repository.upsertPosts([
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1), { kind: "reply" }),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2), { kind: "repost_reference" }),
      archivePost(STORY_TEXTS[0], isoDaysAgo(3), { kind: "reply" }),
    ]);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories.every((category) => category.basis === "default")).toBe(true);
    expect(categories.map((category) => category.format)).toEqual(EXPECTED_GENERATION_FORMATS);
  });
});

describe("GenerateCategoryService.getCategories corpus path", () => {
  // Coverage 2: >= 10 originals skewed to hot_take with live replies. hot_take
  // has the highest sampleCount * avgReplies among corpus-backed lanes, so it
  // is marked as the top performer. Higher-opportunity generator lanes still
  // render above it as defaults.
  it("marks the highest performing corpus format without hiding stronger default lanes", async () => {
    const posts: CanonicalOwnPostInput[] = [
      // 7 hot_take originals, each with 10 live replies (sampleCount 7, avg 10,
      // score 70). Only one is in-window so the cooldown stays clear.
      livePost(HOT_TAKE_TEXTS[0], isoDaysAgo(2), 10),
      livePost(HOT_TAKE_TEXTS[1], isoDaysAgo(10), 10),
      livePost(HOT_TAKE_TEXTS[2], isoDaysAgo(12), 10),
      livePost(HOT_TAKE_TEXTS[3], isoDaysAgo(14), 10),
      livePost(HOT_TAKE_TEXTS[4], isoDaysAgo(16), 10),
      livePost(HOT_TAKE_TEXTS[5], isoDaysAgo(18), 10),
      livePost(HOT_TAKE_TEXTS[6], isoDaysAgo(20), 10),
      // 3 story originals with a single reply each (sampleCount 3, avg 1, score 3).
      livePost(STORY_TEXTS[0], isoDaysAgo(22), 1),
      livePost(STORY_TEXTS[1], isoDaysAgo(24), 1),
      livePost(STORY_TEXTS[0], isoDaysAgo(26), 1, {
        // Re-uses the story text but a unique platform id keeps it distinct.
      }),
    ];
    await repository.upsertPosts(posts);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories[0]?.format).toBe("fill_blank_tribal");
    expect(categories[0]?.basis).toBe("default");
    const top = findByFormat(categories, "hot_take");
    expect(top?.basis).toBe("top_performer");
    expect(top?.sampleCount).toBe(7);
    expect(top?.sampleCount).toBeGreaterThan(0);
    expect(top?.cooldownStatus).toBe("clear");
    expect(top?.id).toBe("corpus_hot_take");
    expect(top?.label).toBe("Hot take");
    // Non-top corpus formats carry the "frequent" basis.
    const story = findByFormat(categories, "story");
    expect(story?.basis).toBe("frequent");
  });

  // Coverage 3 + AC: hot_take is in cooldown because 4+ hot_take originals fall
  // inside the 7-day window. The returned hot_take entry carries
  // cooldownStatus "cooldown" but is NOT excluded from the list.
  it("annotates a corpus-backed format as in cooldown when four or more fall inside the window", async () => {
    const posts: CanonicalOwnPostInput[] = [
      // 5 hot_take originals all inside the 7-day window -> cooldown. Each carries
      // 10 live replies so hot_take is also the highest performing format.
      livePost(HOT_TAKE_TEXTS[0], isoDaysAgo(1), 10),
      livePost(HOT_TAKE_TEXTS[1], isoDaysAgo(2), 10),
      livePost(HOT_TAKE_TEXTS[2], isoDaysAgo(3), 10),
      livePost(HOT_TAKE_TEXTS[3], isoDaysAgo(4), 10),
      livePost(HOT_TAKE_TEXTS[4], isoDaysAgo(5), 10),
      // Filler originals across two other formats to clear the 10-original gate,
      // each with a single reply so hot_take keeps the highest score.
      livePost(STORY_TEXTS[0], isoDaysAgo(20), 1),
      livePost(STORY_TEXTS[1], isoDaysAgo(22), 1),
      livePost(STORY_TEXTS[0], isoDaysAgo(24), 1),
      livePost(AUDIENCE_QUESTION_TEXTS[0], isoDaysAgo(26), 1),
      livePost(AUDIENCE_QUESTION_TEXTS[1], isoDaysAgo(28), 1),
    ];
    await repository.upsertPosts(posts);

    const categories: GenerateCategory[] = await service.getCategories();

    const audienceQuestion = findByFormat(categories, "audience_question");
    expect(audienceQuestion?.basis).toBe("top_performer");
    const hotTake = findByFormat(categories, "hot_take");
    expect(hotTake?.basis).toBe("frequent");
    expect(hotTake?.cooldownStatus).toBe("cooldown");
    expect(hotTake?.sampleCount).toBeGreaterThan(0);
    // Cooldown formats are annotated, not hidden.
    expect(findByFormat(categories, "hot_take")).toBeDefined();
  });

  // Coverage 4 + Edge: "other"-format originals are excluded from ranking and never
  // appear in the result.
  it("excludes other-format originals from ranking and from the result", async () => {
    const posts: CanonicalOwnPostInput[] = [
      // 4 "other" originals (whitespace) with high reply counts: must not rank.
      livePost(OTHER_TEXT, isoDaysAgo(1), 100),
      livePost(OTHER_TEXT, isoDaysAgo(2), 100),
      livePost(OTHER_TEXT, isoDaysAgo(3), 100),
      livePost(OTHER_TEXT, isoDaysAgo(4), 100),
      // Three real formats so the corpus path is taken and at least 3 categories return.
      livePost(HOT_TAKE_TEXTS[0], isoDaysAgo(10), 5),
      livePost(HOT_TAKE_TEXTS[1], isoDaysAgo(11), 5),
      livePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(12), 3),
      livePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(13), 3),
      livePost(STORY_TEXTS[0], isoDaysAgo(14), 2),
      livePost(STORY_TEXTS[1], isoDaysAgo(15), 2),
    ];
    await repository.upsertPosts(posts);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories.some((category) => category.format === "other")).toBe(false);
    expect(categories.every((category) => category.id !== "corpus_other")).toBe(true);
    // The real formats still surface despite the high-reply "other" noise.
    expect(findByFormat(categories, "hot_take")).toBeDefined();
  });

  // Edge: exactly 3 distinct non-"other" formats. Playbook opportunity orders
  // the full 15-lane menu, with corpus metadata overlaid on matching lanes.
  it("returns the full opportunity-weighted generator menu with corpus metadata overlaid", async () => {
    const posts: CanonicalOwnPostInput[] = [
      // hot_take x4 @ 5 replies -> score 20, but lower playbook opportunity
      // than founder_story.
      livePost(HOT_TAKE_TEXTS[0], isoDaysAgo(10), 5),
      livePost(HOT_TAKE_TEXTS[1], isoDaysAgo(11), 5),
      livePost(HOT_TAKE_TEXTS[2], isoDaysAgo(12), 5),
      livePost(HOT_TAKE_TEXTS[3], isoDaysAgo(13), 5),
      // founder_story x2 @ 3 replies -> score 6.
      livePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(14), 3),
      livePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(15), 3),
      // story x4 @ 1 reply -> score 4. Total 10 originals, exactly 3 formats.
      livePost(STORY_TEXTS[0], isoDaysAgo(16), 1),
      livePost(STORY_TEXTS[1], isoDaysAgo(17), 1),
      livePost(STORY_TEXTS[0], isoDaysAgo(18), 1),
      livePost(STORY_TEXTS[1], isoDaysAgo(19), 1),
    ];
    await repository.upsertPosts(posts);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories.map((category) => category.format)).toEqual([
      "fill_blank_tribal",
      "cta_farm",
      "fantasy_question",
      "binary_choice",
      "recognition_roast",
      "audience_question",
      "genuine_question",
      "ab_choice",
      "founder_story",
      "milestone",
      "hot_take",
      "story",
      "nuanced_question",
      "insight_share",
      "wisdom_one_liner",
    ]);
    expect(findByFormat(categories, "founder_story")?.basis).toBe("top_performer");
    expect(findByFormat(categories, "hot_take")?.basis).toBe("frequent");
    expect(findByFormat(categories, "story")?.basis).toBe("frequent");
    expect(categories.filter((category) => category.basis !== "default")).toHaveLength(3);
  });

  // Edge: no live replies and no weak favorites anywhere -> avgReplies is 0 for
  // every format, so all performanceScores are 0. Ranking falls back to playbook
  // opportunity and then the fixed generator order.
  it("ranks zero-score formats by opportunity and keeps all ranked formats under the top-fifteen cap", async () => {
    const posts: CanonicalOwnPostInput[] = [
      // No replies, no favoriteCount -> avgReplies 0 for each format.
      archivePost(HOT_TAKE_TEXTS[0], isoDaysAgo(10)),
      archivePost(HOT_TAKE_TEXTS[1], isoDaysAgo(11)),
      archivePost(HOT_TAKE_TEXTS[2], isoDaysAgo(12)),
      archivePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(13)),
      archivePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(14)),
      archivePost(AUDIENCE_QUESTION_TEXTS[0], isoDaysAgo(15)),
      archivePost(AUDIENCE_QUESTION_TEXTS[1], isoDaysAgo(16)),
      archivePost(STORY_TEXTS[0], isoDaysAgo(17)),
      archivePost(STORY_TEXTS[1], isoDaysAgo(18)),
      archivePost(STORY_TEXTS[0], isoDaysAgo(19)),
    ];
    await repository.upsertPosts(posts);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories.map((category) => category.format)).toEqual([
      "fill_blank_tribal",
      "cta_farm",
      "fantasy_question",
      "binary_choice",
      "recognition_roast",
      "audience_question",
      "genuine_question",
      "ab_choice",
      "milestone",
      "founder_story",
      "story",
      "hot_take",
      "nuanced_question",
      "insight_share",
      "wisdom_one_liner",
    ]);
    // The first corpus-backed opportunity lane becomes the top performer; the
    // remaining corpus lanes are frequent, and untouched lanes stay defaults.
    expect(findByFormat(categories, "audience_question")?.basis).toBe("top_performer");
    expect(findByFormat(categories, "founder_story")?.basis).toBe("frequent");
    expect(findByFormat(categories, "story")?.basis).toBe("frequent");
    expect(findByFormat(categories, "hot_take")?.basis).toBe("frequent");
    expect(categories.filter((category) => category.basis !== "default")).toHaveLength(4);
  });

  it("returns the fifteen highest opportunity ranked formats when more are available", async () => {
    const rankedFormats = [
      "hot_take",
      "founder_story",
      "audience_question",
      "story",
      "fill_blank_tribal",
      "cta_farm",
      "fantasy_question",
      "binary_choice",
      "genuine_question",
      "insight_share",
      "ab_choice",
      "nuanced_question",
      "recognition_roast",
      "wisdom_one_liner",
      "milestone",
      "connect",
    ] as const;

    await repository.upsertPosts([
      ...rankedFormats.map((format, index) =>
        livePost(RANKING_FORMAT_TEXTS[format], isoDaysAgo(10 + index), 160 - index * 5),
      ),
      // Counts toward the 10-original corpus gate but must not rank.
      livePost(OTHER_TEXT, isoDaysAgo(30), 1_000),
    ]);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories.map((category) => category.format)).toEqual([
      "fill_blank_tribal",
      "cta_farm",
      "fantasy_question",
      "binary_choice",
      "recognition_roast",
      "audience_question",
      "genuine_question",
      "ab_choice",
      "founder_story",
      "milestone",
      "hot_take",
      "story",
      "nuanced_question",
      "insight_share",
      "wisdom_one_liner",
    ]);
    expect(categories.some((category) => category.format === "connect")).toBe(false);
    expect(categories.some((category) => category.format === "other")).toBe(false);
    expect(categories[0]?.basis).toBe("top_performer");
    expect(categories.slice(1).every((category) => category.basis === "frequent")).toBe(true);
  });

  it("keeps own-corpus category ranking unchanged when external patterns exist in the same database", async () => {
    const posts: CanonicalOwnPostInput[] = [
      livePost(HOT_TAKE_TEXTS[0], isoDaysAgo(10), 5),
      livePost(HOT_TAKE_TEXTS[1], isoDaysAgo(11), 5),
      livePost(HOT_TAKE_TEXTS[2], isoDaysAgo(12), 5),
      livePost(HOT_TAKE_TEXTS[3], isoDaysAgo(13), 5),
      livePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(14), 3),
      livePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(15), 3),
      livePost(AUDIENCE_QUESTION_TEXTS[0], isoDaysAgo(16), 2),
      livePost(AUDIENCE_QUESTION_TEXTS[1], isoDaysAgo(17), 2),
      livePost(STORY_TEXTS[0], isoDaysAgo(18), 1),
      livePost(STORY_TEXTS[1], isoDaysAgo(19), 1),
    ];
    await repository.upsertPosts(posts);

    const baseline = await service.getCategories();
    const externalRepository = new SqliteExternalXSignalsRepository(db, {
      now: () => FIXED_NOW_ISO,
      id: () => "external-source-category-sentinel",
    });
    await externalRepository.replacePatterns([externalPattern()]);

    const withExternalPatterns = await service.getCategories();

    expect(withExternalPatterns).toEqual(baseline);
    expect(JSON.stringify(withExternalPatterns)).not.toContain("EXTERNAL_NO_CONTAMINATION_STATEMENT_CATEGORY_SENTINEL");
    expect(JSON.stringify(withExternalPatterns)).not.toContain("EXTERNAL_NO_CONTAMINATION_EVIDENCE_PREVIEW_CATEGORY_SENTINEL");
  });

  // Edge: every original classifies as "other" while still clearing the 10-original
  // gate -> there are zero corpus-derived formats, so the service backfills the
  // generator defaults.
  it("falls back to the fifteen defaults when all originals classify as other", async () => {
    const posts: CanonicalOwnPostInput[] = Array.from({ length: 11 }, (_unused, index) =>
      archivePost(OTHER_TEXT, isoDaysAgo(index + 1)),
    );
    await repository.upsertPosts(posts);

    const categories: GenerateCategory[] = await service.getCategories();

    expect(categories).toHaveLength(15);
    expect(categories.every((category) => category.basis === "default")).toBe(true);
    expect(categories.every((category) => category.sampleCount === 0)).toBe(true);
    expect(categories.map((category) => category.format)).toEqual(EXPECTED_GENERATION_FORMATS);
  });
});

describe("GET /generate/categories route", () => {
  // Coverage 5 + AC: a seeded corpus served over HTTP -> 200, body parses as an
  // array of GenerateCategory, exactly 15 items.
  it("responds 200 with an array of generate categories for a seeded corpus", async () => {
    const posts: CanonicalOwnPostInput[] = [
      livePost(HOT_TAKE_TEXTS[0], isoDaysAgo(10), 5),
      livePost(HOT_TAKE_TEXTS[1], isoDaysAgo(11), 5),
      livePost(HOT_TAKE_TEXTS[2], isoDaysAgo(12), 5),
      livePost(HOT_TAKE_TEXTS[3], isoDaysAgo(13), 5),
      livePost(FOUNDER_STORY_TEXTS[0], isoDaysAgo(14), 3),
      livePost(FOUNDER_STORY_TEXTS[1], isoDaysAgo(15), 3),
      livePost(AUDIENCE_QUESTION_TEXTS[0], isoDaysAgo(16), 2),
      livePost(AUDIENCE_QUESTION_TEXTS[1], isoDaysAgo(17), 2),
      livePost(STORY_TEXTS[0], isoDaysAgo(18), 1),
      livePost(STORY_TEXTS[1], isoDaysAgo(19), 1),
    ];
    await repository.upsertPosts(posts);

    const app = buildServer({
      postLibraryRepository: repository,
      generateCategoryService: service,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/generate/categories",
      });

      expect(response.statusCode).toBe(200);
      const body = generateCategorySchema
        .array()
        .parse(parseJsonPayload(response.body));
      expect(body).toHaveLength(15);
    } finally {
      await app.close();
    }
  });

  // Coverage 6 + AC: the route's service reads through a repository that throws
  // PostLibraryStorageError -> 500 with code "library_storage_failed".
  it("responds 500 with library_storage_failed when the repository read fails", async () => {
    const repo = failingRepository();
    const throwingService = new GenerateCategoryService(
      repo,
      new RepetitionWindowService(repo, fixedNow),
    );
    const app = buildServer({
      postLibraryRepository: repo,
      generateCategoryService: throwingService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/generate/categories",
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJsonPayload(response.body));
      expect(error.code).toBe("library_storage_failed");
    } finally {
      await app.close();
    }
  });
});
