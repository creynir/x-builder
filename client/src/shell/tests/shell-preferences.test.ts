import { describe, expect, it } from "vitest";

import {
  createShellPreferencesStore,
  defaultShellPreferences,
  type ShellPreferences,
} from "../shell-preferences";

type PreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const createMemoryStorage = (): PreferenceStorage => {
  const entries = new Map<string, string>();

  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
};

describe("shell preferences", () => {
  it("starts with local shell defaults", () => {
    const store = createShellPreferencesStore({
      storage: createMemoryStorage(),
      storageKey: "x-builder:test-shell-preferences",
    });

    expect(store.get()).toEqual(defaultShellPreferences);
    expect(store.get()).toMatchObject({
      density: "comfortable",
      lastRoutePath: "/writer",
      sidebarCollapsed: false,
    });
  });

  it("persists sidebar, density, and last route preferences", () => {
    const storage = createMemoryStorage();
    const storageKey = "x-builder:test-shell-preferences:persisted";
    const savedPreferences: ShellPreferences = {
      density: "compact",
      lastRoutePath: "/library",
      sidebarCollapsed: true,
    };

    const firstStore = createShellPreferencesStore({ storage, storageKey });
    firstStore.set(savedPreferences);
    const secondStore = createShellPreferencesStore({ storage, storageKey });

    expect(secondStore.get()).toEqual(savedPreferences);
  });

  it("continues with in-memory preference state when local storage writes fail", () => {
    const failingStorage: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("local storage quota exceeded");
      },
    };
    const store = createShellPreferencesStore({
      storage: failingStorage,
      storageKey: "x-builder:test-shell-preferences:failing",
    });
    const sessionPreferences: ShellPreferences = {
      density: "compact",
      lastRoutePath: "/voice",
      sidebarCollapsed: true,
    };

    expect(() => store.set(sessionPreferences)).not.toThrow();
    expect(store.get()).toEqual(sessionPreferences);
  });
});
