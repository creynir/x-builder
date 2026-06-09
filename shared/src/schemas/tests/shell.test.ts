import { describe, expect, expectTypeOf, it } from "vitest";
import {
  apiErrorSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  routeConfigSchema,
  type ApiError,
  type AppSettings,
  type AppSettingsResponse,
  type AppStatus,
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
  codex: {
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
  codexCommandLabel: "Codex judge",
  runCodexJudgeAfterGeneration: false,
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
});
