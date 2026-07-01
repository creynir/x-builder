import {
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type AnalyzedPostItem,
  type ReplyComposerContext,
} from "@x-builder/shared";

import { stripLeadingReplyTargetHandle } from "../reply-context.js";
import {
  analyzerVersion,
  heuristicLabel,
} from "./deterministic-analysis-constants.js";
import { analyzeDraftText } from "./analyzer.js";
import { sanitizeScoreLearnings } from "./learning-copy.js";
import { deriveApiPostCoach } from "./post-coach-view-model.js";
import { toEngagementPrediction } from "./prediction-view-model.js";
import { detectExternalLink } from "./quality-signal-checks.js";
import type { VoiceCheck } from "./voice-check.js";

const nowIso = (): string => new Date().toISOString();
type AnalyzePost = typeof analyzeDraftText;

const duplicateLeadingTargetHandleCheck: VoiceCheck = {
  id: "reply.duplicate-leading-target-handle",
  kind: "quality",
  label: "Remove duplicate reply target handle",
  status: "warn",
};

const prepareReplyAnalysisText = (
  text: string,
  replyContext?: ReplyComposerContext,
): { status: "ready"; text: string; checks: VoiceCheck[] } | { status: "empty" } => {
  if (replyContext === undefined || replyContext.leadingTargetHandle.state !== "present") {
    return { status: "ready", text, checks: [] };
  }

  const stripped = stripLeadingReplyTargetHandle(text, replyContext, { structuralOnly: true });
  if (!stripped.stripped) {
    return { status: "ready", text, checks: [] };
  }

  const bodyText = stripped.text.trim();
  if (bodyText.length === 0) {
    return { status: "empty" };
  }

  return { status: "ready", text: bodyText, checks: [duplicateLeadingTargetHandleCheck] };
};

export class DeterministicAnalysisService {
  private readonly analyzePost: AnalyzePost;

  constructor(options: { analyzePost?: AnalyzePost } = {}) {
    this.analyzePost = options.analyzePost ?? analyzeDraftText;
  }

  analyzePosts(request: AnalyzePostsRequest): AnalyzePostsResponse {
    const parsedRequest = analyzePostsRequestSchema.parse(request);
    const analyzedAt = nowIso();
    const items = parsedRequest.items.map((item): AnalyzedPostItem => {
      let analysis: ReturnType<AnalyzePost>;
      const prepared = prepareReplyAnalysisText(item.text, item.replyContext);

      if (prepared.status === "empty") {
        return {
          status: "score_failed",
          id: item.id,
          text: item.text,
          sourceFormat: item.sourceFormat,
          reason: "analysis_failed",
          message: "Reply body is empty after removing the structural target handle.",
          retryable: false,
          ...(item.replyContext?.replyThreadContext === undefined
            ? {}
            : {
                replyThreadContext: item.replyContext.replyThreadContext,
                replyThreadContextDiagnostics:
                  item.replyContext.replyThreadContext.replyThreadContextDiagnostics,
              }),
        };
      }

      try {
        analysis = this.analyzePost(prepared.text, {
          followers: parsedRequest.scoringContext.followers,
          trailingMedianImpressions:
            parsedRequest.scoringContext.trailingMedianImpressions,
          repeatHistory: parsedRequest.scoringContext.repeatHistory ?? [],
          hasExternalLink: detectExternalLink(prepared.text),
          plannedHourUtc: parsedRequest.scoringContext.plannedHourUtc,
          willAttachMedia: parsedRequest.scoringContext.willAttachMedia,
          accountAgeYears: parsedRequest.scoringContext.accountAgeYears,
          // Pass-2: a judged scoringContext threads judgeSignals into the reach
          // model's judged-quality branch. Absent (pass-1) -> static quality.
          ...(parsedRequest.scoringContext.judgeSignals !== undefined
            ? { judgeSignals: parsedRequest.scoringContext.judgeSignals }
            : {}),
        });
      } catch (error) {
        console.error("[deterministic-analysis] failed to score candidate", {
          id: item.id,
          error,
        });
        return {
          status: "score_failed",
          id: item.id,
          text: item.text,
          sourceFormat: item.sourceFormat,
          reason: "analysis_failed",
          message: "This candidate could not be scored. Try again.",
          retryable: true,
          ...(item.replyContext?.replyThreadContext === undefined
            ? {}
            : {
                replyThreadContext: item.replyContext.replyThreadContext,
                replyThreadContextDiagnostics:
                  item.replyContext.replyThreadContext.replyThreadContextDiagnostics,
              }),
        };
      }

      const sanitizedScore = sanitizeScoreLearnings(analysis.score);
      const score = prepared.checks.length === 0
        ? sanitizedScore
        : { ...sanitizedScore, checks: [...prepared.checks, ...sanitizedScore.checks] };
      const postCoach = deriveApiPostCoach({
        score,
        text: prepared.text,
        mode: parsedRequest.presentation.postCoachMode,
      });
      const prediction = toEngagementPrediction({
        analyzerPrediction: analysis.prediction,
        followers: parsedRequest.scoringContext.followers,
        trailingMedianImpressions:
          parsedRequest.scoringContext.trailingMedianImpressions,
      });

      return {
        status: "scored",
        id: item.id,
        text: item.text,
        sourceFormat: item.sourceFormat,
        detectedFormat: analysis.format,
        score,
        postCoach,
        prediction,
        heuristicLabel,
        analyzedAt,
        analyzerVersion,
        ...(item.replyContext?.replyThreadContext === undefined
          ? {}
          : {
              replyThreadContext: item.replyContext.replyThreadContext,
              replyThreadContextDiagnostics:
                item.replyContext.replyThreadContext.replyThreadContextDiagnostics,
            }),
      };
    });

    return analyzePostsResponseSchema.parse({ items });
  }
}
