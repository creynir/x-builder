import type { DetectedPostFormat, ExternalXSignalPattern } from "@x-builder/shared";

import type { ListGenerationPatternsRequest } from "../external/external-x-signals-repository.js";
import type { GenerationGuidanceRequest } from "./generation-guidance.js";

const EXTERNAL_PATTERN_GUIDANCE_HEADER =
  "# External performance patterns (derived constraints, not voice)";
const EXTERNAL_PATTERN_GUIDANCE_INTRO =
  "Use these as weak writing constraints from external performance patterns, not author voice.";
const DEFAULT_EXTERNAL_PATTERN_LIMIT = 4;
const DEFAULT_EXTERNAL_PATTERN_GUIDANCE_CHAR_LIMIT = 1_200;
const STATEMENT_PREFIX = "- ";
const METADATA_PREFIX = "  metadata: ";

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

export type ExternalPatternSnapshotReader = {
  listGenerationPatterns: (
    request: ListGenerationPatternsRequest,
  ) => Promise<ExternalXSignalPattern[]>;
};

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

type RenderableExternalPatternGuidanceItem = {
  metadataLine: string;
  statement: string;
};

const fixedGuidanceLength = (items: RenderableExternalPatternGuidanceItem[]): number => {
  const baseLength = [
    EXTERNAL_PATTERN_GUIDANCE_HEADER,
    EXTERNAL_PATTERN_GUIDANCE_INTRO,
  ].join("\n").length;

  return items.reduce(
    (length, item) =>
      length + 1 + STATEMENT_PREFIX.length + 1 + item.metadataLine.length,
    baseLength,
  );
};

export const renderExternalPatternGuidance = (
  items: ExternalPatternGuidanceItem[],
): string | undefined => {
  if (items.length === 0) {
    return undefined;
  }

  const renderableItems = items
    .slice(0, DEFAULT_EXTERNAL_PATTERN_LIMIT)
    .map((item) => ({
      metadataLine: `${METADATA_PREFIX}${buildMetadata(item)}`,
      statement: normalizeInlineText(item.statement),
    }));

  while (
    renderableItems.length > 0 &&
    fixedGuidanceLength(renderableItems) > DEFAULT_EXTERNAL_PATTERN_GUIDANCE_CHAR_LIMIT
  ) {
    renderableItems.pop();
  }

  const lines = [
    EXTERNAL_PATTERN_GUIDANCE_HEADER,
    EXTERNAL_PATTERN_GUIDANCE_INTRO,
  ];
  let remainingStatementBudget =
    DEFAULT_EXTERNAL_PATTERN_GUIDANCE_CHAR_LIMIT - fixedGuidanceLength(renderableItems);

  for (const [index, item] of renderableItems.entries()) {
    const remainingItems = renderableItems.length - index;
    const statementBudget = Math.floor(remainingStatementBudget / remainingItems);
    const statement = truncateToBudget(item.statement, statementBudget);

    remainingStatementBudget -= statement.length;
    lines.push(`${STATEMENT_PREFIX}${statement}`);
    lines.push(item.metadataLine);
  }

  return lines.join("\n");
};

const toGuidanceItem = (pattern: ExternalXSignalPattern): ExternalPatternGuidanceItem => ({
  id: pattern.id,
  patternType: pattern.patternType,
  ...(pattern.format === undefined ? {} : { format: pattern.format }),
  statement: pattern.statement,
  confidence: pattern.confidence,
  supportCount: pattern.supportCount,
  generatedAt: pattern.generatedAt,
  version: pattern.version,
});

export const createExternalPatternGuidanceProvider = (
  snapshotReader: ExternalPatternSnapshotReader,
): ExternalPatternGuidanceProvider => {
  return async (request) => {
    const patterns = await snapshotReader.listGenerationPatterns({
      format: request.format,
      ...(request.maxPatterns === undefined ? {} : { limit: request.maxPatterns }),
      ...(request.minConfidence === undefined ? {} : { minConfidence: request.minConfidence }),
      ...(request.minSupportCount === undefined ? {} : { minSupportCount: request.minSupportCount }),
    });

    return patterns.map(toGuidanceItem);
  };
};
