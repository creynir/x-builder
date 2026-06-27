import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { appSettingsSchema, type AppSettings } from "@x-builder/shared";
import * as ts from "typescript";

import type {
  CanonicalOwnPost,
  PostLibraryRepository,
  PostLibraryStore,
} from "../../server/post-library-repository.js";
import type { AppSettingsRepository } from "../../server/settings-repository.js";
import type {
  CreateGenerationGuidanceResolverInput,
  GenerationGuidanceRequest,
  GenerationGuidanceResolver,
} from "../generation-guidance.js";

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
