import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appSettingsSchema, type AppSettings, type JudgeProviderId } from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import { JsonFileAppSettingsRepository } from "../../server/settings-repository.js";

type SettingsJudgeProviderResolver = () => Promise<JudgeProviderId>;

type AppSettingsRepositoryLike = {
  load: () => Promise<{ settings: AppSettings; source: "persisted" | "defaults"; updatedAt?: string }>;
};

async function loadCreateSettingsJudgeProviderResolver(): Promise<
  (repository: AppSettingsRepositoryLike) => SettingsJudgeProviderResolver
> {
  const module = (await import("../judge-provider-resolver.js")) as {
    createSettingsJudgeProviderResolver: (
      repository: AppSettingsRepositoryLike,
    ) => SettingsJudgeProviderResolver;
  };

  return module.createSettingsJudgeProviderResolver;
}

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-judge-resolver-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const persistedResponse = (settings: AppSettings) => ({
  settings,
  source: "persisted" as const,
  updatedAt: "2026-06-10T12:00:00.000Z",
});

describe("settings judge provider resolver", () => {
  it("resolves the persisted judge provider on every call by reloading settings (no caching)", async () => {
    const createSettingsJudgeProviderResolver = await loadCreateSettingsJudgeProviderResolver();
    const settings: AppSettings[] = [
      appSettingsSchema.parse({
        engineBaseUrl: "http://127.0.0.1:4173",
        storagePath: "/tmp/x-builder",
        judgeProvider: "cursor-cli",
        showDeterministicDetails: true,
      }),
      appSettingsSchema.parse({
        engineBaseUrl: "http://127.0.0.1:4173",
        storagePath: "/tmp/x-builder",
        judgeProvider: "claude-cli",
        showDeterministicDetails: true,
      }),
    ];
    const load = vi.fn(async () => persistedResponse(settings.shift()!));
    const resolve = createSettingsJudgeProviderResolver({ load });

    const first = await resolve();
    const second = await resolve();

    expect(load).toHaveBeenCalledTimes(2);
    expect(first).toBe("cursor-cli");
    expect(second).toBe("claude-cli");
  });

  it("falls back to codex-cli when the persisted settings file is unreadable", async () => {
    await withTempRoot(async (root) => {
      await writeFile(join(root, "settings.json"), "{ not valid json", "utf8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const createSettingsJudgeProviderResolver =
          await loadCreateSettingsJudgeProviderResolver();
        const repository = new JsonFileAppSettingsRepository({ root });
        const resolve = createSettingsJudgeProviderResolver(repository);

        const provider = await resolve();

        expect(provider).toBe("codex-cli");
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  it("falls back to codex-cli without throwing when repository load rejects with a non-Zod error", async () => {
    const createSettingsJudgeProviderResolver = await loadCreateSettingsJudgeProviderResolver();
    const load = vi.fn(async () => {
      throw new Error("disk exploded");
    });
    const resolve = createSettingsJudgeProviderResolver({ load });

    await expect(resolve()).resolves.toBe("codex-cli");
  });

  it("falls back to codex-cli when load resolves to a settings object lacking a provider", async () => {
    const createSettingsJudgeProviderResolver = await loadCreateSettingsJudgeProviderResolver();
    const load = vi.fn(async () => ({
      settings: { judgeProvider: undefined } as unknown as AppSettings,
      source: "persisted" as const,
      updatedAt: "2026-06-10T12:00:00.000Z",
    }));
    const resolve = createSettingsJudgeProviderResolver({ load });

    await expect(resolve()).resolves.toBe("codex-cli");
  });

  it("reads schema-valid defaults from an empty isolated root and resolves codex-cli", async () => {
    await withTempRoot(async (root) => {
      const createSettingsJudgeProviderResolver =
        await loadCreateSettingsJudgeProviderResolver();
      const repository = new JsonFileAppSettingsRepository({ root });
      const resolve = createSettingsJudgeProviderResolver(repository);

      await expect(resolve()).resolves.toBe("codex-cli");
    });
  });
});
