import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const loadServerSource = async (): Promise<string> =>
  readFile(new URL("../server.ts", import.meta.url), "utf8");

describe("buildServer generation guidance construction", () => {
  it("passes an external pattern guidance provider into the default generation resolver", async () => {
    const source = await loadServerSource();

    expect(source).toMatch(
      /createGenerationGuidanceResolver\(\{[\s\S]*externalPatternGuidanceProvider[\s\S]*\}\)/,
    );
  });

  it("shares the host external signals repository between the default service and generation guidance provider", async () => {
    const source = await loadServerSource();

    expect(source).toMatch(
      /new ExternalXSignalsService\(\{\s*repository:\s*engineStorage\.externalXSignalsRepository\s*\}\)/,
    );
    expect(source).toMatch(
      /externalPatternGuidanceProvider[\s\S]*engineStorage\.externalXSignalsRepository/,
    );
  });
});
