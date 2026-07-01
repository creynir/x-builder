import { createHash } from "node:crypto";

export const generatedReplyHashNamespace = "sha256:rva-generated-reply:v1:";

export const normalizeGeneratedReplyText = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim();

export const generatedReplyContentHash = (text: string): string =>
  `${generatedReplyHashNamespace}${createHash("sha256")
    .update(normalizeGeneratedReplyText(text))
    .digest("hex")}`;
