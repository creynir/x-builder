import { describe, expect, it } from "vitest";

import {
  addExternalXSignalSourceRequestSchema,
  externalXSignalEvidenceSchema,
  externalXSignalPatternSchema,
  getExternalXSignalsOverviewRequestSchema,
  getExternalXSignalsOverviewResponseSchema,
} from "../external-x-signals.js";
import { apiErrorSchema } from "../shell.js";

const iso = "2026-06-28T12:00:00.000Z";

const source = {
  id: "source-1",
  platform: "x",
  screenName: "external_builder",
  status: "active",
  evidenceCount: 1,
  patternCount: 1,
  createdAt: iso,
  updatedAt: iso,
};

const evidence = {
  id: "evidence-1",
  sourceId: "source-1",
  platform: "x",
  platformPostId: "1800000000000000001",
  screenName: "external_builder",
  text: "External evidence post with a concrete launch lesson.",
  evidenceSource: "external_x_graphql_observe",
  observedAt: iso,
  metrics: { likes: 10, reposts: 2 },
};

describe("external X signal shared schemas", () => {
  it("normalizes add-source handles and preserves X ids as strings", () => {
    const parsed = addExternalXSignalSourceRequestSchema.parse({
      screenName: "  @External_Builder  ",
      platformUserId: "1800000000000000001",
    });

    expect(parsed.screenName).toBe("external_builder");
    expect(parsed.platformUserId).toBe("1800000000000000001");
  });

  it("rejects empty handles and negative metrics", () => {
    expect(() => addExternalXSignalSourceRequestSchema.parse({ screenName: " @ " })).toThrow();
    expect(() =>
      externalXSignalEvidenceSchema.parse({
        ...evidence,
        metrics: { likes: -1 },
      }),
    ).toThrow();
  });

  it("accepts overview responses with sources, totals, patterns, recent evidence, and refresh runs", () => {
    const pattern = externalXSignalPatternSchema.parse({
      id: "pattern-1",
      patternType: "hook",
      label: "Concrete launch proof",
      statement: "Top examples use specific evidence in the first sentence.",
      confidence: 0.7,
      supportCount: 3,
      sourceIds: ["source-1"],
      evidenceIds: ["evidence-1"],
      evidence: [
        {
          evidenceId: "evidence-1",
          sourceId: "source-1",
          screenName: "@External_Builder",
          platformPostId: "1800000000000000001",
          text: "External evidence preview",
          metrics: { likes: 10 },
        },
      ],
      generatedAt: iso,
      version: "external-x-signals:v1",
    });

    const parsed = getExternalXSignalsOverviewResponseSchema.parse({
      generatedAt: iso,
      sources: [source],
      totals: {
        sources: 1,
        activeSources: 1,
        evidence: 1,
        patterns: 1,
        refreshRuns: 1,
      },
      patterns: [pattern],
      recentEvidence: [evidence],
      refreshRuns: [
        {
          id: "run-1",
          sourceId: "source-1",
          status: "captured",
          startedAt: iso,
          completedAt: iso,
          evidenceCount: 1,
        },
      ],
    });

    expect(parsed.sources).toHaveLength(1);
    expect(parsed.patterns[0]?.evidence[0]?.screenName).toBe("external_builder");
    expect(parsed.recentEvidence[0]?.platformPostId).toBe("1800000000000000001");
  });

  it("defaults bounded overview requests", () => {
    const parsed = getExternalXSignalsOverviewRequestSchema.parse({});

    expect(parsed.includeRemoved).toBe(false);
    expect(parsed.sourceLimit).toBe(25);
    expect(parsed.patternLimit).toBe(20);
  });

  it("accepts external-x-signals API errors and rejects stale API names by absence", () => {
    expect(
      apiErrorSchema.parse({
        code: "external_x_signals_overview_failed",
        scope: "external-x-signals",
        message: "Could not load external signals.",
        retryable: true,
      }),
    ).toMatchObject({ scope: "external-x-signals" });

    expect(() =>
      apiErrorSchema.parse({
        code: "legacy_external_import",
        scope: "external-x-signals",
        message: "stale",
        retryable: true,
      }),
    ).toThrow();
  });
});
