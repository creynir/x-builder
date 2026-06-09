import { classifyPostFormat, varietyFormatLabels } from "./format-classifier.js";
import type {
  PostFormat,
  PostHistoryEntry,
  RecordPostHistoryEntryInput,
} from "./types.js";
import type { VoiceCheck } from "./voice-check.js";

export function appendPostFormatHistory(
  history: readonly PostHistoryEntry[],
  input: RecordPostHistoryEntryInput,
  recordedAt: Date = new Date(),
): PostHistoryEntry[] {
  return [
    {
      ...input,
      at: recordedAt.toISOString(),
    },
    ...history,
  ].slice(0, 10);
}

export function countRecentFormatStreak(
  history: readonly PostHistoryEntry[],
  format: PostFormat,
  limit = 3,
): number {
  if (format === "other") {
    return 0;
  }

  const recentEntries = history.slice(0, limit);
  let matchingPrefixCount = 0;

  for (const entry of recentEntries) {
    if (entry.format === format) {
      matchingPrefixCount++;
    } else {
      break;
    }
  }

  return matchingPrefixCount;
}

export function buildFormatVarietyCheck(
  text: string,
  history: readonly PostHistoryEntry[] = [],
): VoiceCheck | null {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return null;
  }

  const format = classifyPostFormat(trimmedText);

  if (format === "other") {
    return {
      id: "variety",
      label: "Format mix",
      status: "pass",
    };
  }

  const consecutiveUseCount = countRecentFormatStreak(history, format, 3) + 1;
  const readableFormat = varietyFormatLabels[format];

  return {
    id: "variety",
    label:
      consecutiveUseCount === 1
        ? `Format mix (${readableFormat})`
        : consecutiveUseCount === 2
          ? `2nd ${readableFormat} in a row - consider mixing it up`
          : `${consecutiveUseCount} ${readableFormat}s in a row - mix it up`,
    status:
      consecutiveUseCount >= 3
        ? "fail"
        : consecutiveUseCount === 2
          ? "warn"
          : "pass",
  };
}
