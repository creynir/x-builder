import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  appSettingsSchema,
  type AppSettings,
} from "@x-builder/shared";
import { z } from "zod";

export type AppSettingsLoadResult = {
  settings: AppSettings;
  source: "persisted" | "defaults";
  updatedAt?: string;
};

export type AppSettingsPersistedResult = {
  settings: AppSettings;
  source: "persisted";
  updatedAt: string;
};

export interface AppSettingsRepository {
  load(): Promise<AppSettingsLoadResult>;
  save(settings: AppSettings): Promise<AppSettingsPersistedResult>;
  defaults(): AppSettings;
}

export type JsonFileAppSettingsRepositoryOptions = {
  root: string;
};

const settingsFileName = "settings.json";
const appSettingsRepositoryResponseSchema = z.object({
  settings: appSettingsSchema,
  source: z.enum(["persisted", "defaults"]),
  updatedAt: z.string().datetime().optional(),
});
const persistedAppSettingsResponseSchema = appSettingsRepositoryResponseSchema.extend({
  source: z.literal("persisted"),
  updatedAt: z.string().datetime(),
});

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

export class JsonFileAppSettingsRepository implements AppSettingsRepository {
  private readonly settingsFilePath: string;

  constructor(private readonly options: JsonFileAppSettingsRepositoryOptions) {
    this.settingsFilePath = join(options.root, settingsFileName);
  }

  defaults(): AppSettings {
    return appSettingsSchema.parse({
      engineBaseUrl: "http://127.0.0.1:4173",
      storagePath: join(this.options.root, "storage"),
      codexCommandLabel: "Codex judge",
      runCodexJudgeAfterGeneration: false,
      showDeterministicDetails: true,
    });
  }

  async load(): Promise<AppSettingsLoadResult> {
    try {
      const contents = await readFile(this.settingsFilePath, "utf8");
      const persisted = JSON.parse(contents) as unknown;

      return appSettingsRepositoryResponseSchema.parse(persisted);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return appSettingsRepositoryResponseSchema.parse({
          settings: this.defaults(),
          source: "defaults",
        });
      }

      throw error;
    }
  }

  async save(settings: AppSettings): Promise<AppSettingsPersistedResult> {
    const parsedSettings = appSettingsSchema.parse(settings);
    const response = persistedAppSettingsResponseSchema.parse({
      settings: parsedSettings,
      source: "persisted",
      updatedAt: new Date().toISOString(),
    });
    const temporaryFilePath = `${this.settingsFilePath}.${process.pid}.${Date.now()}.tmp`;

    await mkdir(this.options.root, { recursive: true });
    await writeFile(temporaryFilePath, `${JSON.stringify(response, null, 2)}\n`, "utf8");
    await rename(temporaryFilePath, this.settingsFilePath);

    return response;
  }
}
