import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeSetting = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Device-level setting (SET-1), also read by the inline script in index.html. */
export const THEME_STORAGE_KEY = "ud:theme";

function readSetting(): ThemeSetting {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // storage blocked
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(s: { setting: ThemeSetting; system: ResolvedTheme }): ResolvedTheme {
  return s.setting === "system" ? s.system : s.setting;
}

interface ThemeContextValue {
  setting: ThemeSetting;
  resolved: ResolvedTheme;
  /** An explicit choice: Light, Dark or System. */
  setTheme: (setting: ThemeSetting) => void;
  /**
   * The editor switched to `theme` on its own (e.g. Alt+Shift+D). Keeps the
   * setting as-is when it already resolves to that theme, so "System" survives.
   */
  applyResolvedTheme: (theme: ResolvedTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Light / dark / system theme for the shell and the editor together (SET-1).
 * Sets `<html data-theme>`, which drives the tokens in tokens.css.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => ({ setting: readSetting(), system: systemTheme() }));

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = () => setState((s) => ({ ...s, system: mql.matches ? "dark" : "light" }));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Another tab changed the setting.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setState((s) => ({ ...s, setting: readSetting() }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resolved = resolve(state);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, state.setting);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }, [state.setting]);

  const setTheme = useCallback((setting: ThemeSetting) => setState((s) => ({ ...s, setting })), []);
  const applyResolvedTheme = useCallback(
    (theme: ResolvedTheme) => setState((s) => (resolve(s) === theme ? s : { ...s, setting: theme })),
    [],
  );

  const value = useMemo(
    () => ({ setting: state.setting, resolved, setTheme, applyResolvedTheme }),
    [state.setting, resolved, setTheme, applyResolvedTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
