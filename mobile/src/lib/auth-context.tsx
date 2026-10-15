import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setTokenProvider } from "./api";
import {
  getCachedUser,
  getToken,
  restoreSession,
  signInWithGoogle,
  signOut as signOutRequest,
  type AuthUser,
} from "./auth";

/**
 * App-wide sign-in state.
 *
 * Every screen shares one instance so the gate, the About screen, and the
 * catalogue sync all agree on who is signed in. The catalogue API requires a
 * JWT, so this provider also registers the token source the API client calls
 * for every request - screens never thread a token through.
 *
 * Offline behaviour: the cached profile renders immediately, so a signed-in
 * user keeps the app while offline; the session is then reconciled against the
 * server in the background. With no cache we wait (briefly) for that round
 * trip, otherwise a signed-in user would see the sign-in screen flash on every
 * cold start.
 */

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  /** True when the profile is being shown from cache because the server was unreachable. */
  offline: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the session; used after the deep-link callback completes. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Don't let a dead network hold the splash forever. */
const RESTORE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTokenProvider(getToken);
    return () => setTokenProvider(null);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await getCachedUser();
      if (!alive) return;
      if (cached) {
        // Render the app at once, then reconcile.
        setUser(cached);
        setLoading(false);
        const restored = await restoreSession();
        if (!alive) return;
        setUser(restored.user);
        setOffline(restored.cached);
        return;
      }
      const restored = await withTimeout(restoreSession(), RESTORE_TIMEOUT_MS, {
        user: null,
        cached: false,
      });
      if (!alive) return;
      setUser(restored.user);
      setOffline(restored.cached);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    const res = await signInWithGoogle();
    if (!res.ok) {
      if (!res.cancelled) setError(res.message);
      return;
    }
    const restored = await restoreSession();
    if (!restored.user) {
      setError("Signed in, but the session could not be saved. Please try again.");
      return;
    }
    setUser(restored.user);
    setOffline(restored.cached);
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await signOutRequest();
    setUser(null);
    setOffline(false);
  }, []);

  const refresh = useCallback(async () => {
    const restored = await restoreSession();
    setUser(restored.user);
    setOffline(restored.cached);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, offline, error, signIn, signOut, refresh }),
    [user, loading, offline, error, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
