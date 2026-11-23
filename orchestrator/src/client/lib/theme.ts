import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "jobops.theme";

const readStored = (): Theme => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

// Module-level copy so the toggle still works when storage is blocked.
let current: Theme = readStored();
const listeners = new Set<() => void>();

const applyToDocument = (theme: Theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
};

const setTheme = (theme: Theme) => {
  current = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors in restricted browser contexts.
  }
  applyToDocument(theme);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Follow changes made in other tabs.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    current = readStored();
    applyToDocument(current);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => "dark" as Theme,
  );
  return { theme, setTheme };
}
