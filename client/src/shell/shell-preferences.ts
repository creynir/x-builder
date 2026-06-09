export type ShellPreferences = {
  sidebarCollapsed: boolean;
  density: "comfortable" | "compact";
  lastRoutePath: "/writer" | "/voice" | "/library" | "/settings";
};

export type ShellPreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type ShellPreferencesStore = {
  get: () => ShellPreferences;
  set: (preferences: ShellPreferences) => void;
  subscribe: (listener: () => void) => () => void;
};

export type CreateShellPreferencesStoreOptions = {
  storage: ShellPreferenceStorage;
  storageKey: string;
};

export const defaultShellPreferences: ShellPreferences = {
  density: "comfortable",
  lastRoutePath: "/writer",
  sidebarCollapsed: false,
};

const routePaths = new Set<ShellPreferences["lastRoutePath"]>([
  "/writer",
  "/voice",
  "/library",
  "/settings",
]);

const isShellPreferences = (value: unknown): value is ShellPreferences => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.sidebarCollapsed === "boolean" &&
    (candidate.density === "comfortable" || candidate.density === "compact") &&
    typeof candidate.lastRoutePath === "string" &&
    routePaths.has(candidate.lastRoutePath as ShellPreferences["lastRoutePath"])
  );
};

const loadPreferences = (
  storage: ShellPreferenceStorage,
  storageKey: string,
): ShellPreferences => {
  try {
    const savedValue = storage.getItem(storageKey);

    if (savedValue === null) {
      return defaultShellPreferences;
    }

    const parsedValue: unknown = JSON.parse(savedValue);

    return isShellPreferences(parsedValue) ? parsedValue : defaultShellPreferences;
  } catch {
    return defaultShellPreferences;
  }
};

export function createShellPreferencesStore({
  storage,
  storageKey,
}: CreateShellPreferencesStoreOptions): ShellPreferencesStore {
  let currentPreferences = loadPreferences(storage, storageKey);
  const listeners = new Set<() => void>();

  return {
    get: () => currentPreferences,
    set: (preferences) => {
      currentPreferences = preferences;

      try {
        storage.setItem(storageKey, JSON.stringify(preferences));
      } catch {
        // Preference state remains valid for the current session even if storage fails.
      }

      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
