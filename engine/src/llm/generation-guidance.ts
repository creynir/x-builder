import { readFile, stat } from "node:fs/promises";
import type { DetectedPostFormat, ReplyComposerContext } from "@x-builder/shared";

import type { CanonicalOwnPost, PostLibraryRepository } from "../server/post-library-repository.js";
import type { AppSettingsRepository } from "../server/settings-repository.js";
import type { GeneratedReplyLedgerRepository } from "../generated-replies/generated-reply-ledger-repository.js";
import type {
  ArchiveVoiceProfile,
  ArchiveVoiceProfileProvider,
} from "../voice/archive-voice-profile-service.js";
import {
  renderExternalPatternGuidance,
  type ExternalPatternGuidanceProvider,
} from "./external-pattern-guidance.js";

export type { ArchiveVoiceProfile } from "../voice/archive-voice-profile-service.js";

const PLAYBOOK_SLICE_CHAR_LIMIT = 6_000;
const KNOWLEDGE_BASE_FILE_BYTE_LIMIT = 256_000;
const VOICE_SAMPLE_LIMIT = 5;
const KNOWN_POST_ID_LIMIT = 25;
const VOICE_SAMPLE_GUIDANCE_CHAR_LIMIT = 2_400;
const PLAYBOOK_GUIDANCE_HEADER = "# Requested format playbook";
const ARCHIVE_VOICE_PROFILE_GUIDANCE_HEADER =
  "# Archive voice profile (derived from local corpus)";
const VOICE_SAMPLE_GUIDANCE_HEADER = "# Voice samples (match tone, do not copy)";
const FOUNDER_STORY_GUARDRAIL =
  "Founder-story guardrail: never invent, suggest, or prompt emotional content; only preserve stakes the user supplied.";

export type GenerationGuidanceRequest = {
  format: DetectedPostFormat;
  idea?: string;
  voiceProfileId?: string;
  useKnownPostIds: string[];
  replyContext?: ReplyComposerContext;
};

export type FormatPlaybookMapping = Readonly<
  Record<
    DetectedPostFormat,
    {
      sectionIds: string[];
      priority: "primary" | "secondary";
      includeFallbackGeneral: boolean;
    }
  >
>;

export type PlaybookSlice = {
  format: DetectedPostFormat;
  sourcePath?: string;
  sections: Array<{
    id: string;
    heading: string;
    content: string;
    charCount: number;
  }>;
  content: string;
  charCount: number;
  truncated: boolean;
};

export type VoiceSamplePost = {
  id: string;
  platformPostId: string;
  text: string;
  createdAt: string;
  kind: "original";
  source: "known_post_id" | "profile_sample" | "voice_rag" | "recent_original";
};

export type SelectVoiceSamplesInput = {
  postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
  generatedReplyLedgerRepository?: Pick<GeneratedReplyLedgerRepository, "isGeneratedReplyText">;
  useKnownPostIds?: string[];
  voiceProfileId?: string;
};

export type RenderedVoiceSamples = {
  content: string;
  charCount: number;
  truncated: boolean;
};

export type RenderedArchiveVoiceProfile = {
  content: string;
  charCount: number;
  truncated: boolean;
};

export type CreateGenerationGuidanceResolverInput = {
  settingsRepository: Pick<AppSettingsRepository, "load">;
  postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
  generatedReplyLedgerRepository?: Pick<GeneratedReplyLedgerRepository, "isGeneratedReplyText">;
  externalPatternGuidanceProvider?: ExternalPatternGuidanceProvider;
  archiveVoiceProfileProvider?: ArchiveVoiceProfileProvider;
  voiceSampleProvider?: VoiceSampleProvider;
  defaultKnowledgeBasePath?: string;
};

export type VoiceRetrievalRequest = GenerationGuidanceRequest & {
  limit?: number;
};

export type VoiceRetrievalSample = VoiceSamplePost & {
  source: "known_post_id" | "voice_rag" | "recent_original";
  score?: number;
  indexedAt?: string;
};

export type VoiceSampleProvider = (
  request: VoiceRetrievalRequest,
) => Promise<VoiceRetrievalSample[]>;

export type GenerationContext = {
  request: GenerationGuidanceRequest;
  playbook: PlaybookSlice;
  archiveVoiceProfile?: ArchiveVoiceProfile;
  voiceSamples: VoiceSamplePost[];
  renderedGuidance?: string;
};

export type GenerationGuidanceResolver = (
  request: GenerationGuidanceRequest,
) => Promise<string | undefined>;

export type ResolvePlaybookSliceInput = {
  format: DetectedPostFormat;
  knowledgeBasePath?: string;
};

type FounderStoryGuardrail = {
  preserveUserSuppliedStakes: true;
  forbidInventedEmotionalContent: true;
};

type FormatPlaybookMappingWithMetadata = FormatPlaybookMapping & {
  readonly founder_story: FormatPlaybookMapping["founder_story"] & {
    readonly founderStoryGuardrail: FounderStoryGuardrail;
  };
};

const baseFormatPlaybookMapping = {
  genuine_question: {
    sectionIds: ["format-taxonomy", "growth-loop", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  hot_take: {
    sectionIds: ["format-taxonomy", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  audience_question: {
    sectionIds: ["format-taxonomy", "growth-loop", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  story: {
    sectionIds: ["format-taxonomy", "core-finding", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  founder_story: {
    sectionIds: ["founder-story", "format-taxonomy", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  insight_share: {
    sectionIds: ["format-taxonomy", "core-finding", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  ab_choice: {
    sectionIds: ["format-taxonomy", "growth-loop"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  connect: {
    sectionIds: ["format-taxonomy", "growth-loop", "graph-quality"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  other: {
    sectionIds: ["general"],
    priority: "secondary",
    includeFallbackGeneral: true,
  },
  fill_blank_tribal: {
    sectionIds: ["format-taxonomy", "core-finding", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  cta_farm: {
    sectionIds: ["format-taxonomy", "growth-loop", "graph-quality"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  fantasy_question: {
    sectionIds: ["format-taxonomy", "growth-loop"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  binary_choice: {
    sectionIds: ["format-taxonomy", "growth-loop"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  nuanced_question: {
    sectionIds: ["format-taxonomy", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  recognition_roast: {
    sectionIds: ["format-taxonomy", "core-finding", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  wisdom_one_liner: {
    sectionIds: ["format-taxonomy", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  milestone: {
    sectionIds: ["format-taxonomy", "growth-loop", "graph-quality"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
} as const satisfies FormatPlaybookMapping;

export const formatPlaybookMapping = {
  ...baseFormatPlaybookMapping,
  founder_story: {
    ...baseFormatPlaybookMapping.founder_story,
    founderStoryGuardrail: {
      preserveUserSuppliedStakes: true,
      forbidInventedEmotionalContent: true,
    },
  },
} as const satisfies FormatPlaybookMappingWithMetadata;

type ParsedPlaybookSection = {
  id: string;
  heading: string;
  content: string;
};

type MarkdownHeading = {
  lineIndex: number;
  level: number;
  heading: string;
};

type VoiceSampleSource = VoiceSamplePost["source"];

type SortableVoicePost = {
  post: CanonicalOwnPost;
  timestamp: number | undefined;
};

const isUsableVoicePost = (post: CanonicalOwnPost): boolean =>
  post.kind === "original" && typeof post.text === "string" && post.text.trim().length > 0;

const postCreatedAt = (post: CanonicalOwnPost): string => {
  const createdAt = (post as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "string" ? createdAt : "";
};

const parsedCreatedAt = (post: CanonicalOwnPost): number | undefined => {
  const createdAt = postCreatedAt(post);
  const timestamp = Date.parse(createdAt);

  return Number.isNaN(timestamp) ? undefined : timestamp;
};

const compareVoicePosts = (left: SortableVoicePost, right: SortableVoicePost): number => {
  if (left.timestamp !== undefined && right.timestamp !== undefined) {
    if (left.timestamp !== right.timestamp) {
      return right.timestamp - left.timestamp;
    }

    return left.post.id.localeCompare(right.post.id);
  }

  if (left.timestamp !== undefined) {
    return -1;
  }

  if (right.timestamp !== undefined) {
    return 1;
  }

  return left.post.id.localeCompare(right.post.id);
};

const toVoiceSamplePost = (post: CanonicalOwnPost, source: VoiceSampleSource): VoiceSamplePost => ({
  id: post.id,
  platformPostId: post.platformPostId,
  text: post.text,
  createdAt: postCreatedAt(post),
  kind: "original",
  source,
});

export const selectVoiceSamples = async (
  input: SelectVoiceSamplesInput,
): Promise<VoiceSamplePost[]> => {
  let posts: CanonicalOwnPost[];
  try {
    posts = (await input.postLibraryRepository.loadStore()).posts;
  } catch {
    return [];
  }

  const usableCandidates = posts.filter(isUsableVoicePost);
  const candidates =
    input.generatedReplyLedgerRepository === undefined
      ? usableCandidates
      : (
          await Promise.all(
            usableCandidates.map(async (post) =>
              (await input.generatedReplyLedgerRepository!.isGeneratedReplyText(post.text))
                ? undefined
                : post,
            ),
          )
        ).filter((post): post is CanonicalOwnPost => post !== undefined);
  if (candidates.length === 0) {
    return [];
  }

  const selected: VoiceSamplePost[] = [];
  const selectedIds = new Set<string>();
  const candidatesByKnownId = new Map<string, CanonicalOwnPost>();

  for (const candidate of candidates) {
    if (!candidatesByKnownId.has(candidate.id)) {
      candidatesByKnownId.set(candidate.id, candidate);
    }
    if (!candidatesByKnownId.has(candidate.platformPostId)) {
      candidatesByKnownId.set(candidate.platformPostId, candidate);
    }
  }

  for (const knownPostId of (input.useKnownPostIds ?? []).slice(0, KNOWN_POST_ID_LIMIT)) {
    if (selected.length >= VOICE_SAMPLE_LIMIT) {
      break;
    }

    const match = candidatesByKnownId.get(knownPostId);
    if (match === undefined || selectedIds.has(match.id)) {
      continue;
    }

    selected.push(toVoiceSamplePost(match, "known_post_id"));
    selectedIds.add(match.id);
  }

  const fallbackPosts = candidates
    .filter((post) => !selectedIds.has(post.id))
    .map((post) => ({ post, timestamp: parsedCreatedAt(post) }))
    .sort(compareVoicePosts);

  for (const { post } of fallbackPosts) {
    if (selected.length >= VOICE_SAMPLE_LIMIT) {
      break;
    }

    selected.push(toVoiceSamplePost(post, "recent_original"));
    selectedIds.add(post.id);
  }

  return selected;
};

export const renderVoiceSampleGuidance = (samples: VoiceSamplePost[]): RenderedVoiceSamples => {
  if (samples.length === 0) {
    return {
      content: "",
      charCount: 0,
      truncated: false,
    };
  }

  const rendered = samples
    .map((sample) => `- ${sample.text.replace(/\s+/g, " ").trim()}`)
    .join("\n");
  const truncated = rendered.length > VOICE_SAMPLE_GUIDANCE_CHAR_LIMIT;
  const content = truncated ? rendered.slice(0, VOICE_SAMPLE_GUIDANCE_CHAR_LIMIT) : rendered;

  return {
    content,
    charCount: content.length,
    truncated,
  };
};

const renderRuleList = (label: string, rules: string[]): string[] => {
  if (rules.length === 0) {
    return [];
  }

  return [`${label}:`, ...rules.map((rule) => `- ${rule.replace(/\s+/g, " ").trim()}`)];
};

export const renderArchiveVoiceProfileGuidance = (
  profile: ArchiveVoiceProfile | undefined,
  request: GenerationGuidanceRequest,
): RenderedArchiveVoiceProfile => {
  if (profile === undefined) {
    return {
      content: "",
      charCount: 0,
      truncated: false,
    };
  }

  const surface = request.replyContext === undefined ? "post" : "reply";
  const surfaceRules = surface === "reply" ? profile.replyRules : profile.postRules;
  const lines = [
    `Profile: ${profile.profileId}`,
    `Evidence: ${profile.sourceCounts.posts} originals, ${profile.sourceCounts.replies} replies from the local authored corpus.`,
    "Use these as stable voice rules; do not copy evidence examples.",
    `Summary: ${profile.summary.replace(/\s+/g, " ").trim()}`,
    ...renderRuleList("Syntax habits", profile.syntaxHabits),
    ...renderRuleList("Tone boundaries", profile.toneBoundaries),
    ...renderRuleList("Recurring moves", profile.recurringMoves),
    ...renderRuleList("Anti-patterns", profile.antiPatterns),
    ...renderRuleList(surface === "reply" ? "Reply-specific rules" : "Post-specific rules", surfaceRules),
  ];
  const rendered = lines.join("\n");
  const truncated = rendered.length > VOICE_SAMPLE_GUIDANCE_CHAR_LIMIT;
  const content = truncated ? rendered.slice(0, VOICE_SAMPLE_GUIDANCE_CHAR_LIMIT).trimEnd() : rendered;

  return {
    content,
    charCount: content.length,
    truncated,
  };
};

const resolveKnowledgeBasePath = async (
  settingsRepository: Pick<AppSettingsRepository, "load">,
  defaultKnowledgeBasePath?: string,
): Promise<string | undefined> => {
  try {
    const { settings } = await settingsRepository.load();
    const rawKnowledgeBasePath = (settings as { knowledgeBasePath?: unknown }).knowledgeBasePath;
    const knowledgeBasePath =
      typeof rawKnowledgeBasePath === "string" ? rawKnowledgeBasePath.trim() : undefined;

    return knowledgeBasePath === undefined || knowledgeBasePath.length === 0
      ? defaultKnowledgeBasePath
      : knowledgeBasePath;
  } catch {
    return defaultKnowledgeBasePath;
  }
};

const renderGenerationGuidance = (
  request: GenerationGuidanceRequest,
  playbook: PlaybookSlice,
  renderedExternalPatternGuidance: string | undefined,
  renderedArchiveVoiceProfile: RenderedArchiveVoiceProfile,
  renderedVoiceSamples: RenderedVoiceSamples,
): string | undefined => {
  const sections: string[] = [];

  if (playbook.content.length > 0) {
    sections.push(`${PLAYBOOK_GUIDANCE_HEADER}\n${playbook.content}`);
  }

  if (renderedExternalPatternGuidance !== undefined) {
    sections.push(renderedExternalPatternGuidance);
  }

  if (renderedArchiveVoiceProfile.content.length > 0) {
    sections.push(`${ARCHIVE_VOICE_PROFILE_GUIDANCE_HEADER}\n${renderedArchiveVoiceProfile.content}`);
  }

  if (renderedVoiceSamples.content.length > 0) {
    sections.push(`${VOICE_SAMPLE_GUIDANCE_HEADER}\n${renderedVoiceSamples.content}`);
  }

  if (sections.length === 0) {
    return undefined;
  }

  if (request.format === "founder_story") {
    sections.push(FOUNDER_STORY_GUARDRAIL);
  }

  return sections.join("\n\n");
};

const resolveArchiveVoiceProfile = async (
  provider: ArchiveVoiceProfileProvider | undefined,
  request: GenerationGuidanceRequest,
): Promise<ArchiveVoiceProfile | undefined> => {
  if (provider === undefined) {
    return undefined;
  }

  try {
    return await provider({
      surface: request.replyContext === undefined ? "post" : "reply",
    });
  } catch {
    return undefined;
  }
};

const resolveExternalPatternGuidance = async (
  provider: ExternalPatternGuidanceProvider | undefined,
  request: GenerationGuidanceRequest,
): Promise<string | undefined> => {
  if (provider === undefined) {
    return undefined;
  }

  try {
    return renderExternalPatternGuidance(await provider(request));
  } catch {
    return undefined;
  }
};

const resolveVoiceSamples = async (
  input: CreateGenerationGuidanceResolverInput,
  request: GenerationGuidanceRequest,
): Promise<VoiceSamplePost[]> => {
  if (input.voiceSampleProvider !== undefined) {
    try {
      const samples = await input.voiceSampleProvider(request);
      if (samples.length > 0) {
        return samples;
      }
    } catch {
      // Fall through to the existing fail-open repository selector.
    }
  }

  return selectVoiceSamples({
    postLibraryRepository: input.postLibraryRepository,
    ...(input.generatedReplyLedgerRepository === undefined
      ? {}
      : { generatedReplyLedgerRepository: input.generatedReplyLedgerRepository }),
    useKnownPostIds: request.useKnownPostIds,
    voiceProfileId: request.voiceProfileId,
  });
};

export const createGenerationGuidanceResolver = (
  input: CreateGenerationGuidanceResolverInput,
): GenerationGuidanceResolver => {
  return async (request) => {
    try {
      const knowledgeBasePath = await resolveKnowledgeBasePath(
        input.settingsRepository,
        input.defaultKnowledgeBasePath,
      );
      const [playbook, archiveVoiceProfile, voiceSamples, externalPatternGuidance] = await Promise.all([
        resolvePlaybookSlice({
          format: request.format,
          knowledgeBasePath,
        }),
        resolveArchiveVoiceProfile(input.archiveVoiceProfileProvider, request),
        resolveVoiceSamples(input, request),
        resolveExternalPatternGuidance(input.externalPatternGuidanceProvider, request),
      ]);

      return renderGenerationGuidance(
        request,
        playbook,
        externalPatternGuidance,
        renderArchiveVoiceProfileGuidance(archiveVoiceProfile, request),
        renderVoiceSampleGuidance(voiceSamples),
      );
    } catch {
      return undefined;
    }
  };
};

const emptyPlaybookSlice = (input: ResolvePlaybookSliceInput): PlaybookSlice => ({
  format: input.format,
  ...(input.knowledgeBasePath === undefined ? {} : { sourcePath: input.knowledgeBasePath }),
  sections: [],
  content: "",
  charCount: 0,
  truncated: false,
});

const normalizeSectionId = (heading: string): string => {
  const normalized = heading
    .trim()
    .replace(/^\d+\.\s*/, "")
    .replaceAll("_", "-")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized === "founder-story-is-real-but-amplifier-gated") {
    return "founder-story";
  }

  return normalized;
};

const parseMarkdownHeadings = (markdown: string): MarkdownHeading[] => {
  const lines = markdown.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

  lines.forEach((line, lineIndex) => {
    const match = headingPattern.exec(line);
    const marker = match?.[1];
    const heading = match?.[2];
    if (marker === undefined || heading === undefined) {
      return;
    }

    headings.push({
      lineIndex,
      level: marker.length,
      heading: heading.trim(),
    });
  });

  return headings;
};

const parsePlaybookSections = (markdown: string): Map<string, ParsedPlaybookSection> => {
  const lines = markdown.split(/\r?\n/);
  const headings = parseMarkdownHeadings(markdown);
  const sections = new Map<string, ParsedPlaybookSection>();

  headings.forEach((heading, headingIndex) => {
    const id = normalizeSectionId(heading.heading);
    if (id.length === 0 || sections.has(id)) {
      return;
    }

    const nextPeerOrParent = headings
      .slice(headingIndex + 1)
      .find((candidate) => candidate.level <= heading.level);
    const endLineIndex = nextPeerOrParent?.lineIndex ?? lines.length;
    const content = lines.slice(heading.lineIndex + 1, endLineIndex).join("\n").trim();

    sections.set(id, {
      id,
      heading: heading.heading,
      content,
    });
  });

  return sections;
};

const renderPlaybookSection = (section: ParsedPlaybookSection, content: string): string =>
  content.length === 0 ? `## ${section.heading}` : `## ${section.heading}\n\n${content}`;

const appendRenderedSection = (
  currentContent: string,
  section: ParsedPlaybookSection,
): {
  content: string;
  sectionContent: string;
  truncated: boolean;
} => {
  const separator = currentContent.length === 0 ? "" : "\n\n";
  const fullSection = renderPlaybookSection(section, section.content);
  const fullContent = `${currentContent}${separator}${fullSection}`;

  if (fullContent.length <= PLAYBOOK_SLICE_CHAR_LIMIT) {
    return {
      content: fullContent,
      sectionContent: section.content,
      truncated: false,
    };
  }

  const remainingBudget = PLAYBOOK_SLICE_CHAR_LIMIT - currentContent.length - separator.length;
  if (remainingBudget <= 0) {
    return {
      content: currentContent,
      sectionContent: "",
      truncated: true,
    };
  }

  const sectionPrefix = section.content.length === 0 ? `## ${section.heading}` : `## ${section.heading}\n\n`;
  if (sectionPrefix.length >= remainingBudget) {
    return {
      content: `${currentContent}${separator}${sectionPrefix.slice(0, remainingBudget).trimEnd()}`,
      sectionContent: "",
      truncated: true,
    };
  }

  const sectionContent = section.content.slice(0, remainingBudget - sectionPrefix.length).trimEnd();

  return {
    content: `${currentContent}${separator}${sectionPrefix}${sectionContent}`,
    sectionContent,
    truncated: true,
  };
};

const readKnowledgeBaseMarkdown = async (knowledgeBasePath: string): Promise<string | undefined> => {
  try {
    const stats = await stat(knowledgeBasePath);
    if (!stats.isFile() || stats.size > KNOWLEDGE_BASE_FILE_BYTE_LIMIT) {
      return undefined;
    }

    return await readFile(knowledgeBasePath, "utf8");
  } catch {
    return undefined;
  }
};

export const resolvePlaybookSlice = async (
  input: ResolvePlaybookSliceInput,
): Promise<PlaybookSlice> => {
  if (input.knowledgeBasePath === undefined) {
    return emptyPlaybookSlice(input);
  }

  const markdown = await readKnowledgeBaseMarkdown(input.knowledgeBasePath);
  if (markdown === undefined) {
    return emptyPlaybookSlice(input);
  }

  if (markdown.trim().length === 0) {
    return emptyPlaybookSlice(input);
  }

  const parsedSections = parsePlaybookSections(markdown);
  const mappedSectionIds = formatPlaybookMapping[input.format].sectionIds;
  const selectedSections = mappedSectionIds
    .map((sectionId) => parsedSections.get(sectionId))
    .filter((section): section is ParsedPlaybookSection => section !== undefined);

  if (selectedSections.length === 0) {
    return emptyPlaybookSlice(input);
  }

  const sections: PlaybookSlice["sections"] = [];
  let content = "";
  let truncated = false;

  for (const section of selectedSections) {
    const appended = appendRenderedSection(content, section);
    if (appended.truncated && appended.sectionContent.length === 0 && appended.content === content) {
      truncated = true;
      break;
    }

    content = appended.content;
    sections.push({
      id: section.id,
      heading: section.heading,
      content: appended.sectionContent,
      charCount: appended.sectionContent.length,
    });

    if (appended.truncated) {
      truncated = true;
      break;
    }
  }

  if (sections.length === 0) {
    return emptyPlaybookSlice(input);
  }

  return {
    format: input.format,
    sourcePath: input.knowledgeBasePath,
    sections,
    content,
    charCount: content.length,
    truncated,
  };
};
