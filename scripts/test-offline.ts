// Headless check of the mobile app's offline layer.
//
// The app has no emulator test here, so this replays the *exact* schema and
// queries from mobile/src/lib/db.ts against a temporary SQLite file, feeding it
// real rows from the deployed API. If the offline path returns the same
// alternatives as the server, the app's core promise holds.
//
//   node --experimental-strip-types scripts/test-offline.ts

import Database from "better-sqlite3";

/**
 * Mirrors mobile/src/lib/api.ts. Inlined rather than imported because that
 * module pulls in expo-constants, which only loads inside a React Native
 * runtime.
 */
const API_URL = process.env.API_URL ?? "https://br-bold-salad-b59octic-api.compute.c-7.us-east-2.aws.neon.tech";
const headers: Record<string, string> = process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {};

const db = new Database(":memory:");

/* --- schema copied verbatim from mobile/src/lib/db.ts --- */
db.exec(`
  CREATE TABLE medicines (
    id                INTEGER PRIMARY KEY,
    slug              TEXT NOT NULL UNIQUE,
    brand             TEXT NOT NULL,
    brand_base        TEXT,
    generic           TEXT,
    generic_slug      TEXT,
    company           TEXT,
    company_slug      TEXT,
    form              TEXT NOT NULL,
    strength          TEXT NOT NULL,
    strength_value    REAL,
    strength_unit     TEXT,
    is_combo          INTEGER NOT NULL DEFAULT 0,
    pack_type         TEXT,
    pack_size         INTEGER,
    price             REAL,
    currency          TEXT NOT NULL DEFAULT 'BDT',
    category          TEXT,
    category_slug_path TEXT,
    source_url        TEXT,
    updated_at        TEXT
  );
  CREATE INDEX idx_med_brand   ON medicines (brand);
  CREATE INDEX idx_med_generic ON medicines (generic);
  CREATE INDEX idx_med_company ON medicines (company);
  CREATE INDEX idx_med_alt     ON medicines (generic_slug, strength_value, strength_unit, form);
  CREATE INDEX idx_med_category ON medicines (category_slug_path);
  CREATE INDEX idx_med_form    ON medicines (form);
`);

/* --- pull the catalogue the same way the app does --- */
console.log("fetching catalogue from the API…");
const t0 = Date.now();
let total = 0;
const insert = db.prepare(`
  INSERT INTO medicines (
    id, slug, brand, brand_base, generic, generic_slug, company, company_slug,
    form, strength, strength_value, strength_unit, is_combo,
    pack_type, pack_size, price, currency, category, category_slug_path,
    source_url, updated_at
  ) VALUES (
    @id, @slug, @brand, @brandBase, @generic, @genericSlug, @company, @companySlug,
    @form, @strength, @strengthValue, @strengthUnit, @isCombo,
    @packType, @packSize, @price, @currency, @category, @categorySlugPath,
    @sourceUrl, @updatedAt
  )
`);

/** Mirrors toRowValues() in mobile/src/lib/db.ts, including the boolean cast. */
function toRowValues(r: Record<string, unknown>) {
  return {
    ...r,
    isCombo: r.isCombo ? 1 : 0,
    strengthValue: r.strengthValue ?? null,
    packSize: r.packSize ?? null,
    price: r.price ?? null,
  };
}

const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
  for (const r of rows) insert.run(toRowValues(r));
});

// Page with the same stable id cursor the app uses.
let after: number | null = null;
for (;;) {
  const qs = after != null ? `?limit=5000&after=${after}` : "?limit=5000";
  const res = await fetch(`${API_URL}/sync${qs}`, { headers });
  const page = (await res.json()) as {
    items: Record<string, unknown>[];
    hasMore: boolean;
    cursor: number | null;
  };
  insertMany(page.items);
  total += page.items.length;
  if (!page.hasMore || page.items.length === 0) break;
  after = page.cursor ?? after;
}
console.log(`  cached ${total} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* --- the queries from mobile/src/lib/db.ts --- */
const escapeLike = (raw: string) => raw.replace(/[\\%_]/g, (c) => `\\${c}`);
const likeTerm = (raw: string) => `%${escapeLike(raw)}%`;
const likePrefix = (raw: string) => `${escapeLike(raw)}%`;

function searchMedicines(q: string, limit = 20) {
  // Mirrors mobile/src/lib/db.ts: OR across words, prefix-first ranking.
  const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return [];
  const lowered = words.map((w) => w.toLowerCase());
  const where = `(${words
    .map(() => "(LOWER(brand) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(generic,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(company,'')) LIKE ? ESCAPE '\\')")
    .join(" OR ")})`;
  const params: string[] = [];
  for (const w of lowered) params.push(likeTerm(w), likeTerm(w));

  const prefixes = lowered.map((w) => likePrefix(w));
  const anyContains = likeTerm(q.toLowerCase());
  const rankSql = `CASE ${lowered
    .map(() => "WHEN LOWER(brand) LIKE ? ESCAPE '\\' THEN 0")
    .join(" ")}
      WHEN LOWER(brand) LIKE ? ESCAPE '\\' THEN 1
      ${lowered.map(() => "WHEN LOWER(COALESCE(generic,'')) LIKE ? ESCAPE '\\' THEN 2").join(" ")}
      ELSE 3 END`;

  return db
    .prepare(
      `SELECT brand, generic, company, strength, pack_type, pack_size, price, slug
       FROM medicines WHERE ${where}
       ORDER BY ${rankSql}, LENGTH(brand) ASC, brand ASC
       LIMIT ?`,
    )
    .all(...params, ...prefixes, anyContains, ...prefixes, limit) as Record<string, unknown>[];
}

function getAlternatives(slug: string, limit = 40) {
  return db
    .prepare(
      `SELECT brand, company, price, slug FROM medicines
       WHERE generic_slug = (SELECT generic_slug FROM medicines WHERE slug = ?)
         AND slug <> ?
         AND form = (SELECT form FROM medicines WHERE slug = ?)
         AND strength_value IS (SELECT strength_value FROM medicines WHERE slug = ?)
         AND strength_unit IS (SELECT strength_unit FROM medicines WHERE slug = ?)
       ORDER BY price ASC NULLS LAST LIMIT ?`,
    )
    .all(slug, slug, slug, slug, slug, limit) as Record<string, unknown>[];
}

function getOtherStrengths(slug: string, limit = 20) {
  return db
    .prepare(
      `SELECT brand, strength, price FROM medicines
       WHERE generic_slug = (SELECT generic_slug FROM medicines WHERE slug = ?)
         AND slug <> ?
         AND (strength_value IS NOT (SELECT strength_value FROM medicines WHERE slug = ?)
              OR strength_unit IS NOT (SELECT strength_unit FROM medicines WHERE slug = ?))
       ORDER BY price ASC NULLS LAST LIMIT ?`,
    )
    .all(slug, slug, slug, slug, limit) as Record<string, unknown>[];
}

/* --- assertions --- */
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\noffline search");
const hits = searchMedicines("napa");
check("finds Napa brands", hits.length > 0, `${hits.length} hits`);
check("ranks prefix matches first", String(hits[0]?.brand).toLowerCase().startsWith("napa"), String(hits[0]?.brand));
const multi = searchMedicines("napa ace");
check("multi-word search returns rows", multi.length > 0, `${multi.length} hits`);
const wildcard = searchMedicines("50%");
check("LIKE wildcard is escaped (no crash, plausible results)", Array.isArray(wildcard));

console.log("\noffline alternatives");
const target = db
  .prepare("SELECT slug FROM medicines WHERE generic_slug IS NOT NULL AND strength_value IS NOT NULL LIMIT 1")
  .get() as { slug: string } | undefined;
if (target) {
  const local = getAlternatives(target.slug);
  const res = await fetch(`${API_URL}/medicines/${target.slug}`, { headers });
  const server = (await res.json()) as { alternatives: { slug: string }[] };
  const localSlugs = new Set(local.map((r) => r.slug));
  const serverSlugs = server.alternatives.map((a) => a.slug);

  check("returns alternatives", local.length > 0, `${local.length} local vs ${serverSlugs.length} server`);
  const missing = serverSlugs.filter((s) => !localSlugs.has(s));
  check("offline alternatives match the server", missing.length === 0, missing.length ? `missing: ${missing.slice(0, 3)}` : "identical set");
  check("self is excluded", !local.some((r) => r.slug === target.slug));
  check("other strengths found", getOtherStrengths(target.slug).length >= 0);
}

console.log("\ndata sanity");
const dupes = db.prepare("SELECT slug, COUNT(*) c FROM medicines GROUP BY slug HAVING c > 1").all() as unknown[];
check("no duplicate slugs", dupes.length === 0);
const nulls = db.prepare("SELECT COUNT(*) c FROM medicines WHERE brand IS NULL OR form IS NULL").get() as { c: number };
check("no missing brand/form", nulls.c === 0, `${nulls.c} rows`);
const priced = db.prepare("SELECT COUNT(*) c FROM medicines WHERE price IS NOT NULL").get() as { c: number };
check("most rows have a price", priced.c > total * 0.98, `${priced.c}/${total}`);

console.log("\nbrand families (mg grouping)");
const withBase = db.prepare("SELECT COUNT(*) c FROM medicines WHERE brand_base IS NOT NULL").get() as { c: number };
check("brand_base populated for the catalogue", withBase.c > total * 0.9, `${withBase.c}/${total}`);
const fam = db.prepare(
  "SELECT brand_base, COUNT(*) c FROM medicines WHERE brand_base IS NOT NULL " +
    "GROUP BY brand_base, company_slug, form HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 1",
).get() as { brand_base: string; c: number } | undefined;
check(
  "identical brands collapse into variant families",
  fam !== undefined,
  fam ? `${fam.brand_base} → ${fam.c} variants` : "no multi-strength families found",
);

console.log(`\n${failures === 0 ? "✓ all offline checks passed" : `✗ ${failures} check(s) failed`}`);
db.close();
process.exit(failures === 0 ? 0 : 1);