import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { parse } from "expo-linking";
import { API_URL } from "./api";
import { getMeta, setMeta } from "./db";

/**
 * Neon Managed Auth (Managed Better Auth) + Google OAuth.
 *
 * The auth base URL is a public, Neon-managed endpoint for the production branch
 * (it is the very address the app's users authenticate against), so it is
 * inlined here rather than read from an env var - the CI build needs no secrets.
 *
 * We talk to the auth host with plain fetch() calls against Better Auth's REST
 * endpoints instead of the @neondatabase/auth client: that package targets
 * browsers and Node and is not tested on React Native's Hermes engine, and the
 * flow here is only a handful of HTTP calls anyway (get the Google authorize
 * URL, exchange the session verifier, restore a session, mint a JWT, sign out).
 *
 * Flow on native: there is no browser cookie jar to rely on, so social sign-in
 * is browser-sheet based. We ask Neon for the Google authorize URL and open it
 * in an in-app browser session. Neon's trusted-domain allowlist only accepts
 * http(s) origins, so the OAuth callbackURL is an https relay on the Neon
 * Function (api.ts /auth-redirect) that immediately forwards the returned
 * `neon_auth_session_verifier` into the `osudh360://` deep link.
 *
 * Cookies: Better Auth's OAuth handoff is cookie based. POST /sign-in/social
 * answers with `Set-Cookie: __Secure-neon-auth.session_challenge=…`, and the
 * verifier is only exchanged successfully when that challenge cookie is sent
 * back to GET /get-session?neon_auth_session_verifier=…. React Native's fetch
 * disables the native cookie jar for cross-origin requests (its default
 * `credentials: "same-origin"` maps to `withCredentials = false`, which makes
 * OkHttp use `CookieJar.NO_COOKIES`), and the cookie is marked `Partitioned` so
 * a shared jar would not round-trip it anyway. We therefore capture the
 * `Set-Cookie` header ourselves, persist the cookies in SecureStore, and replay
 * them as an explicit `Cookie` request header - exactly the mechanism the
 * catalogue API needs too, since it verifies a JWT minted from these cookies.
 *
 * Secret handling: cookies, the verifier, and the minted JWT live in the OS
 * keychain (SecureStore). The signed-in *profile* is not a secret and is cached
 * in the local SQLite so the account UI still renders offline.
 *
 * /sign-in/social is strict about its Origin: React Native's fetch sends none,
 * so we inject `Origin: API_URL` (the Neon Function host) on every call.
 */
const AUTH_BASE_URL =
  "https://ep-fancy-dream-b5vqhgds.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";

/** Where Google redirects after authorizing (https, trusted-domain allowed). */
export const AUTH_CALLBACK_URL = `${API_URL}/auth-redirect`;

/** The deep link the browser session hands control back to. */
export const AUTH_REDIRECT_URL = "osudh360://auth-callback";

const VERIFIER_KEY = "neon_auth_session_verifier";

/** Every auth cookie Better Auth sets is namespaced with this prefix. */
const COOKIE_PREFIX = "__Secure-neon-auth.";

/** SecureStore key holding the `{ name: value }` map of auth cookies. */
const COOKIES_KEY = "neon_auth_cookies";

/** SQLite meta key holding the cached profile JSON (non-secret). */
const PROFILE_KEY = "user_profile";

export type AuthUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type SessionData = { session: { id: string } | null; user: SessionUser | null };

type SessionResponse = {
  data: SessionData | null;
  error: { message: string; status?: number } | null;
};

function toAuthUser(u: SessionUser | null | undefined): AuthUser | null {
  if (!u) return null;
  return { id: u.id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null };
}

/* ------------------------------------------------------------- cookie store */

let cookieCache: Record<string, string> | null = null;

async function loadCookies(): Promise<Record<string, string>> {
  if (cookieCache) return cookieCache;
  const raw = await SecureStore.getItemAsync(COOKIES_KEY).catch(() => null);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      cookieCache = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      cookieCache = {};
    }
  } else {
    cookieCache = {};
  }
  return cookieCache;
}

/** Merges freshly observed cookies into the persisted store. */
async function saveCookies(update: Record<string, string>): Promise<void> {
  if (Object.keys(update).length === 0) return;
  const cookies = await loadCookies();
  Object.assign(cookies, update);
  cookieCache = cookies;
  await SecureStore.setItemAsync(COOKIES_KEY, JSON.stringify(cookies)).catch(() => {});
}

async function clearCookies(): Promise<void> {
  cookieCache = {};
  await SecureStore.deleteItemAsync(COOKIES_KEY).catch(() => {});
}

/** Builds the `Cookie` request header from the persisted store, if any. */
async function cookieHeader(): Promise<string | undefined> {
  const cookies = await loadCookies();
  const parts = Object.entries(cookies).map(([name, value]) => `${name}=${value}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

/**
 * Extracts the auth cookies from a response's `Set-Cookie` header(s).
 *
 * Some runtimes expose `Headers.getSetCookie()` (an array of individual cookie
 * strings); React Native's fetch does not, and instead returns every `Set-Cookie`
 * line joined with ", ". Splitting on a comma that is immediately followed by
 * our cookie prefix handles both the joined form and an `Expires=Wed, 21 …`
 * attribute, whose comma is not followed by the prefix.
 */
function readSetCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const collect = (cookie: string) => {
    const pair = cookie.split(";")[0]?.trim() ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name.startsWith(COOKIE_PREFIX)) out[name] = value;
  };

  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    for (const cookie of headers.getSetCookie()) collect(cookie);
    return out;
  }
  const raw = res.headers.get("set-cookie");
  if (raw) {
    const escaped = COOKIE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const part of raw.split(new RegExp(`,\\s*(?=${escaped})`))) collect(part);
  }
  return out;
}

/* --------------------------------------------------------------------- JWT */

/**
 * The catalogue API verifies a Managed Better Auth JWT (EdDSA, 15 min). Better
 * Auth returns one from GET /token while the session cookie is valid, and also
 * mirrors it in a `set-auth-jwt` header on session responses, so we absorb that
 * opportunistically and only call /token when the cached one is near expiry.
 */
let tokenCache: { token: string; expiresAt: number } | null = null;

/** Reads `exp` from a JWT without verifying it (verification is the server's job). */
function jwtExpiryMs(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) throw new Error("no payload");
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded: unknown = JSON.parse(globalThis.atob(padded));
    const exp = (decoded as { exp?: unknown }).exp;
    if (typeof exp === "number") return exp * 1000;
  } catch {
    /* fall through to a conservative default */
  }
  return Date.now() + 14 * 60_000;
}

function rememberJwt(token: string): void {
  tokenCache = { token, expiresAt: jwtExpiryMs(token) };
}

/** Records auth cookies and any JWT a response carries. */
async function absorbAuth(res: Response): Promise<void> {
  await saveCookies(readSetCookies(res));
  const jwt = res.headers.get("set-auth-jwt");
  if (jwt) rememberJwt(jwt);
}

/**
 * Returns a JWT for the catalogue API, minting a fresh one when the cached
 * token is within a minute of expiry. Returns the last token (possibly stale)
 * when offline; the request that uses it will fail on the network itself.
 */
export async function getToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.token;
  try {
    const res = await fetch(`${AUTH_BASE_URL}/token`, { headers: await authHeaders() });
    await absorbAuth(res);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
      if (body && typeof body.token === "string") {
        rememberJwt(body.token);
        return body.token;
      }
    }
  } catch {
    /* offline: fall back to whatever we have */
  }
  return tokenCache?.token ?? null;
}

/* ----------------------------------------------------------- profile cache */

/** The cached profile, readable offline. */
export async function getCachedUser(): Promise<AuthUser | null> {
  const raw = await getMeta(PROFILE_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as AuthUser).id === "string") {
      return parsed as AuthUser;
    }
  } catch {
    /* corrupt cache: treat as signed out */
  }
  return null;
}

async function cacheUser(user: AuthUser | null): Promise<void> {
  await setMeta(PROFILE_KEY, user ? JSON.stringify(user) : "").catch(() => {});
}

/* ------------------------------------------------------------------ requests */

/** React Native fetch sends no Origin, but /sign-in/social requires one. */
async function authHeaders(hasBody = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Origin: API_URL };
  if (hasBody) headers["Content-Type"] = "application/json";
  const cookie = await cookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/**
 * GET /get-session. With no persisted session cookie it returns `null`; with
 * `?neon_auth_session_verifier=` it consumes the pending challenge (replayed as
 * a `Cookie` header) and answers with the session plus a `session_token` cookie,
 * which we persist for later restores.
 */
async function fetchSession(verifier?: string): Promise<SessionResponse> {
  try {
    const qs = verifier ? `?neon_auth_session_verifier=${encodeURIComponent(verifier)}` : "";
    const res = await fetch(`${AUTH_BASE_URL}/get-session${qs}`, {
      method: "GET",
      headers: await authHeaders(),
    });
    await absorbAuth(res);
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      return { data: null, error: { message: msg || `get-session failed (${res.status})`, status: res.status } };
    }
    const body = await res.json().catch(() => null);
    if (!body) return { data: null, error: null };
    return { data: body as SessionData, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "Network error" } };
  }
}

/**
 * In-flight/settled verifier exchange. The browser-session promise and the
 * deep-link route can both observe the same redirect, and the verifier is
 * single-use, so de-duplicating on the verifier string keeps them to one call.
 */
let exchangeCache: { verifier: string; promise: Promise<SessionResponse> } | null = null;

/**
 * Exchanges the `neon_auth_session_verifier` from the OAuth callback for a
 * real session. Exported so auth-callback.tsx can share the same exchange.
 */
export function getSessionWithVerifier(verifier: string): Promise<SessionResponse> {
  if (exchangeCache && exchangeCache.verifier === verifier) return exchangeCache.promise;
  const promise = fetchSession(verifier);
  exchangeCache = { verifier, promise };
  return promise;
}

/** Pulls `neon_auth_session_verifier` out of the deep-link URL. */
function extractVerifier(url: string): string | null {
  const params = parse(url).queryParams ?? {};
  const v = params.neon_auth_session_verifier;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export type SignInResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; message: string };

export async function signInWithGoogle(): Promise<SignInResult> {
  // 1. Ask Neon for the Google authorize URL (no auto-redirect on native). The
  //    response sets the session-challenge cookie we must replay after OAuth.
  let authorizeUrl: string | null = null;
  try {
    const res = await fetch(`${AUTH_BASE_URL}/sign-in/social`, {
      method: "POST",
      headers: await authHeaders(true),
      body: JSON.stringify({
        provider: "google",
        callbackURL: AUTH_CALLBACK_URL,
        disableRedirect: true,
      }),
    });
    await absorbAuth(res);
    const body = (await res.json().catch(() => null)) as { url?: unknown; message?: unknown } | null;
    if (!res.ok || !body) {
      const msg = body && typeof body.message === "string" ? body.message : null;
      return { ok: false, message: msg ?? `Could not start Google sign-in (${res.status}).` };
    }
    authorizeUrl = typeof body.url === "string" ? body.url : null;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not start Google sign-in." };
  }
  if (!authorizeUrl) {
    return { ok: false, message: "Could not start Google sign-in." };
  }

  // 2. Open Google in a secure in-app browser session that returns to the app.
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, AUTH_REDIRECT_URL);
  if (result.type !== "success" || !result.url) {
    return { ok: false, cancelled: true, message: "Sign-in was cancelled." };
  }

  // 3. The redirect carries the session verifier; exchange it for a session.
  const verifier = extractVerifier(result.url);
  if (!verifier) {
    return { ok: false, message: "The sign-in callback was missing its session token." };
  }
  const session = await getSessionWithVerifier(verifier);
  if (session.error || !session.data?.session) {
    // The deep-link route may have won the single-use exchange first; if a
    // session is now stored, treat the sign-in as successful anyway.
    const { user } = await restoreSession();
    if (!user) {
      return { ok: false, message: session.error?.message ?? "Could not create a session." };
    }
  }

  // 4. Persist the verifier so an immediate relaunch can retry the exchange
  //    before the cookie-based session takes over (the verifier is short-lived).
  await SecureStore.setItemAsync(VERIFIER_KEY, verifier).catch(() => {});
  return { ok: true };
}

export type RestoredSession = {
  user: AuthUser | null;
  /** True when the profile came from the local cache because the server was unreachable. */
  cached: boolean;
};

/**
 * Re-establishes the session and returns the profile.
 *
 * Three outcomes matter: a live session (refresh the cached profile), an
 * explicit "no session" from the server (sign the user out), and a network
 * failure (keep the cached profile so a signed-in user stays signed in while
 * offline).
 */
export async function restoreSession(): Promise<RestoredSession> {
  const live = await fetchSession();
  if (live.data?.user) {
    const user = toAuthUser(live.data.user);
    await cacheUser(user);
    return { user, cached: false };
  }
  if (!live.error) {
    // The server answered and there is no session: it expired or was revoked.
    await cacheUser(null);
    return { user: null, cached: false };
  }

  // Network error: prefer the verifier this launch may have arrived with, then
  // the cached profile.
  const verifier = await SecureStore.getItemAsync(VERIFIER_KEY).catch(() => null);
  if (verifier) {
    const res = await getSessionWithVerifier(verifier);
    if (!res.error && res.data?.user) {
      const user = toAuthUser(res.data.user);
      await cacheUser(user);
      return { user, cached: false };
    }
  }
  const cachedUser = await getCachedUser();
  return { user: cachedUser, cached: cachedUser !== null };
}

export async function signOut(): Promise<void> {
  await fetch(`${AUTH_BASE_URL}/sign-out`, {
    method: "POST",
    headers: await authHeaders(true),
    body: "{}",
  }).catch(() => {});
  await clearCookies();
  await SecureStore.deleteItemAsync(VERIFIER_KEY).catch(() => {});
  tokenCache = null;
  exchangeCache = null;
  await cacheUser(null);
}
