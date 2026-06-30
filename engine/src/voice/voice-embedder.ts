export type VoiceEmbedder = {
  id: "local-hashing-voice-embedder";
  version: string;
  dimensions: number;
  embedText(text: string): Float32Array;
};

const DEFAULT_DIMENSIONS = 384;
const EMBEDDER_VERSION = "1";

const normalizeText = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s#@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hashFeature = (feature: string): number => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

const addFeature = (vector: Float32Array, feature: string, weight: number): void => {
  if (feature.length === 0) {
    return;
  }

  const hash = hashFeature(feature);
  const index = hash % vector.length;
  const sign = hash & 1 ? 1 : -1;

  vector[index] = (vector[index] ?? 0) + sign * weight;
};

const normalizeVector = (vector: Float32Array): Float32Array => {
  let magnitudeSquared = 0;

  for (const value of vector) {
    magnitudeSquared += value * value;
  }

  if (magnitudeSquared === 0) {
    return vector;
  }

  const magnitude = Math.sqrt(magnitudeSquared);

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = vector[index]! / magnitude;
  }

  return vector;
};

const embedNormalizedText = (text: string, dimensions: number): Float32Array => {
  const vector = new Float32Array(dimensions);
  const normalized = normalizeText(text);

  if (normalized.length === 0) {
    return vector;
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);

  for (const token of tokens) {
    addFeature(vector, `tok:${token}`, 1);
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    addFeature(vector, `bigram:${tokens[index]} ${tokens[index + 1]}`, 0.8);
  }

  const compact = normalized.replace(/\s+/g, " ");
  for (let index = 0; index < compact.length - 2; index += 1) {
    addFeature(vector, `tri:${compact.slice(index, index + 3)}`, 0.35);
  }

  return normalizeVector(vector);
};

export const createLocalHashingVoiceEmbedder = (
  dimensions = DEFAULT_DIMENSIONS,
): VoiceEmbedder => {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("Voice embedder dimensions must be a positive integer.");
  }

  return {
    id: "local-hashing-voice-embedder",
    version: EMBEDDER_VERSION,
    dimensions,
    embedText(text) {
      return embedNormalizedText(text, dimensions);
    },
  };
};

export const encodeVoiceVector = (vector: Float32Array): Buffer => {
  const buffer = Buffer.alloc(vector.length * 4);

  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index]!, index * 4);
  }

  return buffer;
};

export const decodeVoiceVector = (
  blob: Buffer,
  dimensions: number,
): Float32Array | undefined => {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || blob.length !== dimensions * 4) {
    return undefined;
  }

  const vector = new Float32Array(dimensions);

  for (let index = 0; index < dimensions; index += 1) {
    const value = blob.readFloatLE(index * 4);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    vector[index] = value;
  }

  return vector;
};

export const cosineSimilarity = (
  left: Float32Array,
  right: Float32Array,
): number | undefined => {
  if (left.length === 0 || left.length !== right.length) {
    return undefined;
  }

  let dot = 0;
  let leftMagnitudeSquared = 0;
  let rightMagnitudeSquared = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return undefined;
    }

    dot += leftValue * rightValue;
    leftMagnitudeSquared += leftValue * leftValue;
    rightMagnitudeSquared += rightValue * rightValue;
  }

  if (leftMagnitudeSquared === 0 || rightMagnitudeSquared === 0) {
    return undefined;
  }

  return dot / (Math.sqrt(leftMagnitudeSquared) * Math.sqrt(rightMagnitudeSquared));
};
