import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";
import { appSettingsResponseSchema, appSettingsSchema, type AppSettings } from "@x-builder/shared";

type JsonFileAppSettingsRepositoryConstructor = new (options: { root: string }) => {
  defaults: () => AppSettings;
  load: () => Promise<unknown>;
  save: (settings: AppSettings) => Promise<unknown>;
};

const loadJsonFileAppSettingsRepository = async (): Promise<JsonFileAppSettingsRepositoryConstructor> => {
  const module = await import("../settings-repository");

  return module.JsonFileAppSettingsRepository as JsonFileAppSettingsRepositoryConstructor;
};

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-settings-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const savedSettings: AppSettings = {
  engineBaseUrl: "http://localhost:5050",
  storagePath: "/tmp/x-builder-saved-settings",
  codexCommandLabel: "Local Codex",
  runCodexJudgeAfterGeneration: true,
  showDeterministicDetails: false,
};

describe("JSON file app settings repository", () => {
  it("loads schema-valid defaults from an empty isolated root", async () => {
    await withTempRoot(async (root) => {
      const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
      const repository = new JsonFileAppSettingsRepository({ root });

      const response = appSettingsResponseSchema.parse(await repository.load());

      expect(response.source).toBe("defaults");
      expect(response.updatedAt).toBeUndefined();
      expect(appSettingsSchema.parse(repository.defaults())).toEqual(response.settings);
    });
  });

  it("persists saved settings and reloads them from a new repository instance sharing the same isolated root", async () => {
    await withTempRoot(async (root) => {
      const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
      const writer = new JsonFileAppSettingsRepository({ root });

      const saveResponse = appSettingsResponseSchema.parse(await writer.save(savedSettings));
      const reader = new JsonFileAppSettingsRepository({ root });
      const loadResponse = appSettingsResponseSchema.parse(await reader.load());

      expect(saveResponse).toMatchObject({
        settings: savedSettings,
        source: "persisted",
      });
      expect(saveResponse.updatedAt).toEqual(expect.any(String));
      expect(loadResponse).toEqual(saveResponse);
    });
  });

  it("recovers to defaults when the settings file contains invalid JSON", async () => {
    await withTempRoot(async (root) => {
      const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
      await writeFile(join(root, "settings.json"), "{ this is not json", "utf8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const repository = new JsonFileAppSettingsRepository({ root });
        const response = appSettingsResponseSchema.parse(await repository.load());

        expect(response.source).toBe("defaults");
        expect(response.settings).toEqual(appSettingsSchema.parse(repository.defaults()));
        expect(errorSpy).toHaveBeenCalledOnce();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  it("recovers to defaults when the settings file is valid JSON but violates the schema", async () => {
    await withTempRoot(async (root) => {
      const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
      await writeFile(
        join(root, "settings.json"),
        JSON.stringify({ settings: { engineBaseUrl: "not-a-url" }, source: "persisted" }),
        "utf8",
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const repository = new JsonFileAppSettingsRepository({ root });
        const response = appSettingsResponseSchema.parse(await repository.load());

        expect(response.source).toBe("defaults");
        expect(errorSpy).toHaveBeenCalledOnce();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
