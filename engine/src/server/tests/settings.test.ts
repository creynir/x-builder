import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  type AppSettings,
  type AppSettingsResponse,
} from "@x-builder/shared";
import { buildServer } from "../server";

type AppSettingsRepositoryFake = {
  load: () => Promise<AppSettingsResponse> | AppSettingsResponse;
  save: (settings: AppSettings) => Promise<AppSettingsResponse> | AppSettingsResponse;
  defaults: () => AppSettings;
};

type BuildServerSettingsOptions = Parameters<typeof buildServer>[0] & {
  settingsRepository?: AppSettingsRepositoryFake;
};

const defaultSettings: AppSettings = appSettingsSchema.parse({
  engineBaseUrl: "http://127.0.0.1:4173",
  storagePath: "/tmp/x-builder-test-storage",
  judgeProvider: "codex-cli",
  showDeterministicDetails: true,
});

const patchedSettings: AppSettings = appSettingsSchema.parse({
  engineBaseUrl: "http://localhost:5123",
  storagePath: "/tmp/x-builder-persisted-storage",
  judgeProvider: "claude-cli",
  codexModel: "gpt-5.2-codex",
  showDeterministicDetails: false,
});

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const buildServerWithSettingsRepository = (settingsRepository: AppSettingsRepositoryFake) =>
  buildServer({ settingsRepository } as BuildServerSettingsOptions);

const settingsRepository = (
  overrides: Partial<AppSettingsRepositoryFake> = {},
): AppSettingsRepositoryFake => ({
  defaults: vi.fn(() => defaultSettings),
  load: vi.fn(async (): Promise<AppSettingsResponse> => ({
    settings: defaultSettings,
    source: "defaults",
  })),
  save: vi.fn(async (settings: AppSettings): Promise<AppSettingsResponse> => ({
    settings,
    source: "persisted",
    updatedAt: "2026-06-06T12:00:00.000Z",
  })),
  ...overrides,
});

describe("engine settings API", () => {
  it("returns default settings when no persisted settings exist", async () => {
    const repository = settingsRepository();
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/settings",
      });

      expect(response.statusCode).toBe(200);
      expect(repository.load).toHaveBeenCalledOnce();
      const settingsResponse = appSettingsResponseSchema.parse(parseJsonPayload(response.body));

      expect(settingsResponse).toEqual({
        settings: defaultSettings,
        source: "defaults",
      });
      expect(settingsResponse.settings.judgeProvider).toBe("codex-cli");
      expect(settingsResponse.settings).not.toHaveProperty("codexCommandLabel");
      expect(settingsResponse.settings).not.toHaveProperty("runCodexJudgeAfterGeneration");
      expect(response.body).not.toContain("codexCommandLabel");
      expect(response.body).not.toContain("runCodexJudgeAfterGeneration");
    } finally {
      await app.close();
    }
  });

  it("rejects a PATCH with an unsupported judge provider id with a field error on judgeProvider", async () => {
    const repository = settingsRepository();
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "PATCH",
        url: "/settings",
        payload: {
          ...patchedSettings,
          judgeProvider: "gpt-cli",
        },
      });

      const error = apiErrorSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(400);
      expect(repository.save).not.toHaveBeenCalled();
      expect(error).toMatchObject({
        code: "validation_failed",
        retryable: false,
        status: 400,
      });
      expect(error.fieldErrors?.judgeProvider).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );
    } finally {
      await app.close();
    }
  });

  it("strips removed legacy keys from a stale client PATCH body and persists the cleaned settings", async () => {
    const repository = settingsRepository();
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "PATCH",
        url: "/settings",
        payload: {
          ...patchedSettings,
          codexCommandLabel: "Stale label",
          runCodexJudgeAfterGeneration: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(repository.save).toHaveBeenCalledOnce();
      expect(repository.save).toHaveBeenCalledWith(patchedSettings);
      const savedArgument = vi.mocked(repository.save).mock.calls[0]![0];
      expect(savedArgument).not.toHaveProperty("codexCommandLabel");
      expect(savedArgument).not.toHaveProperty("runCodexJudgeAfterGeneration");
      expect(response.body).not.toContain("Stale label");
    } finally {
      await app.close();
    }
  });

  it("persists valid patched settings and returns the saved settings response", async () => {
    const repository = settingsRepository();
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "PATCH",
        url: "/settings",
        payload: patchedSettings,
      });

      expect(response.statusCode).toBe(200);
      expect(repository.save).toHaveBeenCalledOnce();
      expect(repository.save).toHaveBeenCalledWith(patchedSettings);
      const settingsResponse = appSettingsResponseSchema.parse(parseJsonPayload(response.body));

      expect(settingsResponse).toEqual({
        settings: patchedSettings,
        source: "persisted",
        updatedAt: "2026-06-06T12:00:00.000Z",
      });
    } finally {
      await app.close();
    }
  });

  it("rejects invalid patched settings with a normalized validation error", async () => {
    const repository = settingsRepository();
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "PATCH",
        url: "/settings",
        payload: {
          ...patchedSettings,
          engineBaseUrl: "https://engine.example.com",
        },
      });

      const error = apiErrorSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(400);
      expect(repository.save).not.toHaveBeenCalled();
      expect(error).toMatchObject({
        code: "validation_failed",
        retryable: false,
        status: 400,
      });
      expect(error.fieldErrors?.engineBaseUrl).toEqual(expect.arrayContaining([expect.any(String)]));
    } finally {
      await app.close();
    }
  });

  it("normalizes settings persistence failures without leaking repository internals", async () => {
    const repository = settingsRepository({
      save: vi.fn(async () => {
        throw new Error("Sensitive settings file path: /Users/nataly/.config/x-builder/settings.json");
      }),
    });
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "PATCH",
        url: "/settings",
        payload: patchedSettings,
      });

      const error = apiErrorSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(500);
      expect(repository.save).toHaveBeenCalledOnce();
      expect(error).toMatchObject({
        code: "settings_persist_failed",
        scope: "settings",
        retryable: true,
        status: 500,
      });
      expect(response.body).not.toContain("/Users/nataly");
      expect(response.body).not.toContain("settings.json");
      expect(response.body).not.toContain("stack");
    } finally {
      await app.close();
    }
  });

  it("normalizes settings load failures without leaking repository internals", async () => {
    const repository = settingsRepository({
      load: vi.fn(async () => {
        throw new Error("Sensitive settings file path: /Users/nataly/.config/x-builder/settings.json");
      }),
    });
    const app = await buildServerWithSettingsRepository(repository);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/settings",
      });

      const error = apiErrorSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(500);
      expect(repository.load).toHaveBeenCalledOnce();
      expect(error).toMatchObject({
        code: "settings_load_failed",
        scope: "settings",
        retryable: true,
        status: 500,
      });
      expect(response.body).not.toContain("/Users/nataly");
      expect(response.body).not.toContain("settings.json");
      expect(response.body).not.toContain("stack");
    } finally {
      await app.close();
    }
  });
});
