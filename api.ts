/**
 * Osudh360 catalogue API.
 *
 * Read-only, and deployed as a Neon Function next to the database. Every
 * catalogue route requires a signed-in user: the caller sends a short-lived
 * Managed Better Auth JWT as `Authorization: Bearer`, verified against the
 * JWKS Neon injects. The only public route is the OAuth callback relay, which
 * runs during sign-in before any token exists. The database connection uses a
 * SELECT-only role, so the function cannot write even if a query were wrong.
 *
 * The mobile client mirrors the whole catalogue into local SQLite on first
 * sync, so the network is only ever needed to *refresh* — every screen then
 * works offline.
 *
 * Routes
 *   GET /                              health + catalogue counts (auth)
 *   GET /sync?since=<ISO>              compact rows changed since a timestamp (auth)
 *   GET /medicines?q=&form=&pack=...   search / browse / paginate (auth)
 *   GET /medicines/:slug               one medicine + its alternatives (auth)
 *   GET /medicines/:slug/history      recent price history (auth)
 *   GET /generics                      generics with brand counts (auth)
 *   GET /generics/:slug                every brand of a generic, by strength (auth)
 *   GET /categories                    therapeutic tree (auth)
 *   GET /companies                     manufacturers with product counts (auth)
 *   GET /auth-redirect                 OAuth relay into the app deep link (public)
 */

import { attachDatabasePool } from "@neon/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import { companyRankSql } from "./src/lib/companies.ts";

// Module scope: the isolate is reused across requests, so the pool is built
// once and shared. max stays small because every isolate holds its own pool.
//
// DATABASE_URL points at a least-privilege, SELECT-only role (see
// scripts/db-readonly-role.ts). Writes and migrations use the owner URL
// (DATABASE_URL_UNPOOLED), which never reaches the function.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
// Without this, an idle-client disconnect surfaces as an uncaughtException and
// kills the isolate.
attachDatabasePool(pool);

// A separate (write-capable) pool is used only for user-owned prescriptions.
// It may be the same as the read-only pool when WRITE_DATABASE_URL is missing,
// in which case writes fail gracefully rather than serving the catalogue.
const writePool = new Pool({
  connectionString:
    process.env.WRITE_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  max: 3,
});
attachDatabasePool(writePool);

/* ------------------------------------------------------------------ auth */

/**
 * Every catalogue route requires a signed-in user. The mobile app obtains a
 * short-lived JWT from Managed Better Auth (`GET /token`, EdDSA, 15 min) and
 * sends it as `Authorization: Bearer …`; we verify it against the JWKS Neon
 * injects. The issuer is the origin of the Managed Auth URL, not its full path.
 *
 * `createRemoteJWKSet` caches the keys and re-fetches on an unknown `kid`, so
 * building it once at module scope is the intended use.
 */
const AUTH_JWKS_URL = process.env.NEON_AUTH_JWKS_URL;
const AUTH_ISSUER = process.env.NEON_AUTH_BASE_URL
  ? new URL(process.env.NEON_AUTH_BASE_URL).origin
  : undefined;
const jwks = AUTH_JWKS_URL ? createRemoteJWKSet(new URL(AUTH_JWKS_URL)) : null;

/** Returns the authenticated user id, or null when the request is not valid. */
async function authenticate(request: Request): Promise<string | null> {
  if (!jwks || !AUTH_ISSUER) {
    // Misconfigured deployment: fail closed rather than serve the catalogue
    // unauthenticated.
    console.error("[api] auth not configured: NEON_AUTH_JWKS_URL / NEON_AUTH_BASE_URL missing");
    return null;
  }
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH_ISSUER });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ helpers */

/**
 * CORS for the web build and any browser-origin caller. React Native ignores
 * CORS, but the same Function serves `expo start --web`, and a browser cannot
 * preflight an `Authorization` header without these. The origin is echoed (not
 * `*`) so it stays compatible with credentialed requests; the bearer token is
 * what actually authorizes, so an echoed origin is not a trust decision.
 */
const corsHeaders = (request: Request): Record<string, string> => ({
  "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  Vary: "Origin",
});

/** Re-wraps a response with the CORS headers (response headers are immutable). */
async function withCors(res: Response, cors: Record<string, string>): Promise<Response> {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Authenticated, per-request data: never let a cache or proxy store it.
      "Cache-Control": "private, no-store",
      ...headers,
    },
  });

/** Postgres `numeric` arrives as a string; the client wants numbers. */
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

function serialiseMedicine(row: Record<string, unknown>) {
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand_name,
    brandBase: row.brand_base,
    generic: row.generic_name,
    genericSlug: row.generic_slug,
    company: row.company_name,
    companySlug: row.company_slug,
    form: row.form,
    strength: row.strength_raw,
    strengthValue: row.strength_value === null ? null : Number(row.strength_value),
    strengthUnit: row.strength_unit,
    isCombo: Boolean(row.is_combo_strength),
    packType: row.pack_type,
    packSize: row.pack_size,
    baseUnit: row.base_unit,
    baseCount: row.base_count,
    price: num(row.current_price),
    currency: row.currency,
    image: row.image_url,
    sourceUrl: row.source_url,
    category: row.category_name,
    categorySlugPath: row.category_slug_path,
    updatedAt: row.updated_at,
  };
}

const MEDICINE_COLUMNS = `
  m.id, m.slug, m.brand_name, m.brand_base, m.generic_name, m.generic_slug,
  m.company_name, m.company_slug, m.form, m.strength_raw,
  m.strength_value, m.strength_unit, m.is_combo_strength,
  m.pack_type, m.pack_size, m.base_unit, m.base_count,
  m.current_price, m.currency, m.image_url, m.source_url,
  m.category_name, m.category_slug_path, m.updated_at
`;

/**
 * Sanitises a user-supplied search term for `to_tsquery`.
 *
 * `to_tsquery` treats many characters as operators (`|`, `&`, `!`, `(`), so a
 * raw term would either throw or change the query's meaning. Stripping
 * everything non-alphanumeric and then re-quoting makes the input literal.
 */
function toTsQuery(term: string) {
  return term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => `'${t}'`)
    .join(" & ");
}

/* ------------------------------------------------------------------- routes */

/**
 * Sync endpoint.
 *
 * Two modes, because they need different cursors:
 *  - Full sync: `after` is a medicine id and rows are paged in ascending id
 *    order. A stable cursor is essential - paging by offset or by a mutable
 *    column makes the client loop on the same page forever.
 *  - Incremental: `since` is a timestamp and rows changed after it are
 *    returned; `maxUpdated` lets the client advance its own watermark.
 *
 * The filters combine when both are sent, so an incremental result larger than
 * one page can be paged with `after` without re-reading the same rows.
 */
async function handleSync(url: URL) {
  const since = url.searchParams.get("since");
  const after = url.searchParams.get("after");
  const rawLimit = Number(url.searchParams.get("limit") ?? 5000);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 5000, 1), 20000);

  const params: unknown[] = [];
  const where: string[] = [];

  if (after) {
    params.push(Number.isFinite(Number(after)) ? Number(after) : 0);
    where.push(`m.id > $${params.length}`);
  }
  if (since) {
    params.push(since);
    where.push(`m.updated_at > $${params.length}`);
  }

  const paramsSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Compact payload: this is the table the phone mirrors for offline search.
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT ${MEDICINE_COLUMNS}, m.id AS id
     FROM medicines m
     ${paramsSql}
     ORDER BY m.id
     LIMIT $${params.length}`,
    params,
  );

  const maxUpdated = (
    await pool.query<{ maxUpdated: string }>(
      `SELECT max(updated_at)::text AS "maxUpdated" FROM medicines`,
    )
  ).rows[0]?.maxUpdated ?? null;

  const lastId = rows.length ? Number(rows[rows.length - 1].id) : null;

  return json({
    items: rows.map(serialiseMedicine),
    count: rows.length,
    // Paging is finished when a short page comes back.
    hasMore: rows.length === limit,
    cursor: lastId,
    maxUpdated,
  });
}

async function handleMedicines(url: URL) {
  const q = url.searchParams.get("q");
  const form = url.searchParams.get("form");
  const pack = url.searchParams.get("pack");
  const generic = url.searchParams.get("generic");
  const company = url.searchParams.get("company");
  const category = url.searchParams.get("category");
  const sort = url.searchParams.get("sort") ?? (q ? "relevance" : "brand");
  const rawLimit = Number(url.searchParams.get("limit") ?? 30);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 30, 1), 100);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

  const params: unknown[] = [];
  const where: string[] = [];

  const ts = q ? toTsQuery(q) : "";
  if (ts) {
    params.push(ts);
    where.push(`m.search_vector @@ to_tsquery('simple', $${params.length})`);
  }
  if (form) {
    params.push(form);
    where.push(`m.form = $${params.length}`);
  }
  if (pack === "Loose") {
    where.push(`m.pack_size = 1 AND m.pack_type IN ('Tablet','Capsule')`);
  } else if (pack) {
    const [type, size] = pack.split(":");
    params.push(type);
    where.push(`m.pack_type = $${params.length}`);
    if (size) {
      params.push(Number(size));
      where.push(`m.pack_size = $${params.length}`);
    }
  }
  if (generic) {
    params.push(generic);
    where.push(`m.generic_slug = $${params.length}`);
  }
  if (company) {
    params.push(company);
    where.push(`m.company_slug = $${params.length}`);
  }
  if (category) {
    const idx = params.push(category);
    where.push(`(m.category_slug_path = $${idx} OR m.category_slug_path LIKE $${idx + 1})`);
    params.push(`${category}/%`);
  }

  const order = {
    relevance: ts ? `ts_rank(m.search_vector, to_tsquery('simple', $1)) DESC` : "m.brand_name ASC",
    price_asc: "m.current_price ASC NULLS LAST",
    price_desc: "m.current_price DESC NULLS LAST",
    brand: "m.brand_name ASC",
  }[String(sort)];

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countParams = [...params];
  const total = (
    await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM medicines m ${whereSql}`,
      countParams,
    )
  ).rows[0]?.total ?? "0";

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT ${MEDICINE_COLUMNS} FROM medicines m ${whereSql}
     ORDER BY ${order} NULLS LAST, m.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return json({
    items: rows.map(serialiseMedicine),
    total: Number(total),
    limit,
    offset,
  });
}

async function handleMedicine(slug: string) {
  const { rows } = await pool.query(
    `SELECT ${MEDICINE_COLUMNS} FROM medicines m WHERE m.slug = $1 LIMIT 1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return json({ error: "not found" }, 404);

  const medicine = serialiseMedicine(row);

  // Alternatives: same generic, same strength and form, different product.
  // `IS NOT DISTINCT FROM` rather than `=` so two null units still match.
  // Well-known manufacturers come first so a familiar brand leads the list;
  // price only breaks ties within the same standing.
  const { rows: alternatives } = await pool.query(
    `SELECT ${MEDICINE_COLUMNS}
     FROM medicines m
     WHERE m.generic_id = (SELECT generic_id FROM medicines WHERE slug = $1)
       AND m.id <> (SELECT id FROM medicines WHERE slug = $1)
       AND m.form = (SELECT form FROM medicines WHERE slug = $1)
       AND m.strength_value = (SELECT strength_value FROM medicines WHERE slug = $1)
       AND m.strength_unit IS NOT DISTINCT FROM (SELECT strength_unit FROM medicines WHERE slug = $1)
     ORDER BY ${companyRankSql("m.company_slug")} ASC, m.current_price ASC NULLS LAST
     LIMIT 40`,
    [slug],
  );

  const { rows: otherStrengths } = await pool.query(
    `SELECT ${MEDICINE_COLUMNS}
     FROM medicines m
     WHERE m.generic_id = (SELECT generic_id FROM medicines WHERE slug = $1)
       AND m.id <> (SELECT id FROM medicines WHERE slug = $1)
       AND (m.strength_value IS DISTINCT FROM (SELECT strength_value FROM medicines WHERE slug = $1)
            OR m.strength_unit IS DISTINCT FROM (SELECT strength_unit FROM medicines WHERE slug = $1))
     ORDER BY m.current_price ASC NULLS LAST
     LIMIT 20`,
    [slug],
  );

  return json({
    medicine,
    alternatives: alternatives.map(serialiseMedicine),
    otherStrengths: otherStrengths.map(serialiseMedicine),
  });
}

async function handlePriceHistory(slug: string) {
  const { rows: medicineRows } = await pool.query<{ id: number }>(
    `SELECT id FROM medicines WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  const medicine = medicineRows[0];
  if (!medicine) return json({ error: "not found" }, 404);

  const { rows } = await pool.query<{
    id: number;
    price: string | null;
    currency: string;
    pack_type: string | null;
    pack_size: number | null;
    captured_at: string;
  }>(
    `SELECT id, price, currency, pack_type, pack_size, captured_at::text
       FROM price_history
      WHERE medicine_id = $1
      ORDER BY captured_at DESC
      LIMIT 30`,
    [medicine.id],
  );

  return json({
    items: rows.map((r) => ({
      id: r.id,
      price: num(r.price),
      currency: r.currency,
      packType: r.pack_type,
      packSize: r.pack_size,
      capturedAt: r.captured_at,
    })),
  });
}

async function handleGeneric(slug: string) {
  const { rows: generics } = await pool.query(`SELECT id, name, slug FROM generics WHERE slug = $1`, [slug]);
  const generic = generics[0];
  if (!generic) return json({ error: "not found" }, 404);

  const { rows } = await pool.query(
    `SELECT ${MEDICINE_COLUMNS} FROM medicines m
     WHERE m.generic_id = $1
     ORDER BY m.strength_value ASC NULLS LAST, m.current_price ASC NULLS LAST`,
    [generic.id],
  );

  return json({
    generic,
    brands: rows.map(serialiseMedicine),
  });
}

async function handleGenerics() {
  const { rows } = await pool.query(
    `SELECT g.slug, g.name,
            COUNT(m.id)::int            AS "brandCount",
            COUNT(DISTINCT m.company_id)::int AS "companyCount",
            MIN(m.current_price)::float8 AS "minPrice",
            MAX(m.current_price)::float8 AS "maxPrice"
     FROM generics g
     JOIN medicines m ON m.generic_id = g.id
     GROUP BY g.id
     ORDER BY COUNT(m.id) DESC, g.name ASC
     LIMIT 1000`,
  );
  return json({ items: rows });
}

async function handleCategories() {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.slug_path AS "slugPath", c.path, c.depth,
            COUNT(m.id)::int AS "productCount"
     FROM categories c
     JOIN medicines m ON m.category_id = c.id
     GROUP BY c.id
     ORDER BY c.depth ASC, COUNT(m.id) DESC`,
  );
  return json({ items: rows });
}

async function handleCompanies() {
  const { rows } = await pool.query(
    `SELECT c.slug, c.name, COUNT(m.id)::int AS "productCount"
     FROM companies c
     JOIN medicines m ON m.company_id = c.id
     GROUP BY c.id
     ORDER BY COUNT(m.id) DESC, c.name ASC`,
  );
  return json({ items: rows });
}

async function handleStats() {
  const stats = (
    await pool.query(
      `SELECT
         (SELECT count(*)::int FROM medicines)  AS medicines,
         (SELECT count(*)::int FROM generics)   AS generics,
         (SELECT count(*)::int FROM companies)  AS companies,
         (SELECT count(*)::int FROM categories) AS categories,
         (SELECT max(updated_at)::text FROM medicines) AS "lastUpdated"`,
    )
  ).rows[0];
  return json(stats);
}

async function handlePrescriptionList(userId: string) {
  const { rows } = await writePool.query(
    `SELECT id, title, payload, updated_at
     FROM prescriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200`,
    [userId],
  );
  return json({ items: rows.map((r) => ({ id: r.id, title: r.title, payload: r.payload, updatedAt: r.updated_at })) });
}

async function handlePrescriptionSave(request: Request, userId: string) {
  const body = await request.json().catch(() => null) as { id?: string; title?: string; payload?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id || body.payload === undefined) {
    return json({ error: "invalid body" }, 400);
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Prescription";
  const result = await writePool.query(
    `INSERT INTO prescriptions (id, user_id, title, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       payload = EXCLUDED.payload,
       updated_at = now()
     WHERE prescriptions.user_id = $2
     RETURNING id, updated_at`,
    [body.id, userId, title, JSON.stringify(body.payload)],
  );
  if (result.rows.length === 0) {
    return json({ error: "not allowed or not found" }, 403);
  }
  return json({ id: result.rows[0].id, updatedAt: result.rows[0].updated_at });
}

async function handlePrescriptionDelete(slug: string, userId: string) {
  const result = await writePool.query(
    `DELETE FROM prescriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
    [decodeURIComponent(slug), userId],
  );
  if (result.rows.length === 0) return json({ error: "not found" }, 404);
  return json({ deleted: true });
}

/* -------------------------------------------------------------------- entry */

function handleAuthRedirect(url: URL): Response {
  const verifier = url.searchParams.get("neon_auth_session_verifier") ?? "";
  // Fully encode before interpolation; encodeURIComponent already neutralises
  // quote/angle-bracket characters, so the value cannot break out of the
  // JavaScript string or the href attribute below.
  const deepLink = `osudh360://auth-callback?neon_auth_session_verifier=${encodeURIComponent(verifier)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Osudh360 sign-in</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e5e9f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{text-align:center;padding:24px}h1{font-size:18px}p{font-size:14px;opacity:.75;line-height:1.5}a{display:inline-block;margin-top:16px;color:#7fd1ff}</style>
</head>
<body>
  <div class="card">
    <h1>Returning to Osudh360…</h1>
    <p>If the app does not open automatically, tap below.</p>
    <a href="${deepLink}">Open Osudh360</a>
  </div>
  <script>location.replace("${deepLink}");</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const handler = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const cors = corsHeaders(request);

    // Browser preflight; never authenticated.
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // The function has a public URL; this is a read-only catalogue, so GET and
    // HEAD are all it serves.
    const method = request.method.toUpperCase();
    if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)) {
      return json({ error: "method not allowed" }, 405, cors);
    }

    try {
      // OAuth callback relay. This is a browser navigation that fires during
      // sign-in, before the app holds any token, so it stays public; it only
      // renders a page that forwards the session verifier into the app's deep
      // link. Everything else reads the catalogue and requires a signed-in user.
      if (url.searchParams.has("neon_auth_session_verifier")) return handleAuthRedirect(url);

      const userId = await authenticate(request);
      if (!userId) return json({ error: "unauthorized" }, 401, cors);

      if (method === "HEAD") return new Response(null, { status: 200, headers: cors });

      let response: Response;
      if (path === "/prescriptions") {
        if (method === "GET") response = await handlePrescriptionList(userId);
        else if (method === "POST" || method === "PUT") response = await handlePrescriptionSave(request, userId);
        else response = json({ error: "method not allowed" }, 405);
      } else if (path.startsWith("/prescriptions/")) {
        if (method === "DELETE") response = await handlePrescriptionDelete(path.slice("/prescriptions/".length), userId);
        else response = json({ error: "method not allowed" }, 405);
      } else if (path === "/") response = await handleStats();
      else if (path === "/sync") response = await handleSync(url);
      else if (path === "/medicines") response = await handleMedicines(url);
      else if (path === "/generics") response = await handleGenerics();
      else if (path === "/categories") response = await handleCategories();
      else if (path === "/companies") response = await handleCompanies();
      else if (path === "/auth-redirect") response = handleAuthRedirect(url);
      else {
        const medicineHistory = path.match(/^\/medicines\/([^/]+)\/history$/);
        const medicine = path.match(/^\/medicines\/([^/]+)$/);
        const generic = path.match(/^\/generics\/([^/]+)$/);
        if (medicineHistory) response = await handlePriceHistory(decodeURIComponent(medicineHistory[1]));
        else if (medicine) response = await handleMedicine(decodeURIComponent(medicine[1]));
        else if (generic) response = await handleGeneric(decodeURIComponent(generic[1]));
        else response = json({ error: "not found" }, 404);
      }
      return await withCors(response, cors);
    } catch (error) {
      console.error("[api]", error);
      return json({ error: "internal error" }, 500, cors);
    }
  },
};

export default handler;
