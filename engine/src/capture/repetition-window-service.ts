import {
  cooldownReportSchema,
  type CooldownReport,
  type CooldownSignal,
  type CooldownStatus,
  type RepeatHistoryEntry,
} from "@x-builder/shared";

import { classifyPostFormat } from "../deterministic/format-classifier.js";
import {
  type CanonicalOwnPost,
  type PostLibraryRepository,
} from "../server/post-library-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Detected formats are the classifier's output minus "other", which is excluded
// from cooldown signals (it is noise, not a repeatable content format).
type SignalFormat = CooldownSignal["format"];

// Per-format accumulator: in-window count plus the most-recent createdAt across
// ALL originals of that format (not just the in-window ones).
type FormatTally = {
  countInWindow: number;
  lastPostedAt: string;
};

const statusFor = (countInWindow: number): CooldownStatus => {
  if (countInWindow >= 4) {
    return "cooldown";
  }

  if (countInWindow >= 2) {
    return "warming";
  }

  return "clear";
};

const messageFor = (
  format: SignalFormat,
  countInWindow: number,
  windowDays: number,
  status: CooldownStatus,
): string => {
  const postWord = countInWindow === 1 ? "post" : "posts";
  const tail =
    status === "cooldown"
      ? "give this format a rest."
      : status === "warming"
        ? "warming up."
        : "all clear.";

  return `${countInWindow} ${format} ${postWord} in the last ${windowDays} days — ${tail}`;
};

export class RepetitionWindowService {
  constructor(
    private readonly repo: PostLibraryRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async compute(windowDays = 7): Promise<CooldownReport> {
    // A PostLibraryStorageError thrown here propagates unchanged by design.
    const store = await this.repo.loadStore();
    const corpusSource = this.resolveCorpusSource(store.posts);

    const windowCutoff = new Date(this.now().getTime() - windowDays * DAY_MS);
    const tallies = new Map<SignalFormat, FormatTally>();

    for (const post of store.posts) {
      // Same population the scoring engine considers: originals only.
      if (post.kind !== "original") {
        continue;
      }

      const format = classifyPostFormat(post.text);

      if (format === "other") {
        continue;
      }

      const existing = tallies.get(format);
      const inWindow = new Date(post.createdAt) >= windowCutoff;

      if (existing === undefined) {
        tallies.set(format, {
          countInWindow: inWindow ? 1 : 0,
          lastPostedAt: post.createdAt,
        });
        continue;
      }

      if (inWindow) {
        existing.countInWindow += 1;
      }

      // lastPostedAt spans all originals of the format, in-window or not.
      if (post.createdAt > existing.lastPostedAt) {
        existing.lastPostedAt = post.createdAt;
      }
    }

    const signals: CooldownSignal[] = [];

    for (const [format, tally] of tallies) {
      // A format that appears only outside the window produces no signal.
      if (tally.countInWindow < 1) {
        continue;
      }

      const status = statusFor(tally.countInWindow);

      signals.push({
        format,
        countInWindow: tally.countInWindow,
        windowDays,
        lastPostedAt: tally.lastPostedAt,
        status,
        message: messageFor(format, tally.countInWindow, windowDays, status),
      });
    }

    // Descending by in-window count, then keep the top 40 (schema cap).
    signals.sort((a, b) => b.countInWindow - a.countInWindow);
    const cappedSignals = signals.slice(0, 40);

    // Parse the assembled report fail-fast so every returned value is valid.
    return cooldownReportSchema.parse({
      windowDays,
      generatedAt: this.now().toISOString(),
      corpusSource,
      signals: cappedSignals,
    });
  }

  asRepeatHistory(report: CooldownReport): RepeatHistoryEntry[] {
    return report.signals.map((signal) => ({
      format: signal.format,
      lastPostedAt: signal.lastPostedAt ?? this.now().toISOString(),
      countLast7d: signal.countInWindow,
    }));
  }

  private resolveCorpusSource(
    posts: CanonicalOwnPost[],
  ): CooldownReport["corpusSource"] {
    if (posts.length === 0) {
      return "empty";
    }

    let anyArchive = false;
    let anyLive = false;

    for (const post of posts) {
      // metricSnapshots is a true discriminated union on `source`; narrow on it.
      for (const snapshot of post.metricSnapshots) {
        if (snapshot.source === "archive_tweets_js") {
          anyArchive = true;
        } else if (snapshot.source === "x_live_capture") {
          anyLive = true;
        }
      }
    }

    if (anyLive && anyArchive) {
      return "merged";
    }

    if (anyLive) {
      return "live";
    }

    return "archive";
  }
}
