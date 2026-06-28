import type {
  AddExternalXSignalSourceRequest,
  AddExternalXSignalSourceResponse,
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

export interface ExternalXSignalsRepository {
  addSource(input: AddExternalXSignalSourceRequest): Promise<AddExternalXSignalSourceResponse>;
  removeSource(input: RemoveExternalXSignalSourceRequest): Promise<RemoveExternalXSignalSourceResponse>;
  upsertObservedEvidence(evidence: ExternalXSignalEvidence[]): Promise<ExternalXSignalsWriteResult>;
  saveRefreshRun(run: ExternalXSignalRefreshRun): Promise<void>;
  replacePatterns(patterns: ExternalXSignalPattern[]): Promise<void>;
  getOverview(input?: GetExternalXSignalsOverviewRequest): Promise<GetExternalXSignalsOverviewResponse>;
}
