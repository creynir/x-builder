import type {
  GeneratedReplyRecord,
  RecordGeneratedReplyRequest,
} from "@x-builder/shared";

export type GeneratedReplyWriteResult = {
  record: GeneratedReplyRecord;
  duplicate: boolean;
};

export interface GeneratedReplyLedgerRepository {
  recordGeneratedReply(input: RecordGeneratedReplyRequest): Promise<GeneratedReplyWriteResult>;
  findByContentHash(hash: string): Promise<GeneratedReplyRecord | undefined>;
  isGeneratedReplyText(text: string): Promise<boolean>;
  isGeneratedReplyHash(hash: string): Promise<boolean>;
}
