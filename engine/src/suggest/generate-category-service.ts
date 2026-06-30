import {
  type CooldownReport,
  type CooldownSignal,
  type GenerateCategory,
} from "@x-builder/shared";

import { classifyPostFormat } from "../deterministic/format-classifier.js";
import { type PostFormat } from "../deterministic/types.js";
import { RepetitionWindowService } from "../capture/repetition-window-service.js";
import {
  type CanonicalOwnPost,
  type PostLibraryRepository,
} from "../server/post-library-repository.js";

// Below this many `original`-kind posts the corpus is too thin to rank, so the
// service short-circuits to the fixed generator-format default set.
const CORPUS_THRESHOLD = 10;

// The cooldown window: how many days back "recent" / the clear→warming→cooldown
// signal is measured over.
const COOLDOWN_WINDOW_DAYS = 7;
const MAX_RANKED_CATEGORIES = 15;

const GENERATION_FORMATS: readonly PostFormat[] = [
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
];

// Display labels shared with the overlay button map. Formats absent here derive
// their label from the format key (underscores to spaces, title-cased).
const FORMAT_LABELS: Partial<Record<PostFormat, string>> = {
  hot_take: "Hot take",
  founder_story: "Build-in-public",
  audience_question: "Question",
  story: "Story",
};

const GENERATION_OPPORTUNITY_WEIGHT: Partial<Record<PostFormat, number>> = {
  fill_blank_tribal: 3.0,
  cta_farm: 3.0,
  fantasy_question: 2.5,
  binary_choice: 2.0,
  recognition_roast: 1.8,
  audience_question: 1.6,
  ab_choice: 1.2,
  genuine_question: 1.2,
  milestone: 1.0,
  founder_story: 1.0,
  story: 0.8,
  hot_take: 0.8,
  nuanced_question: 0.5,
  insight_share: 0.3,
  wisdom_one_liner: 0.3,
};

const opportunityWeightForFormat = (format: PostFormat): number =>
  GENERATION_OPPORTUNITY_WEIGHT[format] ?? 1;

const labelForFormat = (format: PostFormat): string => {
  const known = FORMAT_LABELS[format];
  if (known !== undefined) {
    return known;
  }

  return format
    .split("_")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
};

const defaultCategoryForFormat = (
  format: PostFormat,
  signal?: CooldownSignal,
): GenerateCategory => ({
  id: `default_${format}`,
  label: labelForFormat(format),
  format,
  basis: "default",
  cooldownStatus: signal?.status ?? "clear",
  sampleCount: 0,
  recentCount: signal?.countInWindow ?? 0,
  windowDays: signal?.windowDays ?? COOLDOWN_WINDOW_DAYS,
});

const defaultCategories = (): GenerateCategory[] =>
  GENERATION_FORMATS.map((format) => defaultCategoryForFormat(format));

// The reply metric for ranking: live replies first, then the archive favorite
// count as a weak proxy, then zero. metricSnapshots is a discriminated union on
// `source`, so narrow on it before reading `replies`.
const replyMetricFor = (post: CanonicalOwnPost): number => {
  const live = post.metricSnapshots.find(
    (snapshot) => snapshot.source === "x_live_capture",
  );

  return live?.replies ?? post.weakMetrics.favoriteCount ?? 0;
};

type RankedFormat = {
  format: PostFormat;
  sampleCount: number;
  avgReplies: number;
  performanceScore: number;
  opportunityWeight: number;
};

export class GenerateCategoryService {
  constructor(
    private readonly repo: PostLibraryRepository,
    private readonly windowService: RepetitionWindowService,
  ) {}

  async getCategories(): Promise<GenerateCategory[]> {
    // A PostLibraryStorageError thrown here propagates unchanged by design.
    const store = await this.repo.loadStore();
    const originals = store.posts.filter((post) => post.kind === "original");

    // Cold-start: too few originals to rank — return the fixed generator defaults.
    if (originals.length < CORPUS_THRESHOLD) {
      return defaultCategories();
    }

    const ranked = this.rankFormats(originals);

    // No rankable (non-"other") formats — fall back to the full default set.
    if (ranked.length === 0) {
      return defaultCategories();
    }

    const report = await this.windowService.compute(COOLDOWN_WINDOW_DAYS);
    const signalByFormat = this.signalLookup(report);

    const rankedByFormat = new Map<PostFormat, RankedFormat>(
      ranked.map((entry) => [entry.format, entry]),
    );

    const categories: GenerateCategory[] = GENERATION_FORMATS.map((format) => {
      const entry = rankedByFormat.get(format);
      const signal = signalByFormat.get(format);

      if (entry === undefined) {
        return defaultCategoryForFormat(format, signal);
      }

      return {
        id: `corpus_${entry.format}`,
        label: labelForFormat(entry.format),
        format: entry.format,
        basis: "frequent",
        // `cooldownStatus` + `recentCount` come from the WINDOW (what "recent"
        // means); `sampleCount` stays the all-time corpus count for ranking.
        cooldownStatus: signal?.status ?? "clear",
        sampleCount: entry.sampleCount,
        recentCount: signal?.countInWindow ?? 0,
        windowDays: signal?.windowDays ?? COOLDOWN_WINDOW_DAYS,
      };
    });

    categories.sort((a, b) => {
      const opportunityDelta =
        opportunityWeightForFormat(b.format) - opportunityWeightForFormat(a.format);
      if (opportunityDelta !== 0) {
        return opportunityDelta;
      }

      const performanceLeft = rankedByFormat.get(a.format)?.performanceScore ?? 0;
      const performanceRight = rankedByFormat.get(b.format)?.performanceScore ?? 0;
      if (performanceRight !== performanceLeft) {
        return performanceRight - performanceLeft;
      }

      return GENERATION_FORMATS.indexOf(a.format) - GENERATION_FORMATS.indexOf(b.format);
    });

    const topCorpusIndex = categories.findIndex((category) => category.basis !== "default");
    if (topCorpusIndex !== -1) {
      categories[topCorpusIndex] = {
        ...categories[topCorpusIndex]!,
        basis: "top_performer",
      };
    }

    // Return the most relevant ranked lanes. Relevance is the existing
    // playbook opportunity weight, with corpus performance as a secondary tie-break.
    // Cooldown is informational and does not hide a lane from the picker.
    return categories.slice(0, MAX_RANKED_CATEGORIES);
  }

  private rankFormats(originals: CanonicalOwnPost[]): RankedFormat[] {
    const buckets = new Map<PostFormat, number[]>();

    for (const post of originals) {
      const format = classifyPostFormat(post.text);

      if (format === "other") {
        continue;
      }

      const replies = buckets.get(format);
      if (replies === undefined) {
        buckets.set(format, [replyMetricFor(post)]);
      } else {
        replies.push(replyMetricFor(post));
      }
    }

    const ranked: RankedFormat[] = [];

    for (const [format, replies] of buckets) {
      const sampleCount = replies.length;
      const avgReplies =
        sampleCount === 0
          ? 0
          : replies.reduce((sum, value) => sum + value, 0) / sampleCount;

      ranked.push({
        format,
        sampleCount,
        avgReplies,
        performanceScore: sampleCount * avgReplies,
        opportunityWeight: opportunityWeightForFormat(format),
      });
    }

    // Descending by playbook opportunity first, then corpus performance, then the
    // fixed generator order. This keeps status-gated/weak formats from leading
    // merely because they appeared often in the local corpus.
    ranked.sort((a, b) => {
      if (b.opportunityWeight !== a.opportunityWeight) {
        return b.opportunityWeight - a.opportunityWeight;
      }

      if (b.performanceScore !== a.performanceScore) {
        return b.performanceScore - a.performanceScore;
      }

      return GENERATION_FORMATS.indexOf(a.format) - GENERATION_FORMATS.indexOf(b.format);
    });

    return ranked;
  }

  private signalLookup(report: CooldownReport): Map<PostFormat, CooldownSignal> {
    const lookup = new Map<PostFormat, CooldownSignal>();

    for (const signal of report.signals) {
      lookup.set(signal.format, signal);
    }

    return lookup;
  }
}
