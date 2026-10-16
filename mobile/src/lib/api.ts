import Constants from "expo-constants";

/**
 * API base URL.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  "https://br-bold-salad-b59octic-api.compute.c-7.us-east-2.aws.neon.tech";

export type Medicine = {
  id: number;
  slug: string;
  brand: string;
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

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;
export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

async function withAuth(headers: Record<string, string>): Promise<void> {
  if (tokenProvider) {
    const token = await tokenProvider().catch(() => null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  await withAuth(headers);
  const res = await fetch(`${API_URL}${path}`, { signal, headers });
  if (!res.ok) throw new ApiError(`Request failed: ${res.status}`, res.status);
  return (await res.json()) as T;
}

async function requestJson<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  await withAuth(headers);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw new ApiError(`Request failed: ${res.status}`, res.status);
  if (res.status === 204) return undefined as T;
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

  sync: (params: { since?: string | null; after?: number | null; limit?: number }, signal?: AbortSignal) => {
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

  prescriptions: {
    list: (signal?: AbortSignal) =>
      getJson<{ items: { id: string; title: string; payload: unknown; updatedAt: string }[] }>("/prescriptions", signal),
    save: (body: { id: string; title: string; payload: unknown }, signal?: AbortSignal) =>
      requestJson<{ id: string; updatedAt: string }>("/prescriptions", "POST", body, signal),
    remove: (id: string, signal?: AbortSignal) =>
      requestJson<{ deleted: boolean }>(`/prescriptions/${encodeURIComponent(id)}`, "DELETE", undefined, signal),
  },
};