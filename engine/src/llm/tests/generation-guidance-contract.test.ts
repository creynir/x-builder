import { describe, expect, expectTypeOf, it } from "vitest";
import { detectedPostFormatSchema, type DetectedPostFormat } from "@x-builder/shared";
import type {
  FormatPlaybookMapping,
  GenerationContext,
  GenerationGuidanceRequest,
  GenerationGuidanceResolver,
  PlaybookSlice,
  VoiceSamplePost,
} from "../generation-guidance.js";

type MappingEntry = {
  sectionIds?: unknown;
  priority?: unknown;
  includeFallbackGeneral?: unknown;
  founderStoryGuardrail?: unknown;
};

type GuidanceContractModule = {
  formatPlaybookMapping?: Record<string, MappingEntry>;
};

const loadGuidanceContract = async (): Promise<GuidanceContractModule> =>
  import("../generation-guidance.js") as Promise<GuidanceContractModule>;

const detectedFormats = detectedPostFormatSchema.options as DetectedPostFormat[];

const mappingEntries = async () => {
  const { formatPlaybookMapping } = await loadGuidanceContract();

  expect(formatPlaybookMapping).toBeDefined();
  expect(formatPlaybookMapping).not.toBeNull();
  expect(typeof formatPlaybookMapping).toBe("object");

  return formatPlaybookMapping!;
};

describe("generation guidance playbook mapping", () => {
  it("exports the documented generation guidance data model types", () => {
    expectTypeOf<GenerationGuidanceRequest>().toEqualTypeOf<{
      format: DetectedPostFormat;
      idea?: string;
      voiceProfileId?: string;
      useKnownPostIds: string[];
    }>();

    expectTypeOf<FormatPlaybookMapping>().toEqualTypeOf<
      Readonly<
        Record<
          DetectedPostFormat,
          {
            sectionIds: string[];
            priority: "primary" | "secondary";
            includeFallbackGeneral: boolean;
          }
        >
      >
    >();

    expectTypeOf<PlaybookSlice>().toEqualTypeOf<{
      format: DetectedPostFormat;
      sourcePath?: string;
      sections: Array<{
        id: string;
        heading: string;
        content: string;
        charCount: number;
      }>;
      content: string;
      charCount: number;
      truncated: boolean;
    }>();

    expectTypeOf<VoiceSamplePost>().toEqualTypeOf<{
      id: string;
      platformPostId: string;
      text: string;
      createdAt: string;
      kind: "original";
      source: "known_post_id" | "profile_sample" | "recent_original";
    }>();

    expectTypeOf<GenerationContext>().toEqualTypeOf<{
      request: GenerationGuidanceRequest;
      playbook: PlaybookSlice;
      voiceSamples: VoiceSamplePost[];
      renderedGuidance?: string;
    }>();

    expectTypeOf<GenerationGuidanceResolver>().toEqualTypeOf<
      (request: GenerationGuidanceRequest) => Promise<string | undefined>
    >();
  });

  it("maps every detected post format exactly once", async () => {
    const mapping = await mappingEntries();

    expect(Object.keys(mapping).sort()).toEqual([...detectedFormats].sort());
  });

  it.each(detectedFormats)("declares explicit playbook selection for %s", async (format) => {
    const mapping = await mappingEntries();
    const entry = mapping[format];

    expect(entry).toBeDefined();
    const sectionIds = entry?.sectionIds;

    expect(Array.isArray(sectionIds)).toBe(true);
    if (!Array.isArray(sectionIds)) {
      throw new Error(`Expected ${format} to declare explicit section ids.`);
    }
    expect(sectionIds).not.toHaveLength(0);
    for (const sectionId of sectionIds) {
      expect(typeof sectionId).toBe("string");
      expect(sectionId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
    expect(entry?.priority).toSatisfy((value) => value === "primary" || value === "secondary");
    expect(typeof entry?.includeFallbackGeneral).toBe("boolean");
  });

  it("keeps the catch-all format limited to general guidance", async () => {
    const mapping = await mappingEntries();

    expect(mapping.other).toMatchObject({
      sectionIds: ["general"],
      priority: "secondary",
      includeFallbackGeneral: true,
    });
  });

  it("exposes a no-emotional-generation guardrail for founder story guidance", async () => {
    const mapping = await mappingEntries();

    expect(mapping.founder_story).toMatchObject({
      founderStoryGuardrail: {
        preserveUserSuppliedStakes: true,
        forbidInventedEmotionalContent: true,
      },
    });
  });
});
