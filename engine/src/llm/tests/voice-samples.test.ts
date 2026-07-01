import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  CanonicalOwnPost,
  PostLibraryRepository,
  PostLibraryStore,
} from "../../server/post-library-repository";
import type { GeneratedReplyLedgerRepository } from "../../generated-replies/generated-reply-ledger-repository";
import {
  renderVoiceSampleGuidance,
  selectVoiceSamples,
  type RenderedVoiceSamples,
  type SelectVoiceSamplesInput,
  type VoiceSamplePost,
  type VoiceRetrievalSample,
} from "../generation-guidance";

const BASE_DATE = "2026-06-01T00:00:00.000Z";

const entityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

const isoDay = (day: number): string =>
  `2026-06-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const canonicalPost = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => {
  const id = overrides.id ?? "post-1";
  const createdAt = overrides.createdAt ?? BASE_DATE;

  return {
    id,
    platform: "x",
    platformPostId: overrides.platformPostId ?? `${id}-platform`,
    text: overrides.text ?? `Text for ${id}`,
    createdAt,
    kind: overrides.kind ?? "original",
    language: "en",
    replyReferences: overrides.replyReferences ?? {},
    entityFlags: overrides.entityFlags ?? { ...entityFlags },
    weakMetrics: overrides.weakMetrics ?? {},
    metricSnapshots: overrides.metricSnapshots ?? [],
    sourceRefs: overrides.sourceRefs ?? [],
    updatedAt: overrides.updatedAt ?? createdAt,
  };
};

const canonicalPostWithoutCreatedAt = (
  overrides: Partial<CanonicalOwnPost> = {},
): CanonicalOwnPost => {
  const post = canonicalPost(overrides);
  delete (post as Partial<CanonicalOwnPost>).createdAt;
  return post as CanonicalOwnPost;
};

const storeOf = (posts: CanonicalOwnPost[]): PostLibraryStore => ({
  schemaVersion: 2,
  updatedAt: BASE_DATE,
  posts,
  importRuns: [],
  derivedInsights: [],
  activeContext: { status: "empty" },
  profileSnapshots: [],
});

const repositoryOf = (posts: CanonicalOwnPost[]): Pick<PostLibraryRepository, "loadStore"> => ({
  loadStore: async () => storeOf(posts),
});

const selectFrom = (
  posts: CanonicalOwnPost[],
  input: Omit<SelectVoiceSamplesInput, "postLibraryRepository"> = {},
) =>
  selectVoiceSamples({
    postLibraryRepository: repositoryOf(posts),
    ...input,
  });

const voiceSample = (overrides: Partial<VoiceSamplePost> = {}): VoiceSamplePost => ({
  id: overrides.id ?? "sample-1",
  platformPostId: overrides.platformPostId ?? "sample-platform-1",
  text: overrides.text ?? "sample text",
  createdAt: overrides.createdAt ?? BASE_DATE,
  kind: "original",
  source: overrides.source ?? "recent_original",
});

describe("voice sample selection", () => {
  it("exports the documented voice sample contracts", () => {
    expectTypeOf<SelectVoiceSamplesInput>().toEqualTypeOf<{
      postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
      generatedReplyLedgerRepository?: Pick<
        GeneratedReplyLedgerRepository,
        "isGeneratedReplyText"
      >;
      useKnownPostIds?: string[];
      voiceProfileId?: string;
    }>();

    expectTypeOf<RenderedVoiceSamples>().toEqualTypeOf<{
      content: string;
      charCount: number;
      truncated: boolean;
    }>();

    expectTypeOf<VoiceSamplePost["source"]>().toEqualTypeOf<
      "known_post_id" | "profile_sample" | "voice_rag" | "recent_original"
    >();
    expectTypeOf<VoiceRetrievalSample["source"]>().toEqualTypeOf<
      "known_post_id" | "voice_rag" | "recent_original"
    >();
  });

  it("selects newest originals by createdAt descending when no known ids are supplied", async () => {
    const posts = Array.from({ length: 8 }, (_unused, index) => {
      const day = 10 - index;
      return canonicalPost({
        id: `post-${day}`,
        platformPostId: `platform-${day}`,
        text: `original ${day}`,
        createdAt: isoDay(day),
      });
    });

    const selected = await selectFrom(posts);

    expect(selected).toHaveLength(5);
    expect(selected.map((sample) => sample.id)).toEqual([
      "post-10",
      "post-9",
      "post-8",
      "post-7",
      "post-6",
    ]);
    expect(selected.map((sample) => sample.source)).toEqual([
      "recent_original",
      "recent_original",
      "recent_original",
      "recent_original",
      "recent_original",
    ]);
    expect(selected[0]).toEqual({
      id: "post-10",
      platformPostId: "platform-10",
      text: "original 10",
      createdAt: isoDay(10),
      kind: "original",
      source: "recent_original",
    } satisfies VoiceSamplePost);
  });

  it("honors known ids first in caller order by canonical id or platformPostId", async () => {
    const posts = [
      canonicalPost({
        id: "post-newest",
        platformPostId: "platform-newest",
        createdAt: isoDay(10),
      }),
      canonicalPost({
        id: "post-a",
        platformPostId: "platform-a",
        createdAt: isoDay(7),
      }),
      canonicalPost({
        id: "post-b",
        platformPostId: "platform-b",
        createdAt: isoDay(8),
      }),
      canonicalPost({
        id: "post-older",
        platformPostId: "platform-older",
        createdAt: isoDay(6),
      }),
    ];

    const selected = await selectFrom(posts, {
      useKnownPostIds: ["platform-b", "post-a"],
    });

    expect(selected.map((sample) => sample.id)).toEqual([
      "post-b",
      "post-a",
      "post-newest",
      "post-older",
    ]);
    expect(selected.slice(0, 2).map((sample) => sample.source)).toEqual([
      "known_post_id",
      "known_post_id",
    ]);
    expect(selected.slice(2).map((sample) => sample.source)).toEqual([
      "recent_original",
      "recent_original",
    ]);
  });

  it("excludes exact generated replies when a ledger is provided", async () => {
    const selected = await selectFrom(
      [
        canonicalPost({
          id: "generated",
          platformPostId: "generated-platform",
          text: "Generated reply text.",
          createdAt: isoDay(10),
        }),
        canonicalPost({
          id: "original",
          platformPostId: "original-platform",
          text: "Original voice sample.",
          createdAt: isoDay(9),
        }),
      ],
      {
        useKnownPostIds: ["generated-platform"],
        generatedReplyLedgerRepository: {
          isGeneratedReplyText: async (text) => text === "Generated reply text.",
        },
      },
    );

    expect(selected.map((sample) => sample.id)).toEqual(["original"]);
  });

  it("filters selection to originals with non-empty trimmed text", async () => {
    const posts = [
      canonicalPost({
        id: "post-original",
        text: "usable original",
        createdAt: isoDay(6),
      }),
      canonicalPost({
        id: "post-reply",
        kind: "reply",
        text: "reply should not teach voice",
        createdAt: isoDay(10),
      }),
      canonicalPost({
        id: "post-repost",
        kind: "repost_reference",
        text: "repost should not teach voice",
        createdAt: isoDay(9),
      }),
      canonicalPost({
        id: "post-unknown",
        kind: "unknown",
        text: "unknown should not teach voice",
        createdAt: isoDay(8),
      }),
      canonicalPost({
        id: "post-whitespace",
        text: " \n\t ",
        createdAt: isoDay(7),
      }),
    ];

    const selected = await selectFrom(posts);

    expect(selected.map((sample) => sample.id)).toEqual(["post-original"]);
  });

  it("dedupes duplicate known ids by canonical post id", async () => {
    const posts = [
      canonicalPost({
        id: "post-target",
        platformPostId: "platform-target",
        createdAt: isoDay(6),
      }),
      canonicalPost({
        id: "post-fallback",
        platformPostId: "platform-fallback",
        createdAt: isoDay(7),
      }),
    ];

    const selected = await selectFrom(posts, {
      useKnownPostIds: ["post-target", "platform-target", "post-target"],
    });

    expect(selected.map((sample) => sample.id)).toEqual(["post-target", "post-fallback"]);
    expect(selected.filter((sample) => sample.id === "post-target")).toHaveLength(1);
    expect(selected[0]?.source).toBe("known_post_id");
    expect(selected[1]?.source).toBe("recent_original");
  });

  it("skips unknown known ids without blocking newest-original fallback", async () => {
    const posts = [
      canonicalPost({
        id: "post-known",
        platformPostId: "platform-known",
        createdAt: isoDay(6),
      }),
      canonicalPost({
        id: "post-newest",
        platformPostId: "platform-newest",
        createdAt: isoDay(10),
      }),
      canonicalPost({
        id: "post-older",
        platformPostId: "platform-older",
        createdAt: isoDay(5),
      }),
    ];

    const selected = await selectFrom(posts, {
      useKnownPostIds: ["missing-canonical-id", "missing-platform-id", "post-known"],
    });

    expect(selected.map((sample) => sample.id)).toEqual([
      "post-known",
      "post-newest",
      "post-older",
    ]);
    expect(selected.map((sample) => sample.source)).toEqual([
      "known_post_id",
      "recent_original",
      "recent_original",
    ]);
  });

  it("caps known-id lookup work before falling back to newest originals", async () => {
    const posts = [
      canonicalPost({
        id: "post-after-cap",
        platformPostId: "platform-after-cap",
        createdAt: isoDay(6),
      }),
      canonicalPost({ id: "post-newest", platformPostId: "platform-newest", createdAt: isoDay(10) }),
      canonicalPost({ id: "post-older", platformPostId: "platform-older", createdAt: isoDay(5) }),
    ];
    const overLimitKnownIds = [
      ...Array.from({ length: 25 }, (_value, index) => `missing-${index}`),
      "post-after-cap",
    ];

    const selected = await selectFrom(posts, { useKnownPostIds: overLimitKnownIds });

    expect(selected.map((sample) => sample.id)).toEqual([
      "post-newest",
      "post-after-cap",
      "post-older",
    ]);
    expect(selected.every((sample) => sample.source === "recent_original")).toBe(true);
  });

  it("ignores a known id that points to a reply", async () => {
    const reply = canonicalPost({
      id: "post-reply",
      platformPostId: "platform-reply",
      kind: "reply",
      createdAt: isoDay(10),
    });
    const original = canonicalPost({
      id: "post-original",
      platformPostId: "platform-original",
      createdAt: isoDay(6),
    });

    const selected = await selectFrom([reply, original], {
      useKnownPostIds: ["platform-reply"],
    });

    expect(selected.map((sample) => sample.id)).toEqual(["post-original"]);
    expect(selected[0]?.source).toBe("recent_original");
  });

  it("returns an empty selection when candidates are only replies, reposts, or blank text", async () => {
    const selected = await selectFrom([
      canonicalPost({
        id: "post-reply",
        kind: "reply",
        text: "reply should not teach voice",
        createdAt: isoDay(10),
      }),
      canonicalPost({
        id: "post-repost",
        kind: "repost_reference",
        text: "repost should not teach voice",
        createdAt: isoDay(9),
      }),
      canonicalPost({
        id: "post-blank",
        text: " \n\t ",
        createdAt: isoDay(8),
      }),
    ]);

    expect(selected).toEqual([]);
  });

  it("returns an empty selection when the post library cannot be read", async () => {
    const postLibraryRepository: Pick<PostLibraryRepository, "loadStore"> = {
      loadStore: async () => {
        throw new Error("load failed");
      },
    };

    const selected = await selectVoiceSamples({ postLibraryRepository });

    expect(selected).toEqual([]);
  });

  it("treats voiceProfileId alone as metadata and keeps newest-original fallback", async () => {
    const posts = [
      canonicalPost({ id: "post-older", createdAt: isoDay(4) }),
      canonicalPost({ id: "post-newer", createdAt: isoDay(8) }),
      canonicalPost({ id: "post-newest", createdAt: isoDay(9) }),
    ];

    const withoutProfile = await selectFrom(posts);
    const withProfile = await selectFrom(posts, { voiceProfileId: "profile-1" });

    expect(withProfile.map((sample) => sample.id)).toEqual(
      withoutProfile.map((sample) => sample.id),
    );
    expect(withProfile.map((sample) => sample.id)).toEqual([
      "post-newest",
      "post-newer",
      "post-older",
    ]);
    expect(withProfile.every((sample) => sample.source === "recent_original")).toBe(true);
  });

  it("sorts malformed or missing createdAt after valid dates with id tie-breaks", async () => {
    const posts = [
      canonicalPost({
        id: "post-invalid-b",
        createdAt: "not-a-date",
      }),
      canonicalPost({
        id: "post-valid-b",
        createdAt: isoDay(8),
      }),
      canonicalPostWithoutCreatedAt({
        id: "post-missing-c",
      }),
      canonicalPost({
        id: "post-valid-newest",
        createdAt: isoDay(10),
      }),
      canonicalPost({
        id: "post-valid-a",
        createdAt: isoDay(8),
      }),
    ];

    const selected = await selectFrom(posts);

    expect(selected.map((sample) => sample.id)).toEqual([
      "post-valid-newest",
      "post-valid-a",
      "post-valid-b",
      "post-invalid-b",
      "post-missing-c",
    ]);
  });
});

describe("voice sample guidance rendering", () => {
  it("renders collapsed-whitespace bullets and reports returned content length", () => {
    const rendered = renderVoiceSampleGuidance([
      voiceSample({ id: "sample-a", text: " first\n\nsample\twith   spacing " }),
      voiceSample({ id: "sample-b", text: "second sample" }),
    ]);

    expect(rendered).toEqual({
      content: "- first sample with spacing\n- second sample",
      charCount: "- first sample with spacing\n- second sample".length,
      truncated: false,
    } satisfies RenderedVoiceSamples);
  });

  it("returns empty guidance values for no samples", () => {
    expect(renderVoiceSampleGuidance([])).toEqual({
      content: "",
      charCount: 0,
      truncated: false,
    } satisfies RenderedVoiceSamples);
  });

  it("clips rendered voice guidance to 2400 chars and marks truncation", () => {
    const rendered = renderVoiceSampleGuidance([
      voiceSample({ id: "sample-long", text: "x".repeat(2_500) }),
    ]);

    expect(rendered.content.length).toBeLessThanOrEqual(2_400);
    expect(rendered.content).toHaveLength(2_400);
    expect(rendered.charCount).toBe(rendered.content.length);
    expect(rendered.truncated).toBe(true);
  });
});
