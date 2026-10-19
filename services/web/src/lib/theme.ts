import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const storageKey = "theme";
const listeners = new Set<() => void>();

const read = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

/**
 * Applies the theme saved in this browser, before the first render. Dark is
 * the default; storage may be unavailable (private mode), which is fine.
 */
export const restoreTheme = () => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") {
      document.documentElement.dataset.theme = saved;
    }
  } catch {
    // Keep the default.
  }
};

export const setTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Not remembered, but applied.
  }
  for (const listener of listeners) listener();
};

/** The current theme, re-rendering when it changes. */
export const useTheme = (): Theme =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => "dark",
  );
