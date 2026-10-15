import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { palette, type Theme } from "./theme";
import { currentSyncState, syncCatalogue, type SyncState } from "./lib/sync";
import { getMeta, setMeta } from "./lib/db";
import { useAuth } from "./lib/auth-context";

/**
 * App-wide state: the theme, the UI language, and the local catalogue's sync
 * status.
 *
 * The catalogue itself is never held in React state - screens read it straight
 * from SQLite. Keeping ~57k rows in memory would make every navigation
 * expensive and gain nothing, since the data is already local.
 */

export type ThemeMode = "system" | "light" | "dark";
export type Language = "bn" | "en";

const PREF_THEME = "pref_themeMode";
const PREF_LANG = "pref_lang";

type AppContextValue = {
  theme: Theme;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  sync: SyncState;
  refresh: () => Promise<void>;
  /** Bumped after a sync so screens re-query the local store. */
  version: number;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const { user, loading: authLoading } = useAuth();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [language, setLanguageState] = useState<Language>("bn");

  // Preferences persist in the SQLite meta table (no extra storage dependency);
  // hydrate them once at startup.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [t, l] = await Promise.all([getMeta(PREF_THEME), getMeta(PREF_LANG)]);
      if (!alive) return;
      if (t === "light" || t === "dark" || t === "system") setThemeModeState(t);
      if (l === "en" || l === "bn") setLanguageState(l);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    void setMeta(PREF_THEME, mode);
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    void setMeta(PREF_LANG, lang);
  }, []);

  const isDark = themeMode === "dark" || (themeMode === "system" && scheme === "dark");
  const theme = isDark ? palette.dark : palette.light;

  const [sync, setSync] = useState<SyncState>({ status: "idle", count: 0, lastSyncAt: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    setSync((prev) => ({ ...prev, status: "syncing", error: undefined }));
    const next = await syncCatalogue();
    setSync(next);
    setVersion((v) => v + 1);
  }, []);

  // The catalogue lives behind the sign-in wall, so only sync once there is a
  // user: the API rejects an unauthenticated request. Signed out, we surface
  // whatever the cache already holds but never touch the network.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      const initial = await currentSyncState();
      if (cancelled) return;
      setSync(initial);
      if (user) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, refresh]);

  const value = useMemo<AppContextValue>(
    () => ({ theme, isDark, themeMode, setThemeMode, language, setLanguage, sync, refresh, version }),
    [theme, isDark, themeMode, setThemeMode, language, setLanguage, sync, refresh, version],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}