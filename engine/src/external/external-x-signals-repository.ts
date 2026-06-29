import type {
  AddExternalXSignalSourceRequest,
  AddExternalXSignalSourceResponse,
  DetectedPostFormat,
  ExternalXSignalEvidence,
  ExternalXSignalPattern,
  ExternalXSignalRefreshRun,
  GetExternalXSignalsOverviewRequest,
  GetExternalXSignalsOverviewResponse,
  RemoveExternalXSignalSourceRequest,
  RemoveExternalXSignalSourceResponse,
} from "@x-builder/shared";

export type ExternalXSignalsWriteResult = {
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
};

export type ListGenerationPatternsRequest = {
  format?: DetectedPostFormat;
  patternTypes?: ExternalXSignalPattern["patternType"][];
  minConfidence?: number;
  minSupportCount?: number;
  limit?: number;
};

export interface ExternalXSignalsRepository {
  addSource(input: AddExternalXSignalSourceRequest): Promise<AddExternalXSignalSourceResponse>;
  removeSource(input: RemoveExternalXSignalSourceRequest): Promise<RemoveExternalXSignalSourceResponse>;
  upsertObservedEvidence(evidence: ExternalXSignalEvidence[]): Promise<ExternalXSignalsWriteResult>;
  saveRefreshRun(run: ExternalXSignalRefreshRun): Promise<void>;
  replacePatterns(patterns: ExternalXSignalPattern[]): Promise<void>;
  listGenerationPatterns(input: ListGenerationPatternsRequest): Promise<ExternalXSignalPattern[]>;
  getOverview(input?: GetExternalXSignalsOverviewRequest): Promise<GetExternalXSignalsOverviewResponse>;
}
