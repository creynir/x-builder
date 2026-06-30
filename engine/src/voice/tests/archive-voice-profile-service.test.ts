import { describe, expect, it, vi } from "vitest";

import { makeTempEngineDb, seedPosts } from "../../server/sqlite-test-helpers.js";
import type { CanonicalOwnPost } from "../../server/post-library-repository.js";
import {
  ARCHIVE_VOICE_PROFILE_RULE_VERSION,
  ArchiveVoiceProfileService,
  createArchiveVoiceProfileProvider,
} from "../archive-voice-profile-service.js";

const ISO = "2026-06-30T12:00:00.000Z";

const canonicalPost = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => ({
  id: overrides.id ?? "post-1",
  platform: "x",
  platformPostId: overrides.platformPostId ?? "platform-post-1",
  text: overrides.text ?? "Small honest systems beat sprawling plans.",
  createdAt: overrides.createdAt ?? "2026-06-01T00:00:00.000Z",
  kind: overrides.kind ?? "original",
  language: "en",
  replyReferences: overrides.replyReferences ?? {},
  entityFlags: overrides.entityFlags ?? {
    hasUrls: false,
    hasMedia: false,
    hasHashtags: false,
    hasMentions: false,
  },
  weakMetrics: overrides.weakMetrics ?? {},
  metricSnapshots: overrides.metricSnapshots ?? [],
  sourceRefs: overrides.sourceRefs ?? [],
  updatedAt: overrides.updatedAt ?? "2026-06-01T00:00:00.000Z",
});

const profileOutput = {
  summary: "Direct operator voice with concrete tradeoffs.",
  syntaxHabits: ["Short opener, then the explanation."],
  toneBoundaries: ["No generic praise."],
  recurringMoves: ["Names the tradeoff before the recommendation."],
  antiPatterns: ["No engagement bait."],
  postRules: ["Make the claim concrete."],
  replyRules: ["Answer the target directly."],
  evidencePostIds: ["post-original", "post-reply"],
};

const createLlm = (output: unknown = profileOutput) => {
  const calls: Array<{ purpose: string; provider: string; model?: string; content: string }> = [];
  const generateStructured = vi.fn(async (request: any) => {
    calls.push({
      purpose: request.purpose,
      provider: request.provider,
      model: request.options?.model,
      content: request.turns.find((turn: any) => turn.role === "user")?.content ?? "",
    });

    return {
      status: "success" as const,
      provider: "codex-cli",
      requestId: "profile-request",
      output: request.structuredOutput.parser(output),
      durationMs: 1,
      completedAt: ISO,
    };
  });

  return { llm: { generateStructured }, calls };
};

describe("ArchiveVoiceProfileService", () => {
  it("derives and persists a local profile from canonical originals and replies", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({
        id: "post-original",
        platformPostId: "platform-original",
        text: "Originals make a concrete claim before explaining the tradeoff.",
      }),
      canonicalPost({
        id: "post-reply",
        platformPostId: "platform-reply",
        kind: "reply",
        text: "Exactly. The boring version is the one that survives contact.",
      }),
      canonicalPost({
        id: "post-repost",
        kind: "repost_reference",
        text: "This must not enter the voice profile batch.",
      }),
    ]);
    const { llm, calls } = createLlm();

    const service = new ArchiveVoiceProfileService({
      db,
      llm: llm as never,
      resolveProvider: "codex-cli",
      now: () => ISO,
    });

    const profile = await service.getCurrentProfile();

    expect(profile).toMatchObject({
      ruleVersion: ARCHIVE_VOICE_PROFILE_RULE_VERSION,
      summary: profileOutput.summary,
      sourceCounts: { posts: 1, replies: 1 },
      postRules: profileOutput.postRules,
      replyRules: profileOutput.replyRules,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.purpose).toBe("archive_voice_profile");
    expect(calls[0]?.content).toContain("Original posts:");
    expect(calls[0]?.content).toContain("Replies:");
    expect(calls[0]?.content).toContain("post-original");
    expect(calls[0]?.content).toContain("post-reply");
    expect(calls[0]?.content).not.toContain("post-repost");

    const storedProfileCount = db
      .prepare("SELECT COUNT(*) AS count FROM archive_voice_profile")
      .get() as { count: number };
    const storedEvidence = db
      .prepare("SELECT post_id, kind FROM archive_voice_profile_evidence ORDER BY post_id")
      .all() as Array<{ post_id: string; kind: string }>;

    expect(storedProfileCount.count).toBe(1);
    expect(storedEvidence).toEqual([
      { post_id: "post-original", kind: "original" },
      { post_id: "post-reply", kind: "reply" },
    ]);
  });

  it("JSON-encodes sampled text in the profile prompt", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({
        id: "post-quote",
        text: 'Quotes like "this" and newlines\nmust not corrupt the example shape.',
      }),
    ]);
    const { llm, calls } = createLlm({
      ...profileOutput,
      evidencePostIds: ["post-quote"],
    });
    const service = new ArchiveVoiceProfileService({
      db,
      llm: llm as never,
      resolveProvider: "codex-cli",
      now: () => ISO,
    });

    await service.getCurrentProfile();

    expect(calls[0]?.content).toContain(
      'text="Quotes like \\"this\\" and newlines must not corrupt the example shape."',
    );
  });

  it("ignores model-selected evidence ids that were not sent to the LLM", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({
        id: "post-sent",
        platformPostId: "platform-sent",
        createdAt: "2026-06-02T00:00:00.000Z",
        text: "This row is in the sampled prompt.",
      }),
      canonicalPost({
        id: "post-unsent",
        platformPostId: "platform-unsent",
        createdAt: "2026-06-01T00:00:00.000Z",
        text: "This row is outside the sampled prompt.",
      }),
    ]);
    const { llm } = createLlm({
      ...profileOutput,
      evidencePostIds: ["post-unsent"],
    });
    const service = new ArchiveVoiceProfileService({
      db,
      llm,
      resolveProvider: "codex-cli",
      now: () => ISO,
      maxExamplesPerKind: 1,
    });

    const profile = await service.getCurrentProfile();

    expect(profile?.evidence.map((item) => item.postId)).toEqual(["post-sent"]);
    expect(profile?.evidence.every((item) => item.postId !== "post-unsent")).toBe(true);
    expect(profile?.evidencePostIds).toEqual([]);
  });

  it("passes the selected provider into model resolution", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost({ id: "post-original" })]);
    const { llm, calls } = createLlm();
    const resolveProvider = vi.fn(async () => "claude-cli");
    const resolveModel = vi.fn(async (provider: string) =>
      provider === "claude-cli" ? "claude-sonnet-profile" : "wrong-model",
    );
    const service = new ArchiveVoiceProfileService({
      db,
      llm: llm as never,
      resolveProvider,
      resolveModel,
      now: () => ISO,
    });

    await service.getCurrentProfile();

    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(resolveModel).toHaveBeenCalledWith("claude-cli");
    expect(calls[0]).toMatchObject({
      provider: "claude-cli",
      model: "claude-sonnet-profile",
    });
  });

  it("reuses the current profile when the corpus hash has not changed", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost({ id: "post-original" })]);
    const { llm } = createLlm();
    const service = new ArchiveVoiceProfileService({
      db,
      llm: llm as never,
      resolveProvider: "codex-cli",
      now: () => ISO,
    });

    await service.getCurrentProfile();
    await service.getCurrentProfile();

    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it("fails open when profile generation fails", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost({ id: "post-original" })]);
    const llm = {
      generateStructured: vi.fn(async () => ({
        status: "failed" as const,
        provider: "codex-cli",
        requestId: "profile-request",
        code: "provider_unconfigured",
        message: "No provider configured.",
        retryable: false,
        durationMs: 1,
        completedAt: ISO,
      })),
    };
    const service = new ArchiveVoiceProfileService({
      db,
      llm,
      resolveProvider: "codex-cli",
      now: () => ISO,
    });

    await expect(service.getCurrentProfile()).resolves.toBeUndefined();
  });

  it("bounds provider wait time so generation can fail open while refresh continues", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost({ id: "post-original" })]);
    const llm = {
      generateStructured: vi.fn(
        () =>
          new Promise(() => {
            // Intentionally never resolves.
          }),
      ),
    };
    const service = new ArchiveVoiceProfileService({
      db,
      llm: llm as never,
      resolveProvider: "codex-cli",
      now: () => ISO,
    });
    const provider = createArchiveVoiceProfileProvider(service, { maxWaitMs: 1 });

    await expect(provider({ surface: "post" })).resolves.toBeUndefined();
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  });

  it("clears the provider wait timer after a fast profile read", async () => {
    vi.useFakeTimers();
    try {
      const service = {
        getCurrentProfile: vi.fn(async () => undefined),
      } as unknown as ArchiveVoiceProfileService;
      const provider = createArchiveVoiceProfileProvider(service, { maxWaitMs: 1_500 });

      await expect(provider({ surface: "post" })).resolves.toBeUndefined();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
