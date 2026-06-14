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

const savedSettings: AppSettings = appSettingsSchema.parse({
  engineBaseUrl: "http://localhost:5050",
  storagePath: "/tmp/x-builder-saved-settings",
  judgeProvider: "claude-cli",
  codexModel: "gpt-5.2-codex",
  showDeterministicDetails: false,
});

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

  it("loads a pre-epic persisted file by stripping the removed keys and defaulting judgeProvider", async () => {
    await withTempRoot(async (root) => {
      const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
      await writeFile(
        join(root, "settings.json"),
        JSON.stringify({
          settings: {
            engineBaseUrl: "http://127.0.0.1:4173",
            storagePath: "/tmp/x-builder-legacy",
            codexCommandLabel: "Codex judge",
            runCodexJudgeAfterGeneration: true,
            showDeterministicDetails: true,
          },
          source: "persisted",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }),
        "utf8",
      );

      const repository = new JsonFileAppSettingsRepository({ root });
      const response = appSettingsResponseSchema.parse(await repository.load());

      expect(response.source).toBe("persisted");
      expect(response.settings).not.toHaveProperty("codexCommandLabel");
      expect(response.settings).not.toHaveProperty("runCodexJudgeAfterGeneration");
      expect(response.settings.judgeProvider).toBe("codex-cli");
    });
  });

  it("defaults expose judgeProvider codex-cli with no removed keys present", async () => {
    await withTempRoot(async (root) => {
      const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
      const repository = new JsonFileAppSettingsRepository({ root });

      const defaults = appSettingsSchema.parse(repository.defaults());

      expect(defaults.judgeProvider).toBe("codex-cli");
      expect(defaults).not.toHaveProperty("codexCommandLabel");
      expect(defaults).not.toHaveProperty("runCodexJudgeAfterGeneration");
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

  describe("account profile persistence", () => {
    const accountProfile = "30-40s founders, SaaS/AI/devtools, mostly non-US";

    it("round-trips the saved account profile back through a fresh repository load", async () => {
      await withTempRoot(async (root) => {
        const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
        const writer = new JsonFileAppSettingsRepository({ root });

        const settingsToSave = appSettingsSchema.parse({
          ...writer.defaults(),
          accountProfile,
        });
        const saveResponse = appSettingsResponseSchema.parse(await writer.save(settingsToSave));

        const reader = new JsonFileAppSettingsRepository({ root });
        const loadResponse = appSettingsResponseSchema.parse(await reader.load());

        expect(saveResponse.settings.accountProfile).toBe(accountProfile);
        expect(loadResponse.source).toBe("persisted");
        expect(loadResponse.settings.accountProfile).toBe(accountProfile);
      });
    });

    it("loads an old persisted file without an account profile as undefined without throwing", async () => {
      await withTempRoot(async (root) => {
        const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
        // An "old" file written before the account profile field existed: it has no
        // accountProfile key at all. The load must succeed (no migration, no throw).
        await writeFile(
          join(root, "settings.json"),
          JSON.stringify({
            settings: {
              engineBaseUrl: "http://127.0.0.1:4173",
              storagePath: "/tmp/x-builder-no-profile",
              judgeProvider: "codex-cli",
              showDeterministicDetails: true,
            },
            source: "persisted",
            updatedAt: "2026-06-01T00:00:00.000Z",
          }),
          "utf8",
        );

        const repository = new JsonFileAppSettingsRepository({ root });
        const response = appSettingsResponseSchema.parse(await repository.load());

        expect(response.source).toBe("persisted");
        expect(response.settings.accountProfile).toBeUndefined();
      });
    });

    it("persists the trimmed account profile when the saved value has surrounding whitespace", async () => {
      await withTempRoot(async (root) => {
        const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
        const writer = new JsonFileAppSettingsRepository({ root });

        const settingsToSave = appSettingsSchema.parse({
          ...writer.defaults(),
          accountProfile: `  ${accountProfile}  `,
        });
        await writer.save(settingsToSave);

        const reader = new JsonFileAppSettingsRepository({ root });
        const response = appSettingsResponseSchema.parse(await reader.load());

        expect(response.settings.accountProfile).toBe(accountProfile);
      });
    });

    it("persists a whitespace-only account profile as an empty trimmed string", async () => {
      await withTempRoot(async (root) => {
        const JsonFileAppSettingsRepository = await loadJsonFileAppSettingsRepository();
        const writer = new JsonFileAppSettingsRepository({ root });

        // The settings schema trims but does not require a minimum length, so a
        // whitespace-only profile collapses to "" rather than being rejected. The
        // judge treats "" as "no profile" — that judge behavior is covered elsewhere;
        // here we only pin the persisted/trimmed value.
        const settingsToSave = appSettingsSchema.parse({
          ...writer.defaults(),
          accountProfile: "   \n\t  ",
        });
        await writer.save(settingsToSave);

        const reader = new JsonFileAppSettingsRepository({ root });
        const response = appSettingsResponseSchema.parse(await reader.load());

        expect(response.settings.accountProfile).toBe("");
      });
    });
  });
});
