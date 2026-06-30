import { describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  createLocalHashingVoiceEmbedder,
  decodeVoiceVector,
  encodeVoiceVector,
} from "../voice-embedder.js";

describe("local hashing voice embedder", () => {
  it("produces byte-stable embeddings for identical text", () => {
    const embedder = createLocalHashingVoiceEmbedder();

    const first = encodeVoiceVector(embedder.embedText("Ship the smallest honest version."));
    const second = encodeVoiceVector(embedder.embedText("Ship the smallest honest version."));

    expect(first.equals(second)).toBe(true);
  });

  it("scores near-duplicate voice text higher than unrelated text", () => {
    const embedder = createLocalHashingVoiceEmbedder();
    const source = embedder.embedText("Build the smallest honest version and ship it.");
    const near = embedder.embedText("Ship the smallest honest version before adding ceremony.");
    const unrelated = embedder.embedText("Pasta water needs salt before the noodles go in.");

    const nearScore = cosineSimilarity(source, near);
    const unrelatedScore = cosineSimilarity(source, unrelated);

    expect(nearScore).toBeTypeOf("number");
    expect(unrelatedScore).toBeTypeOf("number");
    expect(nearScore!).toBeGreaterThan(unrelatedScore!);
  });

  it("round-trips vectors through little-endian BLOB encoding", () => {
    const embedder = createLocalHashingVoiceEmbedder(8);
    const vector = embedder.embedText("round trip voice vector");
    const decoded = decodeVoiceVector(encodeVoiceVector(vector), 8);

    expect(decoded).toBeDefined();
    expect(Array.from(decoded!)).toEqual(Array.from(vector));
  });

  it("rejects malformed vector blobs and invalid dimensions", () => {
    expect(decodeVoiceVector(Buffer.alloc(3), 1)).toBeUndefined();
    expect(decodeVoiceVector(Buffer.alloc(4), 0)).toBeUndefined();

    const nanBlob = Buffer.alloc(4);
    nanBlob.writeFloatLE(Number.NaN, 0);
    expect(decodeVoiceVector(nanBlob, 1)).toBeUndefined();
  });

  it("handles empty text as a zero-safe vector", () => {
    const embedder = createLocalHashingVoiceEmbedder(4);
    const empty = embedder.embedText("   ");
    const nonEmpty = embedder.embedText("voice");

    expect(empty).toHaveLength(4);
    expect(Array.from(empty)).toEqual([0, 0, 0, 0]);
    expect(cosineSimilarity(empty, nonEmpty)).toBeUndefined();
  });
});
