import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import { z } from "zod";

import type {
  JudgeProviderResolver,
} from "../llm/judge-draft-service.js";
import type { StructuredLlmService } from "../llm/structured-llm-service.js";

type DatabaseHandle = Database.Database;

export const ARCHIVE_VOICE_PROFILE_RULE_VERSION = "archive-voice-profile-v1";

const MAX_EXAMPLES_PER_KIND = 80;
const MAX_EXCERPT_LENGTH = 240;
const MAX_RULES_PER_SECTION = 8;

const voiceRuleSchema = z.string().trim().min(1).max(240);

const archiveVoiceProfileOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(600),
    syntaxHabits: z.array(voiceRuleSchema).max(MAX_RULES_PER_SECTION).default([]),
    toneBoundaries: z.array(voiceRuleSchema).max(MAX_RULES_PER_SECTION).default([]),
    recurringMoves: z.array(voiceRuleSchema).max(MAX_RULES_PER_SECTION).default([]),
    antiPatterns: z.array(voiceRuleSchema).max(MAX_RULES_PER_SECTION).default([]),
    postRules: z.array(voiceRuleSchema).max(MAX_RULES_PER_SECTION).default([]),
    replyRules: z.array(voiceRuleSchema).max(MAX_RULES_PER_SECTION).default([]),
    evidencePostIds: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  })
  .strict();

export type ArchiveVoiceProfileOutput = z.infer<typeof archiveVoiceProfileOutputSchema>;

export type ArchiveVoiceEvidence = {
  postId: string;
  platformPostId: string;
  kind: "original" | "reply";
  evidenceRole: "model_selected" | "sampled";
  excerpt: string;
  createdAt: string;
};

export type ArchiveVoiceProfile = ArchiveVoiceProfileOutput & {
  profileId: string;
  ruleVersion: string;
  corpusHash: string;
  generatedAt: string;
  modelProvider: string;
  modelId?: string;
  sourceCounts: {
    posts: number;
    replies: number;
  };
  evidence: ArchiveVoiceEvidence[];
};

export type ArchiveVoiceProfileServiceOptions = {
  db: DatabaseHandle;
  llm: Pick<StructuredLlmService, "generateStructured">;
  resolveProvider: JudgeProviderResolver;
  resolveModel?: (provider: string) => Promise<string | undefined> | string | undefined;
  now?: () => string;
  maxExamplesPerKind?: number;
};

export type ArchiveVoiceProfileProviderOptions = {
  maxWaitMs?: number;
};

type CorpusRow = {
  id: string;
  platform_post_id: string;
  text: string;
  kind: "original" | "reply";
  content_hash: string;
  created_at: string;
  updated_at: string;
};

type StoredProfileRow = {
  profile_id: string;
  rule_version: string;
  corpus_hash: string;
  source_post_count: number;
  source_reply_count: number;
  generated_at: string;
  model_provider: string;
  model_id: string | null;
  profile_json: string;
};

const nowIso = (): string => new Date().toISOString();

const resolveProviderId = async (source: JudgeProviderResolver): Promise<string> =>
  typeof source === "function" ? source() : source;

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, " ").trim();

const excerpt = (value: string): string => normalizeInlineText(value).slice(0, MAX_EXCERPT_LENGTH);

const computeCorpusHash = (rows: CorpusRow[]): string => {
  const hash = createHash("sha256");

  for (const row of rows) {
    hash.update(row.id);
    hash.update("\0");
    hash.update(row.kind);
    hash.update("\0");
    hash.update(row.content_hash);
    hash.update("\0");
    hash.update(row.updated_at);
    hash.update("\n");
  }

  return `sha256:${hash.digest("hex")}`;
};

const profileIdFor = (corpusHash: string): string =>
  `${ARCHIVE_VOICE_PROFILE_RULE_VERSION}:${corpusHash.replace("sha256:", "")}`;

const parseProfileJson = (value: string): ArchiveVoiceProfileOutput | undefined => {
  try {
    return archiveVoiceProfileOutputSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const renderExamples = (label: string, rows: CorpusRow[]): string => {
  if (rows.length === 0) {
    return `${label}: none`;
  }

  const lines = rows.map(
    (row, index) =>
      `${index + 1}. id=${row.id}; created=${row.created_at}; text=${JSON.stringify(excerpt(row.text))}`,
  );

  return `${label}:\n${lines.join("\n")}`;
};

const instructions = [
  "Derive a compact writing voice profile from the user's own local X corpus.",
  "Use only the supplied examples. Do not infer from external accounts.",
  "Separate durable post voice from reply voice.",
  "Return practical rules: syntax habits, tone boundaries, recurring moves, anti-patterns, post rules, reply rules, and evidence post ids.",
  "Do not quote examples at length and do not ask for emotional content.",
].join(" ");

const profileSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "syntaxHabits",
    "toneBoundaries",
    "recurringMoves",
    "antiPatterns",
    "postRules",
    "replyRules",
    "evidencePostIds",
  ],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 600 },
    syntaxHabits: { type: "array", maxItems: MAX_RULES_PER_SECTION, items: { type: "string" } },
    toneBoundaries: { type: "array", maxItems: MAX_RULES_PER_SECTION, items: { type: "string" } },
    recurringMoves: { type: "array", maxItems: MAX_RULES_PER_SECTION, items: { type: "string" } },
    antiPatterns: { type: "array", maxItems: MAX_RULES_PER_SECTION, items: { type: "string" } },
    postRules: { type: "array", maxItems: MAX_RULES_PER_SECTION, items: { type: "string" } },
    replyRules: { type: "array", maxItems: MAX_RULES_PER_SECTION, items: { type: "string" } },
    evidencePostIds: { type: "array", maxItems: 12, items: { type: "string" } },
  },
};

export class ArchiveVoiceProfileService {
  private readonly db: DatabaseHandle;
  private readonly llm: Pick<StructuredLlmService, "generateStructured">;
  private readonly resolveProvider: JudgeProviderResolver;
  private readonly resolveModel: (provider: string) => Promise<string | undefined> | string | undefined;
  private readonly now: () => string;
  private readonly maxExamplesPerKind: number;

  constructor(options: ArchiveVoiceProfileServiceOptions) {
    this.db = options.db;
    this.llm = options.llm;
    this.resolveProvider = options.resolveProvider;
    this.resolveModel = options.resolveModel ?? (() => undefined);
    this.now = options.now ?? nowIso;
    this.maxExamplesPerKind = options.maxExamplesPerKind ?? MAX_EXAMPLES_PER_KIND;
  }

  async getCurrentProfile(): Promise<ArchiveVoiceProfile | undefined> {
    try {
      const corpusRows = this.loadCorpusRows();
      if (corpusRows.length === 0) {
        return undefined;
      }

      const corpusHash = computeCorpusHash(corpusRows);
      const existing = this.readProfile(corpusHash);
      if (existing !== undefined) {
        return existing;
      }

      return await this.refreshProfile(corpusRows, corpusHash);
    } catch {
      return undefined;
    }
  }

  private loadCorpusRows(): CorpusRow[] {
    return this.db
      .prepare(
        `
        SELECT id, platform_post_id, text, kind, content_hash, created_at, updated_at
        FROM post
        WHERE kind IN ('original', 'reply')
          AND length(trim(text)) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM generated_reply gr
            WHERE post.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
          )
        ORDER BY created_at DESC, id ASC
      `,
      )
      .all() as CorpusRow[];
  }

  private readProfile(corpusHash: string): ArchiveVoiceProfile | undefined {
    const row = this.db
      .prepare(
        `
        SELECT profile_id, rule_version, corpus_hash, source_post_count, source_reply_count,
               generated_at, model_provider, model_id, profile_json
        FROM archive_voice_profile
        WHERE rule_version = ?
          AND corpus_hash = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      )
      .get(ARCHIVE_VOICE_PROFILE_RULE_VERSION, corpusHash) as StoredProfileRow | undefined;

    if (row === undefined) {
      return undefined;
    }

    const parsed = parseProfileJson(row.profile_json);
    if (parsed === undefined) {
      return undefined;
    }

    const evidence = this.db
      .prepare(
        `
        SELECT post_id, platform_post_id, kind, evidence_role, excerpt, created_at
        FROM archive_voice_profile_evidence
        WHERE profile_id = ?
        ORDER BY evidence_role ASC, created_at DESC, post_id ASC
      `,
      )
      .all(row.profile_id) as Array<{
      post_id: string;
      platform_post_id: string;
      kind: "original" | "reply";
      evidence_role: "model_selected" | "sampled";
      excerpt: string;
      created_at: string;
    }>;

    return {
      ...parsed,
      profileId: row.profile_id,
      ruleVersion: row.rule_version,
      corpusHash: row.corpus_hash,
      generatedAt: row.generated_at,
      modelProvider: row.model_provider,
      ...(row.model_id === null ? {} : { modelId: row.model_id }),
      sourceCounts: {
        posts: row.source_post_count,
        replies: row.source_reply_count,
      },
      evidence: evidence.map((item) => ({
        postId: item.post_id,
        platformPostId: item.platform_post_id,
        kind: item.kind,
        evidenceRole: item.evidence_role,
        excerpt: item.excerpt,
        createdAt: item.created_at,
      })),
    };
  }

  private async refreshProfile(
    corpusRows: CorpusRow[],
    corpusHash: string,
  ): Promise<ArchiveVoiceProfile | undefined> {
    const provider = await resolveProviderId(this.resolveProvider);
    const model = await this.resolveModel(provider);
    const postRows = corpusRows
      .filter((row) => row.kind === "original")
      .slice(0, this.maxExamplesPerKind);
    const replyRows = corpusRows
      .filter((row) => row.kind === "reply")
      .slice(0, this.maxExamplesPerKind);
    const sentRows = [...postRows, ...replyRows];

    const result = await this.llm.generateStructured({
      provider,
      purpose: "archive_voice_profile",
      instructions,
      turns: [
        {
          role: "user",
          content: [
            `ruleVersion=${ARCHIVE_VOICE_PROFILE_RULE_VERSION}`,
            `corpusHash=${corpusHash}`,
            renderExamples("Original posts", postRows),
            renderExamples("Replies", replyRows),
          ].join("\n\n"),
        },
      ],
      structuredOutput: {
        name: "archive_voice_profile",
        schema: profileSchema,
        parser: (value: unknown) => archiveVoiceProfileOutputSchema.parse(value),
      },
      options: {
        ...(model === undefined ? {} : { model }),
        timeoutMs: 60_000,
      },
      metadata: {
        ruleVersion: ARCHIVE_VOICE_PROFILE_RULE_VERSION,
        corpusHash,
        sourcePostCount: postRows.length,
        sourceReplyCount: replyRows.length,
      },
    });

    if (result.status === "failed") {
      return undefined;
    }

    const generatedAt = this.now();
    const profileId = profileIdFor(corpusHash);
    const sentRowIds = new Set(sentRows.map((row) => row.id));
    const selectedEvidenceIds = new Set(
      result.output.evidencePostIds.filter((postId) => sentRowIds.has(postId)),
    );
    const sanitizedOutput: ArchiveVoiceProfileOutput = {
      ...result.output,
      evidencePostIds: [...selectedEvidenceIds],
    };
    const sampledEvidenceIds = new Set(
      [...postRows.slice(0, 3), ...replyRows.slice(0, 3)].map((row) => row.id),
    );
    const evidenceRows = sentRows
      .filter((row) => selectedEvidenceIds.has(row.id) || sampledEvidenceIds.has(row.id))
      .slice(0, 24)
      .map((row): ArchiveVoiceEvidence => ({
        postId: row.id,
        platformPostId: row.platform_post_id,
        kind: row.kind,
        evidenceRole: selectedEvidenceIds.has(row.id) ? "model_selected" : "sampled",
        excerpt: excerpt(row.text),
        createdAt: row.created_at,
      }));

    this.persistProfile({
      profileId,
      ruleVersion: ARCHIVE_VOICE_PROFILE_RULE_VERSION,
      corpusHash,
      generatedAt,
      modelProvider: provider,
      ...(model === undefined ? {} : { modelId: model }),
      sourceCounts: {
        posts: postRows.length,
        replies: replyRows.length,
      },
      evidence: evidenceRows,
      ...sanitizedOutput,
    });

    return this.readProfile(corpusHash);
  }

  private persistProfile(profile: ArchiveVoiceProfile): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
          INSERT INTO archive_voice_profile (
            profile_id, rule_version, corpus_hash, source_post_count, source_reply_count,
            generated_at, model_provider, model_id, profile_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(profile_id) DO UPDATE SET
            rule_version = excluded.rule_version,
            corpus_hash = excluded.corpus_hash,
            source_post_count = excluded.source_post_count,
            source_reply_count = excluded.source_reply_count,
            generated_at = excluded.generated_at,
            model_provider = excluded.model_provider,
            model_id = excluded.model_id,
            profile_json = excluded.profile_json,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          profile.profileId,
          profile.ruleVersion,
          profile.corpusHash,
          profile.sourceCounts.posts,
          profile.sourceCounts.replies,
          profile.generatedAt,
          profile.modelProvider,
          profile.modelId ?? null,
          JSON.stringify({
            summary: profile.summary,
            syntaxHabits: profile.syntaxHabits,
            toneBoundaries: profile.toneBoundaries,
            recurringMoves: profile.recurringMoves,
            antiPatterns: profile.antiPatterns,
            postRules: profile.postRules,
            replyRules: profile.replyRules,
            evidencePostIds: profile.evidencePostIds,
          } satisfies ArchiveVoiceProfileOutput),
          profile.generatedAt,
        );

      this.db
        .prepare("DELETE FROM archive_voice_profile_evidence WHERE profile_id = ?")
        .run(profile.profileId);

      const insertEvidence = this.db.prepare(
        `
        INSERT INTO archive_voice_profile_evidence (
          profile_id, post_id, platform_post_id, kind, evidence_role, excerpt, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      );

      for (const evidence of profile.evidence) {
        insertEvidence.run(
          profile.profileId,
          evidence.postId,
          evidence.platformPostId,
          evidence.kind,
          evidence.evidenceRole,
          evidence.excerpt,
          evidence.createdAt,
        );
      }
    });

    transaction();
  }
}

export type ArchiveVoiceProfileRequest = {
  surface: "post" | "reply";
};

export type ArchiveVoiceProfileProvider = (
  request: ArchiveVoiceProfileRequest,
) => Promise<ArchiveVoiceProfile | undefined>;

const DEFAULT_PROFILE_PROVIDER_MAX_WAIT_MS = 1_500;

export const createArchiveVoiceProfileProvider = (
  service: ArchiveVoiceProfileService,
  options: ArchiveVoiceProfileProviderOptions = {},
): ArchiveVoiceProfileProvider => {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_PROFILE_PROVIDER_MAX_WAIT_MS;

  return async () => {
    const profilePromise = service.getCurrentProfile();

    if (!Number.isInteger(maxWaitMs) || maxWaitMs <= 0) {
      return profilePromise;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        profilePromise,
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => resolve(undefined), maxWaitMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  };
};
