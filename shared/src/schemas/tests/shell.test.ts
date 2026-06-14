import { describe, expect, expectTypeOf, it } from "vitest";
import {
  apiErrorSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  judgeProviderIdSchema,
  judgeProviderLabels,
  routeConfigSchema,
  type ApiError,
  type AppSettings,
  type AppSettingsResponse,
  type AppStatus,
  type JudgeProviderId,
  type RouteConfig,
} from "../../index";

const checkedAt = "2026-06-06T00:00:00.000Z";

const readySubsystem = {
  state: "ready",
  label: "Engine",
  message: "Listening locally",
  retryable: false,
  checkedAt,
  details: {
    port: 4317,
    localOnly: true,
    adapter: "fastify",
    activeRun: null,
  },
};

const validAppStatus = {
  overall: "ready",
  version: "0.0.0",
  generatedAt: checkedAt,
  engine: readySubsystem,
  deterministic: {
    ...readySubsystem,
    label: "Deterministic engine",
  },
  llm: {
    ...readySubsystem,
    state: "unconfigured",
    label: "Codex judge",
    retryable: true,
  },
  storage: {
    ...readySubsystem,
    label: "Storage",
  },
  lastRun: {
    state: "completed",
    completedAt: checkedAt,
    ideaId: "idea-123",
  },
};

const validSettings = {
  engineBaseUrl: "http://localhost:4317",
  storagePath: "/tmp/x-builder",
  judgeProvider: "codex-cli",
  showDeterministicDetails: true,
};

describe("shell schemas", () => {
  it("exports shell schemas and inferred types from the shared entrypoint", () => {
    expect(appStatusSchema).toBeDefined();
    expect(apiErrorSchema).toBeDefined();
    expect(appSettingsSchema).toBeDefined();
    expect(appSettingsResponseSchema).toBeDefined();
    expect(routeConfigSchema).toBeDefined();

    expectTypeOf<AppStatus>().toMatchTypeOf<ReturnType<typeof appStatusSchema.parse>>();
    expectTypeOf<ApiError>().toMatchTypeOf<ReturnType<typeof apiErrorSchema.parse>>();
    expectTypeOf<AppSettings>().toMatchTypeOf<ReturnType<typeof appSettingsSchema.parse>>();
    expectTypeOf<AppSettingsResponse>().toMatchTypeOf<
      ReturnType<typeof appSettingsResponseSchema.parse>
    >();
    expectTypeOf<RouteConfig>().toMatchTypeOf<ReturnType<typeof routeConfigSchema.parse>>();
  });

  it("parses a valid app status payload", () => {
    expect(appStatusSchema.safeParse(validAppStatus).success).toBe(true);
  });

  it("exposes a provider-neutral llm subsystem slot on the parsed status", () => {
    const status = appStatusSchema.parse(validAppStatus);

    expect(status).toHaveProperty("llm");
    expect(status.llm.label).toBe("Codex judge");
    expect(status.llm.state).toBe("unconfigured");
  });

  it("drops the legacy codex subsystem slot key from the parsed status", () => {
    const status = appStatusSchema.parse(validAppStatus);

    expect(status).not.toHaveProperty("codex");
  });

  it("rejects a status payload that carries the legacy codex slot instead of llm", () => {
    const { llm, ...withoutLlm } = validAppStatus;
    const legacyStatus = {
      ...withoutLlm,
      codex: llm,
    };

    expect(appStatusSchema.safeParse(legacyStatus).success).toBe(false);
  });

  it("rejects a status subsystem with an unsupported state", () => {
    const result = appStatusSchema.safeParse({
      ...validAppStatus,
      engine: {
        ...readySubsystem,
        state: "booting",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects settings with a non-localhost engine URL", () => {
    const result = appSettingsSchema.safeParse({
      ...validSettings,
      engineBaseUrl: "https://engine.example.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a storage path containing parent-directory traversal segments", () => {
    const result = appSettingsSchema.safeParse({
      ...validSettings,
      storagePath: "/var/data/../../etc/passwd",
    });

    expect(result.success).toBe(false);
  });

  it("rejects API errors with an unknown code", () => {
    const result = apiErrorSchema.safeParse({
      code: "quota_exceeded",
      message: "The local engine rejected the request.",
      scope: "writer",
      retryable: true,
      status: 500,
    });

    expect(result.success).toBe(false);
  });

  it("rejects route configs with unsupported paths", () => {
    const result = routeConfigSchema.safeParse({
      id: "writer",
      label: "Writer",
      path: "/admin",
      title: "Writer",
      enabled: true,
      placeholder: false,
      navOrder: 0,
      requiresBackend: true,
    });

    expect(result.success).toBe(false);
  });

  it("parses valid app settings responses and route configs", () => {
    expect(
      appSettingsResponseSchema.safeParse({
        settings: validSettings,
        source: "defaults",
        updatedAt: checkedAt,
      }).success,
    ).toBe(true);

    expect(
      routeConfigSchema.safeParse({
        id: "settings",
        label: "Settings",
        path: "/settings",
        title: "Settings",
        enabled: true,
        placeholder: false,
        navOrder: 3,
      }).success,
    ).toBe(true);
  });

  it("defaults judgeProvider to codex-cli when no provider is supplied", () => {
    const parsed = appSettingsSchema.parse({
      engineBaseUrl: "http://127.0.0.1:4173",
      storagePath: "/tmp/x-builder",
      showDeterministicDetails: true,
    });

    expect(parsed.judgeProvider).toBe("codex-cli");
  });

  it("rejects settings carrying an unsupported judge provider id", () => {
    const result = appSettingsSchema.safeParse({
      ...validSettings,
      judgeProvider: "gpt-cli",
    });

    expect(result.success).toBe(false);
  });

  it("strips the removed Codex command label and auto-judge keys instead of preserving them", () => {
    const parsed = appSettingsSchema.parse({
      engineBaseUrl: "http://127.0.0.1:4173",
      storagePath: "/tmp/x-builder",
      showDeterministicDetails: true,
      codexCommandLabel: "Codex judge",
      runCodexJudgeAfterGeneration: true,
    });

    expect(parsed).not.toHaveProperty("codexCommandLabel");
    expect(parsed).not.toHaveProperty("runCodexJudgeAfterGeneration");
    expect(parsed.judgeProvider).toBe("codex-cli");
  });

  it("parses the three optional per-provider model keys as absent when omitted", () => {
    const parsed = appSettingsSchema.parse({
      engineBaseUrl: "http://127.0.0.1:4173",
      storagePath: "/tmp/x-builder",
      showDeterministicDetails: true,
    });

    expect(parsed.codexModel).toBeUndefined();
    expect(parsed.claudeModel).toBeUndefined();
    expect(parsed.cursorModel).toBeUndefined();
  });

  it("keeps a supplied per-provider model string for the active provider", () => {
    const parsed = appSettingsSchema.parse({
      ...validSettings,
      codexModel: "gpt-5.2-codex",
    });

    expect(parsed.codexModel).toBe("gpt-5.2-codex");
  });

  it("loads settings that omit the optional account profile", () => {
    const parsed = appSettingsSchema.parse(validSettings);

    expect(parsed.accountProfile).toBeUndefined();
  });

  it("retains a supplied account profile on settings", () => {
    const parsed = appSettingsSchema.parse({
      ...validSettings,
      accountProfile: "Solo founder writing about local-first dev tooling.",
    });

    expect(parsed.accountProfile).toBe("Solo founder writing about local-first dev tooling.");
  });

  it("rejects an account profile longer than 600 characters on settings", () => {
    const result = appSettingsSchema.safeParse({
      ...validSettings,
      accountProfile: "a".repeat(601),
    });

    expect(result.success).toBe(false);
  });

  it("accepts every judge provider id the catalog enumerates", () => {
    for (const id of judgeProviderIdSchema.options) {
      expect(judgeProviderIdSchema.safeParse(id).success).toBe(true);
    }

    expect([...judgeProviderIdSchema.options].sort()).toEqual(
      ["claude-cli", "codex-cli", "cursor-cli"].sort(),
    );
  });

  it("maps every enum option to a non-empty provider label with the exact three labels", () => {
    for (const id of judgeProviderIdSchema.options) {
      const label = judgeProviderLabels[id as JudgeProviderId];

      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }

    expect(judgeProviderLabels).toMatchObject({
      "codex-cli": "Codex judge",
      "claude-cli": "Claude judge",
      "cursor-cli": "Cursor judge",
    });
    expect(Object.keys(judgeProviderLabels).sort()).toEqual(
      [...judgeProviderIdSchema.options].sort(),
    );
  });
});
