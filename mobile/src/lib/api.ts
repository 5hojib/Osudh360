import Constants from "expo-constants";

/**
 * API base URL.
 *
 * A baked-in default keeps the app working straight out of the box; override
 * it per build with EXPO_PUBLIC_API_URL (e.g. to point at a Neon preview
 * branch while testing).
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  "https://br-bold-salad-b59octic-api.compute.c-7.us-east-2.aws.neon.tech";

export type Medicine = {
  id: number;
  slug: string;
  brand: string;
  /** Trade name with the strength suffix removed, for grouping mg variants. */
  brandBase: string | null;
  generic: string | null;
  genericSlug: string | null;
  company: string | null;
  companySlug: string | null;
  form: string;
  strength: string;
  strengthValue: number | null;
  strengthUnit: string | null;
  isCombo: boolean;
  packType: string | null;
  packSize: number | null;
  baseUnit: string | null;
  baseCount: number | null;
  price: number | null;
  currency: string;
  image: string | null;
  sourceUrl: string | null;
  category: string | null;
  categorySlugPath: string | null;
  updatedAt: string | null;
};

export type SyncResponse = {
  items: Medicine[];
  count: number;
  /** Id of the last row returned; pass back as `after` to fetch the next page. */
  cursor: number | null;
  maxUpdated: string | null;
  hasMore: boolean;
};

export type MedicineDetail = {
  medicine: Medicine;
  alternatives: Medicine[];
  otherStrengths: Medicine[];
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * The catalogue API requires a signed-in user. Rather than thread a token
 * through every call site, the auth provider registers a token source here and
 * this attaches it to each request. Set by AuthProvider; a null value means
 * "no token", which is what an unauthenticated request looks like.
 */
type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (tokenProvider) {
    const token = await tokenProvider().catch(() => null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { signal, headers });
  if (!res.ok) {
    throw new ApiError(`Request failed: ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  stats: (signal?: AbortSignal) =>
    getJson<{
      medicines: number;
      generics: number;
      companies: number;
      categories: number;
      lastUpdated: string | null;
    }>("/", signal),

  /**
   * First sync pages by `after` (a stable id cursor); later syncs ask only for
   * rows changed since the stored timestamp.
   */
  sync: (
    params: { since?: string | null; after?: number | null; limit?: number },
    signal?: AbortSignal,
  ) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set("since", params.since);
    if (params.after != null) qs.set("after", String(params.after));
    qs.set("limit", String(params.limit ?? 5000));
    return getJson<SyncResponse>(`/sync?${qs}`, signal);
  },

  search: (
    params: { q?: string; form?: string; pack?: string; generic?: string; category?: string; sort?: string },
    signal?: AbortSignal,
  ) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return getJson<{ items: Medicine[]; total: number }>(`/medicines?${qs}`, signal);
  },
};