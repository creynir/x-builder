import { describe, expect, it } from "vitest";

import { makeTempEngineDb, seedPosts } from "../../server/sqlite-test-helpers.js";
import type { CanonicalOwnPost } from "../../server/post-library-repository.js";
import { createLocalHashingVoiceEmbedder } from "../voice-embedder.js";
import { VoiceIndexService } from "../voice-index-service.js";
import { SqliteVoiceSampleProvider } from "../sqlite-voice-sample-provider.js";

const ISO = "2026-06-29T12:00:00.000Z";

const canonicalPost = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => ({
  id: "post-1",
  platform: "x",
  platformPostId: "platform-post-1",
  text: "Small honest systems beat sprawling plans.",
  createdAt: "2026-06-01T00:00:00.000Z",
  kind: "original",
  language: "en",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  weakMetrics: {},
  metricSnapshots: [],
  sourceRefs: [],
  updatedAt: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

describe("SqliteVoiceSampleProvider", () => {
  it("keeps known ids before vector-ranked samples and ignores duplicate known ids", async () => {
    const db = makeTempEngineDb();
    const embedder = createLocalHashingVoiceEmbedder();
    await seedPosts(db, [
      canonicalPost({
        id: "known",
        platformPostId: "known-platform",
        text: "Known requested voice sample.",
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
      canonicalPost({
        id: "vector",
        platformPostId: "vector-platform",
        text: "Small honest systems should ship before sprawling abstractions.",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    new VoiceIndexService({ db, embedder, now: () => ISO }).ensureVoiceIndex();

    const provider = new SqliteVoiceSampleProvider({ db, embedder });
    const samples = await provider.provide({
      format: "insight_share",
      idea: "small honest systems",
      useKnownPostIds: ["known-platform", "known-platform"],
    });

    expect(samples.map((sample) => [sample.id, sample.source])).toEqual([
      ["known", "known_post_id"],
      ["vector", "voice_rag"],
    ]);
  });

  it("ignores known ids that point at replies", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({
        id: "reply",
        platformPostId: "reply-platform",
        kind: "reply",
        text: "Reply text must not teach voice.",
      }),
      canonicalPost({
        id: "original",
        platformPostId: "original-platform",
        text: "Original fallback voice.",
      }),
    ]);

    const provider = new SqliteVoiceSampleProvider({ db });
    const samples = await provider.provide({
      format: "hot_take",
      useKnownPostIds: ["reply-platform"],
    });

    expect(samples.map((sample) => sample.id)).toEqual(["original"]);
    expect(samples[0]?.source).toBe("voice_rag");
  });

  it("falls back to newest originals when indexing is unavailable", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({
        id: "old",
        platformPostId: "old-platform",
        text: "Old fallback voice.",
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
      canonicalPost({
        id: "new",
        platformPostId: "new-platform",
        text: "New fallback voice.",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    const provider = new SqliteVoiceSampleProvider({
      db,
      indexService: {
        ensureVoiceIndex() {
          throw new Error("index unavailable");
        },
      },
    });

    const samples = await provider.provide({
      format: "hot_take",
      idea: "anything",
      useKnownPostIds: [],
    });

    expect(samples.map((sample) => [sample.id, sample.source])).toEqual([
      ["new", "recent_original"],
      ["old", "recent_original"],
    ]);
  });

  it("keeps voiceProfileId as metadata only", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost()]);
    const provider = new SqliteVoiceSampleProvider({ db });

    const withoutProfile = await provider.provide({
      format: "hot_take",
      idea: "systems",
      useKnownPostIds: [],
    });
    const withProfile = await provider.provide({
      format: "hot_take",
      idea: "systems",
      voiceProfileId: "profile-alpha",
      useKnownPostIds: [],
    });

    expect(withProfile.map((sample) => sample.id)).toEqual(
      withoutProfile.map((sample) => sample.id),
    );
  });
});
