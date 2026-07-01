import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { appSettingsSchema, type AppSettings } from "@x-builder/shared";
import * as ts from "typescript";

import type {
  CanonicalOwnPost,
  PostLibraryRepository,
  PostLibraryStore,
} from "../../server/post-library-repository.js";
import type { AppSettingsRepository } from "../../server/settings-repository.js";
import type {
  ArchiveVoiceProfile,
  CreateGenerationGuidanceResolverInput,
  GenerationGuidanceRequest,
  GenerationGuidanceResolver,
  VoiceSampleProvider,
} from "../generation-guidance.js";
import type { ArchiveVoiceProfileProvider } from "../../voice/archive-voice-profile-service.js";
import type {
  ExternalPatternGuidanceItem,
  ExternalPatternGuidanceProvider,
} from "../external-pattern-guidance.js";

const BASE_DATE = "2026-06-01T00:00:00.000Z";
const FOUNDER_STORY_GUARDRAIL =
  "Founder-story guardrail: never invent, suggest, or prompt emotional content; only preserve stakes the user supplied.";

const tempDirs: string[] = [];

const defaultSettings = appSettingsSchema.parse({
  engineBaseUrl: "http://127.0.0.1:4173",
  storagePath: "/tmp/x-builder-generation-guidance-test-storage",
  judgeProvider: "codex-cli",
  showDeterministicDetails: true,
});

const entityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

const replyContext = {
  source: "same_dialog_dom",
  targetAuthorHandle: "alice",
  targetText: "The clever version rarely survives contact.",
  targetStatusId: "1930000000000000001",
  leadingTargetHandle: {
    handle: "alice",
    state: "present",
  },
} as const;

type GuidanceResolverModule = {
  createGenerationGuidanceResolver?: (
    input: CreateGenerationGuidanceResolverInput,
  ) => GenerationGuidanceResolver;
};

const loadGuidanceResolverModule = async (): Promise<GuidanceResolverModule> =>
  import("../generation-guidance.js") as Promise<GuidanceResolverModule>;

const barrelExportsGenerationGuidanceResolver = (indexSource: string): boolean => {
  const sourceFile = ts.createSourceFile(
    "index.ts",
    indexSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return sourceFile.statements.some((statement) => {
    if (!ts.isExportDeclaration(statement)) {
      return false;
    }

    const moduleSpecifier = statement.moduleSpecifier;
    if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) {
      return false;
    }

    if (moduleSpecifier.text !== "./llm/generation-guidance.js") {
      return false;
    }

    const exportClause = statement.exportClause;
    if (exportClause === undefined) {
      return true;
    }

    if (!ts.isNamedExports(exportClause)) {
      return false;
    }

    return exportClause.elements.some(
      (element) => element.name.text === "createGenerationGuidanceResolver",
    );
  });
};

const propertyNameText = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
};

const isRequestVoiceProfileId = (expression: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === "request" &&
  expression.name.text === "voiceProfileId";

const findCreateGenerationGuidanceResolverNode = (sourceFile: ts.SourceFile): ts.Node | undefined => {
  let resolverNode: ts.Node | undefined;

  const visit = (node: ts.Node): void => {
    if (resolverNode !== undefined) {
      return;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createGenerationGuidanceResolver"
    ) {
      resolverNode = node;
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "createGenerationGuidanceResolver"
    ) {
      resolverNode = node.initializer ?? node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return resolverNode;
};

const collectRequestVoiceProfileBindings = (resolverNode: ts.Node): Set<string> => {
  const bindings = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (ts.isIdentifier(node.name) && isRequestVoiceProfileId(node.initializer)) {
        bindings.add(node.name.text);
      }

      if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(node.initializer)) {
        if (node.initializer.text === "request") {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) {
              continue;
            }

            const propertyName = element.propertyName ?? element.name;
            if (propertyNameText(propertyName) === "voiceProfileId") {
              bindings.add(element.name.text);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(resolverNode);

  return bindings;
};

const callForwardsVoiceProfileId = (
  call: ts.CallExpression,
  voiceProfileBindings: Set<string>,
): boolean => {
  const [input] = call.arguments;
  if (input === undefined || !ts.isObjectLiteralExpression(input)) {
    return false;
  }

  return input.properties.some((property) => {
    if (ts.isPropertyAssignment(property)) {
      if (propertyNameText(property.name) !== "voiceProfileId") {
        return false;
      }

      return (
        isRequestVoiceProfileId(property.initializer) ||
        (ts.isIdentifier(property.initializer) && voiceProfileBindings.has(property.initializer.text))
      );
    }

    return (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === "voiceProfileId" &&
      voiceProfileBindings.has(property.name.text)
    );
  });
};

const resolverForwardsVoiceProfileIdToVoiceSelection = (guidanceSource: string): boolean => {
  if (
    guidanceSource.includes("resolveVoiceSamples(input, request)") &&
    guidanceSource.includes("voiceProfileId: request.voiceProfileId")
  ) {
    return true;
  }

  const sourceFile = ts.createSourceFile(
    "generation-guidance.ts",
    guidanceSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const resolverNode = findCreateGenerationGuidanceResolverNode(sourceFile);
  if (resolverNode === undefined) {
    return false;
  }

  const voiceProfileBindings = collectRequestVoiceProfileBindings(resolverNode);
  let forwardsVoiceProfileId = false;

  const visit = (node: ts.Node): void => {
    if (forwardsVoiceProfileId) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "selectVoiceSamples" &&
      callForwardsVoiceProfileId(node, voiceProfileBindings)
    ) {
      forwardsVoiceProfileId = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(resolverNode);

  return forwardsVoiceProfileId;
};

async function writeKnowledgeBase(markdown: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "generation-guidance-resolver-"));
  tempDirs.push(tempDir);

  const knowledgeBasePath = join(tempDir, "knowledge-base.md");
  await writeFile(knowledgeBasePath, markdown, "utf8");

  return knowledgeBasePath;
}

const settingsWithKnowledgeBasePath = (knowledgeBasePath?: string): AppSettings => ({
  ...defaultSettings,
  ...(knowledgeBasePath === undefined ? {} : { knowledgeBasePath }),
});

const settingsRepositoryOf = (
  knowledgeBasePath?: string,
): Pick<AppSettingsRepository, "load"> => ({
  load: async () => ({
    settings: settingsWithKnowledgeBasePath(knowledgeBasePath),
    source: "persisted",
    updatedAt: BASE_DATE,
  }),
});

const failingSettingsRepository = (): Pick<AppSettingsRepository, "load"> => ({
  load: async () => {
    throw new Error("settings failed");
  },
});

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

const storeOf = (posts: CanonicalOwnPost[]): PostLibraryStore => ({
  schemaVersion: 2,
  updatedAt: BASE_DATE,
  posts,
  importRuns: [],
  derivedInsights: [],
  activeContext: { status: "empty" },
  profileSnapshots: [],
});

const postLibraryRepositoryOf = (
  posts: CanonicalOwnPost[],
): Pick<PostLibraryRepository, "loadStore"> => ({
  loadStore: async () => storeOf(posts),
});

const failingPostLibraryRepository = (): Pick<PostLibraryRepository, "loadStore"> => ({
  loadStore: async () => {
    throw new Error("post library failed");
  },
});

const emptyPostLibraryRepository = (): Pick<PostLibraryRepository, "loadStore"> =>
  postLibraryRepositoryOf([]);

const requestOf = (
  overrides: Partial<GenerationGuidanceRequest> = {},
): GenerationGuidanceRequest => ({
  format: "hot_take",
  useKnownPostIds: [],
  ...overrides,
});

const externalGuidanceItem = (
  overrides: Partial<ExternalPatternGuidanceItem> = {},
): ExternalPatternGuidanceItem => ({
  id: overrides.id ?? "external-pattern-1",
  patternType: overrides.patternType ?? "hook",
  statement:
    overrides.statement ??
    "Open with a specific operator mistake before naming the broader lesson.",
  confidence: overrides.confidence ?? 0.84,
  supportCount: overrides.supportCount ?? 9,
  generatedAt: overrides.generatedAt ?? "2026-06-29T08:00:00.000Z",
  version: overrides.version ?? "external-x-signals:v1",
  ...(overrides.format === undefined ? {} : { format: overrides.format }),
});

const externalPatternProviderOf = (
  items: ExternalPatternGuidanceItem[],
): ReturnType<typeof vi.fn<ExternalPatternGuidanceProvider>> =>
  vi.fn(async (_request) => items);

const archiveVoiceProfile = (
  overrides: Partial<ArchiveVoiceProfile> = {},
): ArchiveVoiceProfile => ({
  profileId: overrides.profileId ?? "archive-voice-profile-v1:abc",
  ruleVersion: overrides.ruleVersion ?? "archive-voice-profile-v1",
  corpusHash: overrides.corpusHash ?? "sha256:abc",
  generatedAt: overrides.generatedAt ?? BASE_DATE,
  modelProvider: overrides.modelProvider ?? "codex-cli",
  sourceCounts: overrides.sourceCounts ?? { posts: 12, replies: 8 },
  summary: overrides.summary ?? "Direct, concrete, low-hype operator voice.",
  syntaxHabits: overrides.syntaxHabits ?? ["Short opening sentence before the explanation."],
  toneBoundaries: overrides.toneBoundaries ?? ["No cheerleading or generic praise."],
  recurringMoves: overrides.recurringMoves ?? ["Names the tradeoff before the recommendation."],
  antiPatterns: overrides.antiPatterns ?? ["Avoid engagement-bait questions."],
  postRules: overrides.postRules ?? ["Post rule sentinel: make the claim concrete."],
  replyRules: overrides.replyRules ?? ["Reply rule sentinel: answer the target directly."],
  evidencePostIds: overrides.evidencePostIds ?? ["post-1"],
  evidence: overrides.evidence ?? [],
  ...(overrides.modelId === undefined ? {} : { modelId: overrides.modelId }),
});

const archiveVoiceProfileProviderOf = (
  profile: ArchiveVoiceProfile | undefined,
): ReturnType<typeof vi.fn<ArchiveVoiceProfileProvider>> =>
  vi.fn(async (_request) => profile);

const guidanceInputWithExternalProvider = (
  input: CreateGenerationGuidanceResolverInput,
  externalPatternGuidanceProvider: ExternalPatternGuidanceProvider,
): CreateGenerationGuidanceResolverInput & {
  externalPatternGuidanceProvider: ExternalPatternGuidanceProvider;
} => ({
  ...input,
  externalPatternGuidanceProvider,
});

const createResolver = async (
  input: CreateGenerationGuidanceResolverInput,
): Promise<GenerationGuidanceResolver> => {
  const module = await loadGuidanceResolverModule();

  expect(module.createGenerationGuidanceResolver).toBeTypeOf("function");

  return module.createGenerationGuidanceResolver!(input);
};

const resolveGuidance = async (
  input: CreateGenerationGuidanceResolverInput,
  request: GenerationGuidanceRequest = requestOf(),
): Promise<string | undefined> => {
  const resolver = await createResolver(input);

  return resolver(request);
};

const expectDefinedGuidance = (guidance: string | undefined): string => {
  expect(guidance).toBeDefined();

  return guidance!;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

describe("generation guidance resolver", () => {
  it("exports the documented resolver factory contract", async () => {
    expectTypeOf<CreateGenerationGuidanceResolverInput>().toEqualTypeOf<{
      settingsRepository: Pick<AppSettingsRepository, "load">;
      postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
      externalPatternGuidanceProvider?: ExternalPatternGuidanceProvider;
      archiveVoiceProfileProvider?: ArchiveVoiceProfileProvider;
      voiceSampleProvider?: VoiceSampleProvider;
      defaultKnowledgeBasePath?: string;
    }>();

    expectTypeOf<GenerationGuidanceResolver>().toEqualTypeOf<
      (request: GenerationGuidanceRequest) => Promise<string | undefined>
    >();

    const module = await loadGuidanceResolverModule();

    expect(module.createGenerationGuidanceResolver).toBeTypeOf("function");
  });

  it("declares the resolver factory on the engine barrel", async () => {
    const indexSource = await readFile(new URL("../../index.ts", import.meta.url), "utf8");

    expect(barrelExportsGenerationGuidanceResolver(indexSource)).toBe(true);
  });

  it("declares voice profile metadata forwarding into voice sample selection", async () => {
    const guidanceSource = await readFile(new URL("../generation-guidance.ts", import.meta.url), "utf8");

    expect(resolverForwardsVoiceProfileIdToVoiceSelection(guidanceSource)).toBe(true);
  });

  it("renders requested playbook guidance and voice samples together", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

FORMAT_TAXONOMY_HOT_TAKE_SENTINEL

## Status gate

STATUS_GATE_HOT_TAKE_SENTINEL

## Core finding

UNRELATED_CORE_FINDING_SENTINEL

## Growth loop

UNRELATED_GROWTH_LOOP_SENTINEL
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        {
          settingsRepository: settingsRepositoryOf(`  ${knowledgeBasePath}
`),
          postLibraryRepository: postLibraryRepositoryOf([
            canonicalPost({
              id: "post-known",
              platformPostId: "platform-known",
              text: "known voice sample",
              createdAt: "2026-06-05T00:00:00.000Z",
            }),
          ]),
        },
        requestOf({ useKnownPostIds: ["platform-known"], voiceProfileId: "profile-alpha" }),
      ),
    );

    expect(guidance).toContain("# Requested format playbook");
    expect(guidance).toContain("FORMAT_TAXONOMY_HOT_TAKE_SENTINEL");
    expect(guidance).toContain("STATUS_GATE_HOT_TAKE_SENTINEL");
    expect(guidance).toContain("# Voice samples (match tone, do not copy)");
    expect(guidance).toContain("- known voice sample");
    expect(guidance).not.toContain("UNRELATED_CORE_FINDING_SENTINEL");
    expect(guidance).not.toContain("UNRELATED_GROWTH_LOOP_SENTINEL");
  });

  it("uses the default knowledge base path when settings has no configured path", async () => {
    const defaultKnowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

DEFAULT_FORMAT_TAXONOMY_SENTINEL

## Status gate

DEFAULT_STATUS_GATE_SENTINEL
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: settingsRepositoryOf(),
        postLibraryRepository: postLibraryRepositoryOf([]),
        defaultKnowledgeBasePath,
      }),
    );

    expect(guidance).toContain("DEFAULT_FORMAT_TAXONOMY_SENTINEL");
    expect(guidance).toContain("DEFAULT_STATUS_GATE_SENTINEL");
  });

  it("lets an explicit settings knowledge base override the default path", async () => {
    const defaultKnowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

DEFAULT_FORMAT_TAXONOMY_SENTINEL
`);
    const explicitKnowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

EXPLICIT_FORMAT_TAXONOMY_SENTINEL
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: settingsRepositoryOf(explicitKnowledgeBasePath),
        postLibraryRepository: postLibraryRepositoryOf([]),
        defaultKnowledgeBasePath,
      }),
    );

    expect(guidance).toContain("EXPLICIT_FORMAT_TAXONOMY_SENTINEL");
    expect(guidance).not.toContain("DEFAULT_FORMAT_TAXONOMY_SENTINEL");
  });

  it("uses an injected voice sample provider before repository fallback", async () => {
    const module = await loadGuidanceResolverModule();
    const resolver = module.createGenerationGuidanceResolver!({
      settingsRepository: settingsRepositoryOf(),
      postLibraryRepository: postLibraryRepositoryOf([
        canonicalPost({ id: "fallback", text: "fallback repository voice" }),
      ]),
      voiceSampleProvider: async () => [
        {
          id: "rag",
          platformPostId: "rag-platform",
          text: "retrieved rag voice",
          createdAt: BASE_DATE,
          kind: "original",
          source: "voice_rag",
          score: 0.9,
          indexedAt: BASE_DATE,
        },
      ],
    });

    const guidance = await resolver(requestOf({ idea: "retrieval" }));

    expect(guidance).toContain("- retrieved rag voice");
    expect(guidance).not.toContain("fallback repository voice");
  });

  it("falls back to repository voice samples when the injected provider fails", async () => {
    const module = await loadGuidanceResolverModule();
    const resolver = module.createGenerationGuidanceResolver!({
      settingsRepository: settingsRepositoryOf(),
      postLibraryRepository: postLibraryRepositoryOf([
        canonicalPost({ id: "fallback", text: "fallback repository voice" }),
      ]),
      voiceSampleProvider: async () => {
        throw new Error("voice provider failed");
      },
    });

    const guidance = await resolver(requestOf({ idea: "fallback" }));

    expect(guidance).toContain("- fallback repository voice");
  });

  it("renders external performance patterns after playbook guidance and before own voice samples", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

ORDERED_PLAYBOOK_SENTINEL
`);
    const externalProvider = externalPatternProviderOf([
      externalGuidanceItem({
        format: "hot_take",
        statement: "ORDERED_EXTERNAL_PATTERN_SENTINEL",
      }),
    ]);

    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        guidanceInputWithExternalProvider(
          {
            settingsRepository: settingsRepositoryOf(knowledgeBasePath),
            postLibraryRepository: postLibraryRepositoryOf([
              canonicalPost({
                id: "post-voice",
                platformPostId: "platform-voice",
                text: "ORDERED_OWN_VOICE_SENTINEL",
              }),
            ]),
          },
          externalProvider,
        ),
        requestOf({
          format: "hot_take",
          idea: "How to turn external reach patterns into draft constraints",
          voiceProfileId: "voice-alpha",
          useKnownPostIds: ["platform-voice"],
        }),
      ),
    );

    expect(externalProvider).toHaveBeenCalledTimes(1);
    expect(externalProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "hot_take",
        idea: "How to turn external reach patterns into draft constraints",
        voiceProfileId: "voice-alpha",
        useKnownPostIds: ["platform-voice"],
      }),
    );

    const playbookIndex = guidance.indexOf("# Requested format playbook");
    const externalIndex = guidance.indexOf(
      "# External performance patterns (derived constraints, not voice)",
    );
    const voiceIndex = guidance.indexOf("# Voice samples (match tone, do not copy)");

    expect(guidance).toContain("ORDERED_PLAYBOOK_SENTINEL");
    expect(guidance).toContain("ORDERED_EXTERNAL_PATTERN_SENTINEL");
    expect(guidance).toContain("ORDERED_OWN_VOICE_SENTINEL");
    expect(playbookIndex).toBeGreaterThanOrEqual(0);
    expect(externalIndex).toBeGreaterThan(playbookIndex);
    expect(voiceIndex).toBeGreaterThan(externalIndex);
  });

  it("renders archive voice profile rules after external patterns and before own voice samples", async () => {
    const externalProvider = externalPatternProviderOf([
      externalGuidanceItem({ statement: "ORDERED_EXTERNAL_PATTERN_SENTINEL" }),
    ]);
    const profileProvider = archiveVoiceProfileProviderOf(
      archiveVoiceProfile({
        summary: "ORDERED_ARCHIVE_PROFILE_SUMMARY",
        postRules: ["ORDERED_ARCHIVE_POST_RULE"],
      }),
    );

    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        {
          settingsRepository: settingsRepositoryOf(),
          postLibraryRepository: postLibraryRepositoryOf([
            canonicalPost({ id: "voice", text: "ORDERED_SAMPLE_SENTINEL" }),
          ]),
          externalPatternGuidanceProvider: externalProvider,
          archiveVoiceProfileProvider: profileProvider,
        },
        requestOf({ format: "hot_take" }),
      ),
    );

    expect(profileProvider).toHaveBeenCalledWith({ surface: "post" });
    expect(guidance).toContain("# Archive voice profile (derived from local corpus)");
    expect(guidance).toContain("ORDERED_ARCHIVE_PROFILE_SUMMARY");
    expect(guidance).toContain("ORDERED_ARCHIVE_POST_RULE");
    expect(guidance).not.toContain("Reply rule sentinel");

    const externalIndex = guidance.indexOf("# External performance patterns");
    const profileIndex = guidance.indexOf("# Archive voice profile");
    const sampleIndex = guidance.indexOf("# Voice samples");

    expect(externalIndex).toBeGreaterThanOrEqual(0);
    expect(profileIndex).toBeGreaterThan(externalIndex);
    expect(sampleIndex).toBeGreaterThan(profileIndex);
  });

  it("uses reply-specific archive voice rules for reply generation", async () => {
    const profileProvider = archiveVoiceProfileProviderOf(
      archiveVoiceProfile({
        postRules: ["POST_RULE_MUST_NOT_RENDER_FOR_REPLY"],
        replyRules: ["REPLY_RULE_MUST_RENDER"],
      }),
    );

    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        {
          settingsRepository: settingsRepositoryOf(),
          postLibraryRepository: postLibraryRepositoryOf([]),
          archiveVoiceProfileProvider: profileProvider,
        },
        requestOf({ replyContext }),
      ),
    );

    expect(profileProvider).toHaveBeenCalledWith({ surface: "reply" });
    expect(guidance).toContain("Reply-specific rules");
    expect(guidance).toContain("REPLY_RULE_MUST_RENDER");
    expect(guidance).not.toContain("POST_RULE_MUST_NOT_RENDER_FOR_REPLY");
  });

  it("omits only the archive voice section when the profile provider fails", async () => {
    const profileProvider = vi.fn(async () => {
      throw new Error("profile unavailable");
    }) as ReturnType<typeof vi.fn<ArchiveVoiceProfileProvider>>;

    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: settingsRepositoryOf(),
        postLibraryRepository: postLibraryRepositoryOf([
          canonicalPost({ id: "fallback", text: "FALLBACK_SAMPLE_STILL_RENDERS" }),
        ]),
        archiveVoiceProfileProvider: profileProvider,
      }),
    );

    expect(guidance).not.toContain("# Archive voice profile");
    expect(guidance).toContain("FALLBACK_SAMPLE_STILL_RENDERS");
  });

  it("omits only the external section when the external pattern provider fails", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

PROVIDER_FAILURE_PLAYBOOK_SURVIVES
`);
    const externalProvider = vi.fn(async () => {
      throw new Error("external guidance unavailable");
    }) as ReturnType<typeof vi.fn<ExternalPatternGuidanceProvider>>;

    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        guidanceInputWithExternalProvider(
          {
            settingsRepository: settingsRepositoryOf(knowledgeBasePath),
            postLibraryRepository: postLibraryRepositoryOf([
              canonicalPost({
                id: "post-voice",
                text: "PROVIDER_FAILURE_VOICE_SURVIVES",
              }),
            ]),
          },
          externalProvider,
        ),
      ),
    );

    expect(externalProvider).toHaveBeenCalledTimes(1);
    expect(guidance).toContain("# Requested format playbook");
    expect(guidance).toContain("PROVIDER_FAILURE_PLAYBOOK_SURVIVES");
    expect(guidance).toContain("# Voice samples (match tone, do not copy)");
    expect(guidance).toContain("PROVIDER_FAILURE_VOICE_SURVIVES");
    expect(guidance).not.toContain("# External performance patterns");
  });

  it("omits unrelated knowledge-base sections instead of falling back to the full file", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

REQUESTED_FORMAT_SENTINEL

## Status gate

REQUESTED_STATUS_SENTINEL

## Daily playbook

UNRELATED_DAILY_PLAYBOOK_SENTINEL

## Graph quality

UNRELATED_GRAPH_QUALITY_SENTINEL
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: settingsRepositoryOf(knowledgeBasePath),
        postLibraryRepository: emptyPostLibraryRepository(),
      }),
    );

    expect(guidance).toContain("REQUESTED_FORMAT_SENTINEL");
    expect(guidance).toContain("REQUESTED_STATUS_SENTINEL");
    expect(guidance).not.toContain("UNRELATED_DAILY_PLAYBOOK_SENTINEL");
    expect(guidance).not.toContain("UNRELATED_GRAPH_QUALITY_SENTINEL");
  });

  it("returns voice guidance when settings loading fails", async () => {
    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: failingSettingsRepository(),
        postLibraryRepository: postLibraryRepositoryOf([
          canonicalPost({ id: "post-voice", text: "voice survives settings failure" }),
        ]),
      }),
    );

    expect(guidance).toContain("# Voice samples (match tone, do not copy)");
    expect(guidance).toContain("- voice survives settings failure");
    expect(guidance).not.toContain("# Requested format playbook");
  });

  it("returns playbook guidance when post-library loading fails", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

PLAYBOOK_SURVIVES_POST_LIBRARY_FAILURE
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: settingsRepositoryOf(knowledgeBasePath),
        postLibraryRepository: failingPostLibraryRepository(),
      }),
    );

    expect(guidance).toContain("# Requested format playbook");
    expect(guidance).toContain("PLAYBOOK_SURVIVES_POST_LIBRARY_FAILURE");
    expect(guidance).not.toContain("# Voice samples (match tone, do not copy)");
  });

  it("returns undefined when all dependencies fail", async () => {
    await expect(
      resolveGuidance({
        settingsRepository: failingSettingsRepository(),
        postLibraryRepository: failingPostLibraryRepository(),
      }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for whitespace-only playbook and whitespace-only post text", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(" \n\t\n ");

    await expect(
      resolveGuidance({
        settingsRepository: settingsRepositoryOf(knowledgeBasePath),
        postLibraryRepository: postLibraryRepositoryOf([
          canonicalPost({ id: "blank-post", text: " \n\t " }),
        ]),
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps oversized playbook and voice guidance within helper budgets", async () => {
    const playbookBody = `PLAYBOOK_START
${"p".repeat(6_500)}
PLAYBOOK_END`;
    const voiceText = `VOICE_START ${"v".repeat(2_500)} VOICE_END`;
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Format taxonomy

${playbookBody}
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance({
        settingsRepository: settingsRepositoryOf(knowledgeBasePath),
        postLibraryRepository: postLibraryRepositoryOf([
          canonicalPost({ id: "long-voice", text: voiceText }),
        ]),
      }),
    );
    const playbookHeader = "# Requested format playbook\n";
    const voiceHeader = "\n\n# Voice samples (match tone, do not copy)\n";

    expect(guidance.length).toBeLessThanOrEqual(
      playbookHeader.length + 6_000 + voiceHeader.length + 2_400,
    );
    expect(guidance).toContain("PLAYBOOK_START");
    expect(guidance).not.toContain("PLAYBOOK_END");
    expect(guidance).toContain("- VOICE_START");
    expect(guidance).not.toContain("VOICE_END");
  });

  it("appends the founder-story guardrail when founder-story guidance renders", async () => {
    const knowledgeBasePath = await writeKnowledgeBase(`
# Engine knowledge

## Founder-story

FOUNDER_STORY_PLAYBOOK_SENTINEL
`);

    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        {
          settingsRepository: settingsRepositoryOf(knowledgeBasePath),
          postLibraryRepository: emptyPostLibraryRepository(),
        },
        requestOf({ format: "founder_story" }),
      ),
    );

    expect(guidance).toContain("FOUNDER_STORY_PLAYBOOK_SENTINEL");
    expect(guidance).toContain(FOUNDER_STORY_GUARDRAIL);
  });

  it("appends the founder-story guardrail when only voice guidance renders", async () => {
    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        {
          settingsRepository: failingSettingsRepository(),
          postLibraryRepository: postLibraryRepositoryOf([
            canonicalPost({ id: "founder-voice", text: "founder story voice sample" }),
          ]),
        },
        requestOf({ format: "founder_story" }),
      ),
    );

    expect(guidance).toContain("# Voice samples (match tone, do not copy)");
    expect(guidance).toContain("- founder story voice sample");
    expect(guidance).not.toContain("# Requested format playbook");
    expect(guidance).toContain(FOUNDER_STORY_GUARDRAIL);
  });

  it("forwards known post ids into voice selection while accepting voice profile metadata", async () => {
    const guidance = expectDefinedGuidance(
      await resolveGuidance(
        {
          settingsRepository: settingsRepositoryOf(),
          postLibraryRepository: postLibraryRepositoryOf([
            canonicalPost({
              id: "newest-post",
              platformPostId: "platform-newest",
              text: "newest fallback voice",
              createdAt: "2026-06-10T00:00:00.000Z",
            }),
            canonicalPost({
              id: "known-post",
              platformPostId: "platform-known",
              text: "known requested voice",
              createdAt: "2026-06-02T00:00:00.000Z",
            }),
          ]),
        },
        requestOf({
          useKnownPostIds: ["platform-known"],
          voiceProfileId: "profile-beta",
        }),
      ),
    );

    const knownIndex = guidance.indexOf("- known requested voice");
    const newestIndex = guidance.indexOf("- newest fallback voice");

    expect(guidance).toContain("# Voice samples (match tone, do not copy)");
    expect(knownIndex).toBeGreaterThanOrEqual(0);
    expect(newestIndex).toBeGreaterThanOrEqual(0);
    expect(knownIndex).toBeLessThan(newestIndex);
  });
});
