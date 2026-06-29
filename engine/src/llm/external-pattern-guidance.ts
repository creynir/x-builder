import type { DetectedPostFormat, ExternalXSignalPattern } from "@x-builder/shared";

import type { GenerationGuidanceRequest } from "./generation-guidance.js";

const EXTERNAL_PATTERN_GUIDANCE_HEADER =
  "# External performance patterns (derived constraints, not voice)";
const EXTERNAL_PATTERN_GUIDANCE_INTRO =
  "Use these as weak writing constraints from external performance patterns, not author voice.";
const DEFAULT_EXTERNAL_PATTERN_LIMIT = 4;
const DEFAULT_EXTERNAL_PATTERN_GUIDANCE_CHAR_LIMIT = 1_200;

export type ExternalPatternGuidanceRequest = GenerationGuidanceRequest & {
  maxPatterns?: number;
  minConfidence?: number;
  minSupportCount?: number;
};

export type ExternalPatternGuidanceItem = {
  id: string;
  patternType: ExternalXSignalPattern["patternType"];
  format?: DetectedPostFormat;
  statement: string;
  confidence: number;
  supportCount: number;
  generatedAt: string;
  version: string;
};

export type ExternalPatternGuidanceProvider = (
  request: ExternalPatternGuidanceRequest,
) => Promise<ExternalPatternGuidanceItem[]>;

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, " ").trim();

const buildMetadata = (item: ExternalPatternGuidanceItem): string => {
  const metadata = [
    `pattern type: ${item.patternType}`,
    `confidence: ${item.confidence}`,
    `supportCount: ${item.supportCount}`,
  ];

  if (item.format !== undefined) {
    metadata.splice(1, 0, `format: ${item.format}`);
  }

  return metadata.join("; ");
};

const truncateToBudget = (content: string, maxLength: number): string =>
  content.length > maxLength ? content.slice(0, maxLength).trimEnd() : content;

export const renderExternalPatternGuidance = (
  items: ExternalPatternGuidanceItem[],
): string | undefined => {
  if (items.length === 0) {
    return undefined;
  }

  const lines = [
    EXTERNAL_PATTERN_GUIDANCE_HEADER,
    EXTERNAL_PATTERN_GUIDANCE_INTRO,
  ];

  for (const item of items.slice(0, DEFAULT_EXTERNAL_PATTERN_LIMIT)) {
    lines.push(`- ${normalizeInlineText(item.statement)}`);
    lines.push(`  metadata: ${buildMetadata(item)}`);
  }

  return truncateToBudget(lines.join("\n"), DEFAULT_EXTERNAL_PATTERN_GUIDANCE_CHAR_LIMIT);
};
