import type { VoiceCheck } from "./voice-check.js";

const sentenceStarterProperNouns = new Set([
  "This",
  "That",
  "Nobody",
  "Everyone",
  "Everybody",
  "What",
  "Why",
  "How",
  "Should",
  "Who",
  "When",
  "Where",
  "Which",
  "Also",
  "Plus",
  "Thanks",
  "Activation",
  "Onboarding",
  "Signup",
  "Pricing",
  "Docs",
  "Support",
  "Trial",
  "Invite",
  "Workspace",
  "Email",
  "Emails",
  "Launch",
  "Feature",
  "Flow",
  "Screen",
  "Teardown",
  "Checklist",
]);

function hasNamedExample(text: string): boolean {
  return (text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).some(
    (word) => !sentenceStarterProperNouns.has(word),
  );
}

function hasConcreteAnchor(text: string): boolean {
  return (
    /\d/.test(text) ||
    hasNamedExample(text) ||
    /\b(onboarding|activation|signup|pricing|docs|support|trial|invite|workspace|email|emails|b2b|api|oauth|saas|mrr|arr|launch|shipped|shipping|feature|flow|screen|teardown|checklist|users?|customers?|teams?|founders?|builders?|creators?|makers?|operators?|marketers?)\b/i.test(text)
  );
}

function hasEvidenceMarker(text: string): boolean {
  return (
    /\d/.test(text) ||
    hasNamedExample(text) ||
    /\b(in|after|over|during|from)\s+\d+\b/i.test(text) ||
    /\b(today|yesterday|this week|this month|last week|last month|last year|last quarter)\b/i.test(text) ||
    /\b(i|we)\s+(saw|learned|noticed|tested|shipped|analyzed|measured|found|wrote|built|ran|removed|changed)\b/i.test(text) ||
    /\b(could|might|often|usually|sometimes|tends? to|can|may)\b/i.test(text) ||
    /\bfor\s+(b2b|saas|founders?|builders?|creators?|teams?|users?|customers?)\b/i.test(text)
  );
}

function countUrls(text: string): number {
  return (text.match(/\bhttps?:\/\/[^\s)]+/gi) ?? []).length;
}

function countMentions(text: string): number {
  return (text.match(/(^|[\s(])@[A-Za-z0-9_]{1,15}\b/g) ?? []).length;
}

function hasStackedUnrelatedQuestions(text: string): boolean {
  const questions = text
    .split("?")
    .slice(0, -1)
    .map((part) => part.trim())
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

function createAnswerableQuestionCheck(trimmed: string): VoiceCheck {
  const questionCount = (trimmed.match(/\?/g) ?? []).length;
  const vagueCloser = /\b(thoughts|agree|any advice)\??$/i.test(trimmed);
  const answerablePrompt =
    /\b(which|what|why|how|who|when|where|would you|should we|have you|did you|do you|reply with|share your|tell me|a\/b|profile import or workspace invite)\b/i.test(trimmed) ||
    /\b(or|vs\.?|versus)\b/i.test(trimmed);

  if (hasStackedUnrelatedQuestions(trimmed)) {
    return {
      id: "quality_answerable_question",
      kind: "quality",
      label: "Too many stacked questions - focus on one question",
      status: "fail",
    };
  }

  if (vagueCloser) {
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
      questionCount > 0 && answerablePrompt
        ? "Answerable question with a clear reply path"
        : "No question needed here",
    status: "pass",
  };
}

function createVagueCuriosityCheck(trimmed: string): VoiceCheck {
  const vagueCuriosity =
    /\b(this changed everything|nobody talks about this|no one talks about this|you won't believe|changed everything|this is wild|this matters more than you think)\b/i.test(trimmed);
  const opener = trimmed.split(/[.!?]/)[0] ?? trimmed;
  const hasAnchor = hasConcreteAnchor(opener);

  return {
    id: "quality_vague_curiosity",
    kind: "quality",
    label:
      vagueCuriosity && !hasAnchor
        ? "Vague curiosity - add a concrete anchor"
        : "Curiosity has a specific concrete anchor",
    status: vagueCuriosity && !hasAnchor ? "warn" : "pass",
  };
}

function createStandaloneContextCheck(lines: string[]): VoiceCheck {
  const opener = lines[0]?.trim() ?? "";
  const vagueOpener = /^(this|that|it|they)\s+(changed|is|was|made|matters?|works?|fails?|helped|hurt|means?)\b/i.test(opener);

  return {
    id: "quality_standalone_context",
    kind: "quality",
    label:
      vagueOpener
        ? "Opener needs standalone context or subject"
        : "Opener gives standalone context",
    status: vagueOpener ? "warn" : "pass",
  };
}

function createClaimEvidenceCheck(trimmed: string): VoiceCheck {
  const hasSweepingClaim =
    /\b(always|never|everyone|everybody|nobody|no one|guaranteed|best|only way)\b/i.test(trimmed);
  const hasEvidence = hasEvidenceMarker(trimmed);

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

function createProfileClickReasonCheck(trimmed: string): VoiceCheck {
  const namedExampleWithAction =
    hasNamedExample(trimmed) &&
    /\b(shipped|tested|analyzed|teardown|case study|lesson learned|learned|result|improved|built|launched|changed|removed|showed|shows)\b/i.test(trimmed);
  const authorSpecific =
    /\b(i|we|my|our)\s+(shipped|built|wrote|tested|analyzed|learned|noticed|found|ran|removed|changed|launched|studied)\b/i.test(trimmed) ||
    /\b(my|our)\s+(project|launch|teardown|test|experiment|flow|product|team|users?|customers?)\b/i.test(trimmed) ||
    /\b(teardown|case study|lesson learned)\b/i.test(trimmed) ||
    namedExampleWithAction;
  const genericAdvice =
    /^(you should|write better|provide more value|post every day|start|stop|do this)\b/i.test(trimmed) ||
    /\byou should\b/i.test(trimmed);

  return {
    id: "quality_profile_click_reason",
    kind: "quality",
    label:
      authorSpecific && !genericAdvice
        ? "Author experience gives a reason to inspect the profile"
        : "Generic advice - add a specific author experience or reason",
    status: authorSpecific && !genericAdvice ? "pass" : "warn",
  };
}

function createOneIdeaFocusCheck(trimmed: string): VoiceCheck {
  const pivotCount = (trimmed.match(/\b(also|plus|another thing|one more thing|one more)\b/gi) ?? []).length;
  const bulletCount = (trimmed.match(/^[-*]\s+/gm) ?? []).length;
  const overloaded =
    hasStackedUnrelatedQuestions(trimmed) ||
    pivotCount >= 2 ||
    bulletCount >= 4;

  return {
    id: "quality_one_idea_focus",
    kind: "quality",
    label: overloaded
      ? "Too many pivots - keep one idea in focus"
      : "Single idea stays in focus",
    status: overloaded ? "warn" : "pass",
  };
}

function createLineLengthCheck(lines: string[]): VoiceCheck {
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

function createLinkDensityCheck(trimmed: string): VoiceCheck {
  const urlCount = countUrls(trimmed);

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

function createMentionDensityCheck(trimmed: string, words: number): VoiceCheck {
  const mentionCount = countMentions(trimmed);
  const denseMentions = mentionCount > 2 || (words > 0 && mentionCount / words > 0.18);

  return {
    id: "mention_density",
    kind: "quality",
    label: denseMentions
      ? "Too many mentions - harder to read and scan"
      : "Mention use is restrained and readable",
    status: denseMentions ? "warn" : "pass",
  };
}

export function runTextEnrichmentChecks(input: {
  trimmed: string;
  lines: string[];
  wordCount: number;
}): VoiceCheck[] {
  const { trimmed, lines, wordCount } = input;

  return [
    createAnswerableQuestionCheck(trimmed),
    createVagueCuriosityCheck(trimmed),
    createStandaloneContextCheck(lines),
    createClaimEvidenceCheck(trimmed),
    createProfileClickReasonCheck(trimmed),
    createOneIdeaFocusCheck(trimmed),
    createLineLengthCheck(lines),
    createLinkDensityCheck(trimmed),
    createMentionDensityCheck(trimmed, wordCount),
  ];
}
