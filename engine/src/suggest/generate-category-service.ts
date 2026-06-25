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
// service short-circuits to the fixed default set.
const CORPUS_THRESHOLD = 10;

// The cooldown window: how many days back "recent" / the clear→warming→cooldown
// signal is measured over.
const COOLDOWN_WINDOW_DAYS = 7;

// The fixed cold-start categories, returned verbatim when the corpus is thin or
// yields no rankable (non-"other") formats. Order is significant — the tests
// assert this exact sequence.
const DEFAULT_CATEGORIES: readonly GenerateCategory[] = [
  {
    id: "default_hot_take",
    label: "Hot take",
    format: "hot_take",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
    recentCount: 0,
    windowDays: COOLDOWN_WINDOW_DAYS,
  },
  {
    id: "default_founder_story",
    label: "Build-in-public",
    format: "founder_story",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
    recentCount: 0,
    windowDays: COOLDOWN_WINDOW_DAYS,
  },
  {
    id: "default_audience_q",
    label: "Question",
    format: "audience_question",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
    recentCount: 0,
    windowDays: COOLDOWN_WINDOW_DAYS,
  },
  {
    id: "default_story",
    label: "Story",
    format: "story",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
    recentCount: 0,
    windowDays: COOLDOWN_WINDOW_DAYS,
  },
];

// Display labels shared with the overlay button map. Formats absent here derive
// their label from the format key (underscores to spaces, title-cased).
const FORMAT_LABELS: Partial<Record<PostFormat, string>> = {
  hot_take: "Hot take",
  founder_story: "Build-in-public",
  audience_question: "Question",
  story: "Story",
};

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

    // Cold-start: too few originals to rank — return the fixed defaults.
    if (originals.length < CORPUS_THRESHOLD) {
      return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    }

    const ranked = this.rankFormats(originals);

    // No rankable (non-"other") formats — fall back to the full default set.
    if (ranked.length === 0) {
      return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    }

    const report = await this.windowService.compute(COOLDOWN_WINDOW_DAYS);
    const signalByFormat = this.signalLookup(report);

    const categories: GenerateCategory[] = ranked.map((entry, index) => {
      const signal = signalByFormat.get(entry.format);

      return {
        id: `corpus_${entry.format}`,
        label: labelForFormat(entry.format),
        format: entry.format,
        basis: index === 0 ? "top_performer" : "frequent",
        // `cooldownStatus` + `recentCount` come from the WINDOW (what "recent"
        // means); `sampleCount` stays the all-time corpus count for ranking.
        cooldownStatus: signal?.status ?? "clear",
        sampleCount: entry.sampleCount,
        recentCount: signal?.countInWindow ?? 0,
        windowDays: signal?.windowDays ?? COOLDOWN_WINDOW_DAYS,
      };
    });

    // Always return at least 3; include a 4th only when its score is non-zero
    // and it is not in cooldown. Backfill from defaults when fewer than 3 exist.
    const selected = categories.slice(0, 3);

    const fourth = categories[3];
    if (fourth !== undefined && fourth.sampleCount > 0) {
      const ranked4th = ranked[3]!;
      if (ranked4th.performanceScore > 0 && fourth.cooldownStatus !== "cooldown") {
        selected.push(fourth);
      }
    }

    if (selected.length < 3) {
      for (const fallback of DEFAULT_CATEGORIES) {
        if (selected.length >= 3) {
          break;
        }

        if (selected.some((category) => category.format === fallback.format)) {
          continue;
        }

        selected.push({ ...fallback });
      }
    }

    return selected;
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
      });
    }

    // Descending by performanceScore, tie-break alphabetically by format name.
    ranked.sort((a, b) => {
      if (b.performanceScore !== a.performanceScore) {
        return b.performanceScore - a.performanceScore;
      }

      return a.format.localeCompare(b.format);
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
