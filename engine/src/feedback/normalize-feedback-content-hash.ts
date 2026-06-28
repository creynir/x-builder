import { createHash } from "node:crypto";

export const normalizeFeedbackContent = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim();

export const normalizeFeedbackContentHash = (text: string): string => {
  const normalized = normalizeFeedbackContent(text);
  const digest = createHash("sha256")
    .update(`sha256:mfl:v1:${normalized}`)
    .digest("hex");

  return `sha256:${digest}`;
};
