import {
  type CooldownReport,
  type CooldownSignal,
  type CooldownStatus,
  type DetectedPostFormat,
  type SuggestedPost,
  type SuggestPostRequest,
  type SuggestPostResponse,
  suggestPostResponseSchema,
} from "@x-builder/shared";

import { classifyPostFormat } from "../deterministic/format-classifier.js";
import { type JudgeProviderResolver } from "../llm/judge-draft-service.js";
import {
  StructuredLlmService,
  type StructuredLlmRequest,
} from "../llm/structured-llm-service.js";
import {
  type CanonicalOwnPost,
  type PostLibraryRepository,
} from "../server/post-library-repository.js";
import { type RepetitionWindowService } from "../capture/repetition-window-service.js";

// The corpus floor below which the rail cannot ground suggestions in a real
// performance signal; surfaced verbatim to the response (literal 10 in schema).
const MINIMUM_CORPUS_SIZE = 10;

// One LLM call; the suggest rail has no judge pass, so the whole budget is the
// single writer-first-pass draft.
const LLM_TIMEOUT_MS = 60_000;

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_COUNT = 3;

// A suggest target is any classifier format except "other" (noise, never a
// repeatable lane). chosenFormat is therefore a DetectedPostFormat minus
// "other", which assigns cleanly to the schema's detectedPostFormatSchema.
type SuggestFormat = Exclude<DetectedPostFormat, "other">;

// Format -> angle is a service constant, not a schema concern: the preferred
// rhetorical stance for drafting in each lane. Formats absent from the map fall
// back to a sensible default below.
const formatAngleMap: Partial<
  Record<SuggestFormat, SuggestedPost["angle"]>
> = {
  hot_take: "caution",
  founder_story: "constructive",
  audience_question: "curious",
  story: "observational",
  genuine_question: "curious",
  nuanced_question: "curious",
  fantasy_question: "curious",
  binary_choice: "curious",
  insight_share: "constructive",
  wisdom_one_liner: "constructive",
  milestone: "observational",
  recognition_roast: "observational",
  fill_blank_tribal: "curious",
  ab_choice: "curious",
  cta_farm: "constructive",
  connect: "constructive",
};

const DEFAULT_ANGLE: SuggestedPost["angle"] = "observational";

const angleFor = (format: SuggestFormat): SuggestedPost["angle"] =>
  formatAngleMap[format] ?? DEFAULT_ANGLE;

const FALLBACK_RATIONALE =
  "High-performing post in your archive, suggested for reposting or inspiration.";

// Per-format ranking accumulator. weightedScore is replies-per-post so a small
// high-engagement lane is not buried under a large low-engagement one.
type FormatAggregate = {
  format: SuggestFormat;
  replyScore: number;
  postCount: number;
  weightedScore: number;
  // Originals in this format, kept so the top examples can be collected after
  // the winning lane is chosen.
  posts: Array<{ post: CanonicalOwnPost; score: number }>;
};

// The reply signal for one original: prefer the strongest live `replies`
// snapshot; fall back to the archive favoriteCount weak proxy when no live
// reply count exists. metricSnapshots is a discriminated union on `source`.
const replySignalFor = (post: CanonicalOwnPost): number => {
  let liveReplies = 0;
  let hasLiveReplies = false;

  for (const snapshot of post.metricSnapshots) {
    if (snapshot.source === "x_live_capture" && snapshot.replies !== undefined) {
      liveReplies += snapshot.replies;
      hasLiveReplies = true;
    }
  }

  if (hasLiveReplies) {
    return liveReplies;
  }

  // Archive-only weak signal: favoriteCount from archive snapshots, falling
  // back to the post's weakMetrics mirror of the same field.
  let archiveFavorites = 0;
  for (const snapshot of post.metricSnapshots) {
    if (snapshot.source === "archive_tweets_js" && snapshot.favoriteCount !== undefined) {
      archiveFavorites += snapshot.favoriteCount;
    }
  }

  if (archiveFavorites > 0) {
    return archiveFavorites;
  }

  return post.weakMetrics.favoriteCount ?? 0;
};

const cooldownStatusFor = (
  report: CooldownReport,
  format: SuggestFormat,
): CooldownStatus => {
  const signal = report.signals.find((candidate) => candidate.format === format);
  return signal?.status ?? "clear";
};

export class SuggestPostService {
  private readonly resolveNow: () => string;

  constructor(
    private readonly repository: PostLibraryRepository,
    private readonly windowService: RepetitionWindowService,
    private readonly llm: StructuredLlmService,
    private readonly resolveProvider: JudgeProviderResolver,
    now?: () => string,
  ) {
    this.resolveNow = now ?? (() => new Date().toISOString());
  }

  async suggest(request: SuggestPostRequest): Promise<SuggestPostResponse> {
    const windowDays = request.windowDays ?? DEFAULT_WINDOW_DAYS;
    const count = request.count ?? DEFAULT_COUNT;

    // Step 1 — load corpus. A PostLibraryStorageError propagates unchanged;
    // the route maps it to library_storage_failed.
    const store = await this.repository.loadStore();
    const originals = store.posts.filter((post) => post.kind === "original");

    if (originals.length < MINIMUM_CORPUS_SIZE) {
      return this.validate({
        status: "insufficient_corpus",
        suggestions: [],
        cooldown: await this.computeCooldown(windowDays),
        minimumCorpusSize: MINIMUM_CORPUS_SIZE,
      });
    }

    // Step 2 — cooldown report (compute-throws is swallowed to an empty report
    // so a window-service fault never fails the suggest route).
    const cooldownReport = await this.computeCooldown(windowDays);
    const excludedFormats = new Set<DetectedPostFormat>([
      ...cooldownReport.signals
        .filter((signal) => signal.status === "cooldown")
        .map((signal) => signal.format),
      ...request.excludeFormats,
    ]);

    // Step 3 — deterministic ranking over non-excluded, non-"other" formats.
    const aggregates = this.rankFormats(originals, excludedFormats);

    let suggestions: SuggestedPost[];

    if (aggregates.length === 0) {
      // No eligible lane (whole corpus excluded): deterministic resurfacing is
      // the escape hatch — it ignores cooldown to keep the rail useful.
      suggestions = this.deterministicFallback(originals, cooldownReport, count);
    } else {
      const chosen = aggregates[0]!;
      const chosenFormat = chosen.format;
      const angle = angleFor(chosenFormat);
      const sourceExamplePostIds = chosen.posts
        .slice(0, 5)
        .map((entry) => entry.post.platformPostId);
      const exampleTexts = chosen.posts.slice(0, 5).map((entry) => entry.post.text);
      const cooldownStatus = cooldownStatusFor(cooldownReport, chosenFormat);

      // Step 4 — one LLM pass drafting in the chosen lane.
      const drafted = await this.draftWithLlm({
        chosenFormat,
        angle,
        cooldownStatus,
        sourceExamplePostIds,
        exampleTexts,
        count,
      });

      // Step 5 — LLM failure falls through to deterministic resurfacing.
      suggestions =
        drafted ?? this.deterministicFallback(originals, cooldownReport, count);
    }

    return this.validate({
      status: "ready",
      suggestions: suggestions.slice(0, 4),
      cooldown: cooldownReport,
      minimumCorpusSize: MINIMUM_CORPUS_SIZE,
    });
  }

  private async computeCooldown(windowDays: number): Promise<CooldownReport> {
    try {
      return await this.windowService.compute(windowDays);
    } catch (error) {
      // A window-service fault is observable but non-fatal: fall back to an
      // empty report so the suggest route still returns.
      console.error("[suggest] cooldown compute failed; using empty report", {
        error,
      });
      return {
        windowDays,
        generatedAt: this.resolveNow(),
        corpusSource: "empty",
        signals: [],
      };
    }
  }

  private rankFormats(
    originals: CanonicalOwnPost[],
    excludedFormats: Set<DetectedPostFormat>,
  ): FormatAggregate[] {
    const byFormat = new Map<SuggestFormat, FormatAggregate>();

    for (const post of originals) {
      const format = classifyPostFormat(post.text);

      if (format === "other" || excludedFormats.has(format)) {
        continue;
      }

      const score = replySignalFor(post);
      const existing = byFormat.get(format);

      if (existing === undefined) {
        byFormat.set(format, {
          format,
          replyScore: score,
          postCount: 1,
          weightedScore: 0,
          posts: [{ post, score }],
        });
        continue;
      }

      existing.replyScore += score;
      existing.postCount += 1;
      existing.posts.push({ post, score });
    }

    const aggregates = [...byFormat.values()];

    for (const aggregate of aggregates) {
      aggregate.weightedScore =
        aggregate.replyScore / Math.max(aggregate.postCount, 1);
      // Top examples first so sourceExamplePostIds reflect the strongest posts.
      aggregate.posts.sort((a, b) => b.score - a.score);
    }

    // Sort lanes descending by replies-per-post; tie breaks toward the larger
    // corpus (more evidence behind the same average).
    aggregates.sort((a, b) => {
      if (b.weightedScore !== a.weightedScore) {
        return b.weightedScore - a.weightedScore;
      }
      return b.postCount - a.postCount;
    });

    return aggregates;
  }

  private async draftWithLlm(params: {
    chosenFormat: SuggestFormat;
    angle: SuggestedPost["angle"];
    cooldownStatus: CooldownStatus;
    sourceExamplePostIds: string[];
    exampleTexts: string[];
    count: number;
  }): Promise<SuggestedPost[] | undefined> {
    const provider = await this.resolveProviderId();

    const request: StructuredLlmRequest<SuggestedPost[]> = {
      provider,
      purpose: "writer_first_pass",
      instructions: this.draftInstructions(params),
      turns: [
        {
          role: "user",
          content: `Draft ${params.count} posts in the ${params.chosenFormat} format with a ${params.angle} angle.`,
        },
      ],
      structuredOutput: {
        name: "suggested_posts",
        schema: suggestedDraftsSchema,
        parser: (value: unknown): SuggestedPost[] =>
          this.parseSuggestions(value, params),
      },
      options: { timeoutMs: LLM_TIMEOUT_MS },
    };

    const result = await this.llm.generateStructured(request);

    if (result.status === "failed") {
      return undefined;
    }

    return result.output.slice(0, params.count);
  }

  // Map the model payload into SuggestedPost[], filling the deterministic fields
  // the model never produces. The parser is idempotent: it reads the raw items
  // from either the model shape ({ suggestions: [{ id, text, rationale }] }) or
  // an already-mapped SuggestedPost[] — the StructuredLlmService runs this parser
  // a second time over its own output, so re-mapping must re-derive the same
  // deterministic fields rather than reject the shape.
  private parseSuggestions(
    value: unknown,
    params: {
      chosenFormat: SuggestFormat;
      angle: SuggestedPost["angle"];
      cooldownStatus: CooldownStatus;
      sourceExamplePostIds: string[];
    },
  ): SuggestedPost[] {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === "object" &&
          value !== null &&
          Array.isArray((value as { suggestions?: unknown }).suggestions)
        ? (value as { suggestions: unknown[] }).suggestions
        : undefined;

    if (rawItems === undefined) {
      throw new Error("Suggested output did not match the suggestion contract.");
    }

    return rawItems.map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { id?: unknown }).id !== "string" ||
        typeof (entry as { text?: unknown }).text !== "string" ||
        typeof (entry as { rationale?: unknown }).rationale !== "string"
      ) {
        throw new Error("Suggested item did not match the suggestion contract.");
      }

      const { id, text, rationale } = entry as {
        id: string;
        text: string;
        rationale: string;
      };

      return {
        id,
        format: params.chosenFormat,
        angle: params.angle,
        text,
        rationale,
        cooldownStatus: params.cooldownStatus,
        sourceExamplePostIds: params.sourceExamplePostIds,
        generatedBy: "llm",
      } satisfies SuggestedPost;
    });
  }

  private draftInstructions(params: {
    chosenFormat: SuggestFormat;
    angle: SuggestedPost["angle"];
    exampleTexts: string[];
    count: number;
  }): string {
    const examples = params.exampleTexts
      .map((text, index) => `Example ${index + 1}: ${text}`)
      .join("\n");

    const lines = [
      "You are an expert X (Twitter) writer.",
      `Draft posts in the "${params.chosenFormat}" format with a "${params.angle}" angle.`,
      `Produce exactly ${params.count} original draft posts, each at most 280 characters.`,
      "Match the voice and structure of the examples below without repeating them.",
      examples.length > 0
        ? `Style reference from the author's best-performing posts:\n${examples}`
        : "No examples are available; infer the format conventions.",
      "Return only JSON matching the output schema: a suggestions array, each item",
      "with a short id, the draft text, and a one-line rationale (at most 280 chars).",
    ];

    return lines.join("\n");
  }

  private deterministicFallback(
    originals: CanonicalOwnPost[],
    report: CooldownReport,
    count: number,
  ): SuggestedPost[] {
    // Rank every original by its raw reply signal and resurface the strongest,
    // ignoring cooldown (the escape hatch keeps the rail useful when no LLM
    // draft is available).
    const ranked = [...originals]
      .map((post) => ({ post, score: replySignalFor(post) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, count);

    return ranked.map(({ post }, index) => {
      const format = classifyPostFormat(post.text);
      // "other" is excluded from ranking lanes but a resurfaced verbatim post
      // can still classify to it; surface it unchanged with a clear status.
      const suggestFormat = format as SuggestFormat;
      const angle = format === "other" ? DEFAULT_ANGLE : angleFor(suggestFormat);
      const cooldownStatus =
        format === "other" ? "clear" : cooldownStatusFor(report, suggestFormat);

      return {
        id: `fallback-${index}-${post.platformPostId}`,
        format,
        angle,
        text: post.text,
        rationale: FALLBACK_RATIONALE,
        cooldownStatus,
        sourceExamplePostIds: [post.platformPostId],
        generatedBy: "deterministic_fallback",
      } satisfies SuggestedPost;
    });
  }

  private async resolveProviderId(): Promise<string> {
    return typeof this.resolveProvider === "function"
      ? this.resolveProvider()
      : this.resolveProvider;
  }

  // Validate the assembled response against its contract so every returned value
  // is schema-valid before it leaves the service.
  private validate(response: SuggestPostResponse): SuggestPostResponse {
    return suggestPostResponseSchema.parse(response);
  }
}


// The shape the model is asked to return: a suggestions array of { id, text,
// rationale }. The service parser fills the deterministic fields afterward.
const suggestedDraftsSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "rationale"],
        properties: {
          id: { type: "string" },
          text: { type: "string", minLength: 1, maxLength: 8_000 },
          rationale: { type: "string", maxLength: 280 },
        },
      },
    },
  },
};
