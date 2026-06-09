export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function getNonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

export function countRawLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

export function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}
