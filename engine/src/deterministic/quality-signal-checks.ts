import type { VoiceCheck } from "./voice-check.js";

const namedExamplePattern =
  /\b(?:Acme|Stripe|GitHub|Linear|Notion|Slack|Figma|Vercel|Supabase|OpenAI|ChatGPT|Claude|Shopify)\b/;

function containsNamedExample(text: string): boolean {
  return namedExamplePattern.test(text);
}

function containsConcreteAnchor(text: string): boolean {
  return (
    /\d/.test(text) ||
    containsNamedExample(text) ||
    /\b(onboarding|activation|signup|pricing|docs|support|trial|invite|workspace|email|emails|b2b|api|oauth|saas|mrr|arr|launch|shipped|shipping|feature|flow|screen|teardown|checklist|users?|customers?|teams?|founders?|builders?|creators?|makers?|operators?|marketers?)\b/i.test(text)
  );
}

function containsEvidenceMarker(text: string): boolean {
  return (
    /\b\d+(?:[.,]\d+)?\b/.test(text) ||
    containsNamedExample(text) ||
    /\b(in|after|over|during|from)\s+\d+\b/i.test(text) ||
    /\b(today|yesterday|this week|this month|last week|last month|last year|last quarter)\b/i.test(text) ||
    /\b(i|we)\s+(saw|learned|noticed|tested|shipped|analyzed|measured|found|wrote|built|ran|removed|changed)\b/i.test(text) ||
    /\b(could|might|often|usually|sometimes|tends? to|can|may)\b/i.test(text)
  );
}

function countUrls(text: string): number {
  return (text.match(/\bhttps?:\/\/[^\s)]+/gi) ?? []).length;
}

function countMentions(text: string): number {
  return (text.match(/(^|[\s(])@[A-Za-z0-9_]{1,15}\b/g) ?? []).length;
}

function hasStackedQuestionPrompts(text: string): boolean {
  const questions = text
    .split("?")
    .slice(0, -1)
    .map((questionPrefix) => questionPrefix.trim())
    .filter(Boolean);

  if (questions.length >= 4) {
    return true;
  }

  const questionOpeners = new Set(
    questions
      .map((question) => /\b(what|why|how|should|who|when|where|which|does|do|did|is|are|can|would|will)\b/i.exec(question)?.[1]?.toLowerCase())
      .filter(Boolean),
  );

  return questions.length >= 3 && questionOpeners.size >= 3;
}

function evaluateAnswerableQuestion(trimmedText: string): VoiceCheck {
  const questionCount = (trimmedText.match(/\?/g) ?? []).length;
  const hasVagueCloser = /\b(thoughts|agree|any advice)\??$/i.test(trimmedText);
  const hasAnswerablePrompt =
    /\b(which|what|why|how|who|when|where|would you|should we|have you|did you|do you|reply with|share your|tell me|a\/b|profile import or workspace invite)\b/i.test(trimmedText) ||
    /\b(or|vs\.?|versus)\b/i.test(trimmedText);

  if (hasStackedQuestionPrompts(trimmedText)) {
    return {
      id: "quality_answerable_question",
      kind: "quality",
      label: "Too many stacked questions - focus on one question",
      status: "fail",
    };
  }

  if (hasVagueCloser) {
    return {
      id: "quality_answerable_question",
      kind: "quality",
      label: "Vague question - make the answer or reply more specific",
      status: "warn",
    };
  }

  return {
    id: "quality_answerable_question",
    kind: "quality",
    label:
      questionCount > 0 && hasAnswerablePrompt
        ? "Answerable question with a clear reply path"
        : "No question needed here",
    status: "pass",
  };
}

function evaluateVagueCuriosity(trimmedText: string): VoiceCheck {
  const hasVagueCuriosity =
    /\b(this changed everything|nobody talks about this|no one talks about this|you won't believe|changed everything|this is wild|this matters more than you think)\b/i.test(trimmedText);
  const opener = trimmedText.split(/[.!?]/)[0] ?? trimmedText;
  const hasAnchor = containsConcreteAnchor(opener);

  return {
    id: "quality_vague_curiosity",
    kind: "quality",
    label:
      hasVagueCuriosity && !hasAnchor
        ? "Vague curiosity - add a concrete anchor"
        : "Curiosity has a specific concrete anchor",
    status: hasVagueCuriosity && !hasAnchor ? "warn" : "pass",
  };
}

function evaluateStandaloneContext(lines: string[]): VoiceCheck {
  const opener = lines[0]?.trim() ?? "";
  const hasVagueOpener = /^(this|that|it|they)\s+(changed|is|was|made|matters?|works?|fails?|helped|hurt|means?)\b/i.test(opener);

  return {
    id: "quality_standalone_context",
    kind: "quality",
    label:
      hasVagueOpener
        ? "Opener needs standalone context or subject"
        : "Opener gives standalone context",
    status: hasVagueOpener ? "warn" : "pass",
  };
}

function evaluateClaimEvidence(trimmedText: string): VoiceCheck {
  const hasSweepingClaim =
    /\b(always|never|everyone|everybody|nobody|no one|guaranteed|best|only way)\b/i.test(trimmedText);
  const hasEvidence = containsEvidenceMarker(trimmedText);

  return {
    id: "quality_claim_evidence",
    kind: "quality",
    label:
      hasSweepingClaim && !hasEvidence
        ? "Sweeping claim needs evidence or proof"
        : "Claim has specific evidence or softer framing",
    status: hasSweepingClaim && !hasEvidence ? "warn" : "pass",
  };
}

function evaluateProfileClickReason(trimmedText: string): VoiceCheck {
  const namedExampleWithAction =
    containsNamedExample(trimmedText) &&
    /\b(shipped|tested|analyzed|teardown|case study|lesson learned|learned|result|improved|built|launched|changed|removed|showed|shows)\b/i.test(trimmedText);
  const hasAuthorSpecificProof =
    /\b(i|we|my|our)\s+(shipped|built|wrote|tested|analyzed|learned|noticed|found|ran|removed|changed|launched|studied)\b/i.test(trimmedText) ||
    /\b(my|our)\s+(project|launch|teardown|test|experiment|flow|product|team|users?|customers?)\b/i.test(trimmedText) ||
    /\b(teardown|case study|lesson learned)\b/i.test(trimmedText) ||
    namedExampleWithAction;
  const hasGenericAdvice =
    /^(you should|write better|provide more value|post every day|start|stop|do this)\b/i.test(trimmedText) ||
    /\byou should\b/i.test(trimmedText);

  return {
    id: "quality_profile_click_reason",
    kind: "quality",
    label:
      hasAuthorSpecificProof && !hasGenericAdvice
        ? "Author experience gives a reason to inspect the profile"
        : "Generic advice - add a specific author experience or reason",
    status: hasAuthorSpecificProof && !hasGenericAdvice ? "pass" : "warn",
  };
}

function evaluateOneIdeaFocus(trimmedText: string): VoiceCheck {
  const pivotCount = (trimmedText.match(/\b(also|plus|another thing|one more thing|one more)\b/gi) ?? []).length;
  const bulletCount = (trimmedText.match(/^[-*]\s+/gm) ?? []).length;
  const isOverloaded =
    hasStackedQuestionPrompts(trimmedText) ||
    pivotCount >= 2 ||
    bulletCount >= 4;

  return {
    id: "quality_one_idea_focus",
    kind: "quality",
    label: isOverloaded
      ? "Too many pivots - keep one idea in focus"
      : "Single idea stays in focus",
    status: isOverloaded ? "warn" : "pass",
  };
}

function evaluateLineLength(lines: string[]): VoiceCheck {
  const denseLine = lines.find((line) => line.trim().length >= 180);

  return {
    id: "line_length",
    kind: "quality",
    label: denseLine
      ? "Dense line - add a break for easier scanning"
      : "Line length scans cleanly",
    status: denseLine ? "warn" : "pass",
  };
}

function evaluateLinkDensity(trimmedText: string): VoiceCheck {
  const urlCount = countUrls(trimmedText);

  return {
    id: "link_density",
    kind: "quality",
    label:
      urlCount >= 2
        ? "Too many links - link-heavy post"
        : urlCount === 1
          ? "External link present - make the post useful without the click"
          : "No link friction - self-contained post",
    status: urlCount >= 2 ? "fail" : urlCount === 1 ? "warn" : "pass",
  };
}

function evaluateMentionDensity(trimmedText: string, wordCount: number): VoiceCheck {
  const mentionCount = countMentions(trimmedText);
  const hasDenseMentions = mentionCount > 2 || (wordCount > 0 && mentionCount / wordCount > 0.18);

  return {
    id: "mention_density",
    kind: "quality",
    label: hasDenseMentions
      ? "Too many mentions - harder to read and scan"
      : "Mention density is readable",
    status: hasDenseMentions ? "warn" : "pass",
  };
}

export function evaluateQualitySignalChecks(input: {
  trimmed: string;
  lines: string[];
  wordCount: number;
}): VoiceCheck[] {
  return [
    evaluateAnswerableQuestion(input.trimmed),
    evaluateVagueCuriosity(input.trimmed),
    evaluateStandaloneContext(input.lines),
    evaluateClaimEvidence(input.trimmed),
    evaluateProfileClickReason(input.trimmed),
    evaluateOneIdeaFocus(input.trimmed),
    evaluateLineLength(input.lines),
    evaluateLinkDensity(input.trimmed),
    evaluateMentionDensity(input.trimmed, input.wordCount),
  ];
}
