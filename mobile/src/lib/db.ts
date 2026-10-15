import * as SQLite from "expo-sqlite";
import { companyRankSql } from "./companies";

/**
 * Local catalogue cache.
 *
 * The whole point of the offline design: the phone mirrors the *entire*
 * catalogue into SQLite on first sync. Every screen then reads from here and
 * never needs the network, so search, prices, and even the alternatives list
 * work with the radio off.
 *
 * Alternatives are computed locally rather than fetched, because the local rows
 * already carry generic id, strength value/unit and form - exactly the columns
 * the "same generic, same dose" comparison needs.
 */

export type LocalMedicine = {
  id: number;
  slug: string;
  brand: string;
  /** Trade name with a redundant strength suffix removed, for mg grouping. */
  brandBase: string | null;
  generic: string | null;
  genericSlug: string | null;
  company: string | null;
  companySlug: string | null;
  form: string;
  strength: string;
  strengthValue: number | null;
  strengthUnit: string | null;
  isCombo: number;
  packType: string | null;
  packSize: number | null;
  price: number | null;
  currency: string;
  category: string | null;
  categorySlugPath: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("osudh360.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS medicines (
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

        -- Offline search filters on brand, generic and company.
        CREATE INDEX IF NOT EXISTS idx_med_brand   ON medicines (brand);
        CREATE INDEX IF NOT EXISTS idx_med_generic ON medicines (generic);
        CREATE INDEX IF NOT EXISTS idx_med_company ON medicines (company);
        CREATE INDEX IF NOT EXISTS idx_med_alt ON medicines (generic_slug, strength_value, strength_unit, form);
        CREATE INDEX IF NOT EXISTS idx_med_category ON medicines (category_slug_path);
        CREATE INDEX IF NOT EXISTS idx_med_form    ON medicines (form);
        CREATE INDEX IF NOT EXISTS idx_med_brandbase ON medicines (brand_base, company_slug, form);

        CREATE TABLE IF NOT EXISTS meta (
          key   TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // `brand_base` was added after the first release; patch existing installs
      // in place (CREATE TABLE IF NOT EXISTS is a no-op once the table exists).
      const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(medicines)");
      if (!cols.some((c) => c.name === "brand_base")) {
        await db.execAsync(`
          ALTER TABLE medicines ADD COLUMN brand_base TEXT;
          CREATE INDEX IF NOT EXISTS idx_med_brandbase ON medicines (brand_base, company_slug, form);
        `);
      }
      return db;
    })();
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await open();
  await db.runAsync("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key,
    value,
  ]);
}

/** Local medicines are keyed by their server id. */
type SyncRow = {
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
  price: number | null;
  currency: string;
  category: string | null;
  categorySlugPath: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
};

/** Column list shared by both write paths, so the placeholders cannot drift. */
const INSERT_COLUMNS = `(
  id, slug, brand, brand_base, generic, generic_slug, company, company_slug,
  form, strength, strength_value, strength_unit, is_combo,
  pack_type, pack_size, price, currency, category, category_slug_path,
  source_url, updated_at
)`;

const COLUMN_COUNT = 21;

/** Flattens one sync row into positional values matching INSERT_COLUMNS. */
function toRowValues(r: SyncRow): (string | number | null)[] {
  return [
    r.id,
    r.slug,
    r.brand,
    r.brandBase,
    r.generic,
    r.genericSlug,
    r.company,
    r.companySlug,
    r.form,
    r.strength,
    r.strengthValue,
    r.strengthUnit,
    r.isCombo ? 1 : 0,
    r.packType,
    r.packSize,
    r.price,
    r.currency,
    r.category,
    r.categorySlugPath,
    r.sourceUrl,
    r.updatedAt,
  ];
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => `(${Array(COLUMN_COUNT).fill("?").join(",")})`).join(",");
}

/**
 * Replaces the cached catalogue in one transaction.
 *
 * The sync endpoint is authoritative for the rows it returns, so a full sync
 * clears and rewrites. Doing it inside a transaction means the UI never sees a
 * half-updated catalogue.
 */
/**
 * Replaces the cached catalogue in one transaction.
 *
 * The sync endpoint is authoritative for the rows it returns, so a full sync
 * clears and rewrites. Doing it inside a transaction means the UI never sees a
 * half-updated catalogue.
 */
export async function replaceCatalogue(rows: SyncRow[]): Promise<void> {
  const db = await open();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM medicines");
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await db.runAsync(
        `INSERT INTO medicines ${INSERT_COLUMNS} VALUES ${placeholders(chunk.length)}`,
        chunk.flatMap(toRowValues),
      );
    }
  });
}

/** Upserts only the changed rows; used by incremental syncs. */
export async function upsertCatalogue(rows: SyncRow[]): Promise<void> {
  const db = await open();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await db.runAsync(
        `INSERT INTO medicines ${INSERT_COLUMNS} VALUES ${placeholders(chunk.length)}
         ON CONFLICT(id) DO UPDATE SET
           slug=excluded.slug, brand=excluded.brand, brand_base=excluded.brand_base,
           generic=excluded.generic,
           generic_slug=excluded.generic_slug, company=excluded.company,
           company_slug=excluded.company_slug, form=excluded.form,
           strength=excluded.strength, strength_value=excluded.strength_value,
           strength_unit=excluded.strength_unit, is_combo=excluded.is_combo,
           pack_type=excluded.pack_type, pack_size=excluded.pack_size,
           price=excluded.price, currency=excluded.currency,
           category=excluded.category, category_slug_path=excluded.category_slug_path,
           source_url=excluded.source_url, updated_at=excluded.updated_at`,
        chunk.flatMap(toRowValues),
      );
    }
  });
}

export async function countMedicines(): Promise<number> {
  const db = await open();
  const row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) AS c FROM medicines");
  return row?.c ?? 0;
}

/**
 * How many cached rows carry a brand family. `brand_base` was added after the
 * first release, so a cache built by an older build has rows but none with a
 * brand family; that is the signal to do one full resync so the grouped
 * "mg chips" view has data to work with.
 */
export async function countWithBrandBase(): Promise<number> {
  const db = await open();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM medicines WHERE brand_base IS NOT NULL",
  );
  return row?.c ?? 0;
}

/**
 * Version of the catalogue's *contents rules* — what counts as a sellable
 * medicine. Deliberately not the schema version: when this changes, rows that
 * used to be imported (no price; brand name repeating the generic) no longer
 * exist upstream, and because `/sync` only ever reports rows that changed, an
 * incremental sync would silently keep the stale copies. A bump forces one full
 * replacement so the removals actually land.
 *
 * Bump this whenever the importer's curation rules change.
 */
export const CATALOGUE_RULES_VERSION = "2";
export const CATALOGUE_RULES_KEY = "catalogueRulesVersion";

/* ------------------------------------------------------------------ queries */

// Aliased to camelCase: expo-sqlite returns rows keyed by the *exact* column
// name, and `LocalMedicine` is camelCase. Without these aliases every
// multi-word field (packSize, sourceUrl, strengthValue, …) came back undefined.
const SELECT_COLUMNS = `
  id, slug, brand, brand_base AS brandBase, generic,
  generic_slug AS genericSlug, company, company_slug AS companySlug,
  form, strength, strength_value AS strengthValue, strength_unit AS strengthUnit,
  is_combo AS isCombo, pack_type AS packType, pack_size AS packSize,
  price, currency, category, category_slug_path AS categorySlugPath,
  source_url AS sourceUrl, updated_at AS updatedAt
`;

/**
 * Escapes LIKE metacharacters so a user's `%` or `_` is matched literally.
 */
function escapeLike(raw: string) {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%term%` */
function likeTerm(raw: string) {
  return `%${escapeLike(raw)}%`;
}

/** `term%` — must be built separately, not by appending to likeTerm(). */
function likePrefix(raw: string) {
  return `${escapeLike(raw)}%`;
}

export type SearchOptions = {
  q?: string;
  form?: string;
  pack?: string;
  category?: string;
  sort?: "brand" | "price_asc" | "price_desc";
  limit?: number;
  offset?: number;
};

/**
 * Offline search over the cached catalogue.
 *
 * Words are OR'd rather than AND'd: searching "napa ace" should surface Napa
 * *or* Ace brands, not the empty set of brands whose name contains both.
 * Ranking then puts a brand that *starts with* the term above one that merely
 * contains it, so "napa" finds "Napa 500" before "Finapark 100".
 */
export async function searchMedicines(opts: SearchOptions = {}): Promise<{ items: LocalMedicine[]; total: number }> {
  const db = await open();
  const where: string[] = [];
  const params: (string | number)[] = [];

  const q = opts.q?.trim();
  if (q) {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
    if (words.length === 0) return { items: [], total: 0 };

    where.push(
      `(${words
        .map(
          () =>
            "(LOWER(brand) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(generic,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(company,'')) LIKE ? ESCAPE '\\')",
        )
        .join(" OR ")})`,
    );
    for (const w of words)
      params.push(likeTerm(w.toLowerCase()), likeTerm(w.toLowerCase()), likeTerm(w.toLowerCase()));

    // Rank: a brand starting with any word beats a brand merely containing it,
    // which beats a generic-name match. Shorter names then win, so "Napa 500"
    // sorts above "Napa Extra".
    const prefixes = words.map((w) => likePrefix(w.toLowerCase()));
    const anyContains = likeTerm(q.toLowerCase());

    const rankParams: string[] = [];
    let rankSql: string;
    if (opts.sort === "price_asc" || opts.sort === "price_desc") {
      rankSql = "";
      rankParams.push(...prefixes);
      rankParams.push(anyContains);
    } else {
      const brandPrefixCases = words.map(() => "WHEN LOWER(brand) LIKE ? ESCAPE '\\' THEN 0").join(" ");
      const genericPrefixCases = words
        .map(() => "WHEN LOWER(COALESCE(generic,'')) LIKE ? ESCAPE '\\' THEN 2")
        .join(" ");
      rankSql = `CASE ${brandPrefixCases}
        WHEN LOWER(brand) LIKE ? ESCAPE '\\' THEN 1
        ${genericPrefixCases}
        ELSE 3 END`;
      rankParams.push(...prefixes);
      rankParams.push(anyContains);
      rankParams.push(...prefixes);
    }

    const order =
      opts.sort === "price_asc"
        ? "price ASC"
        : opts.sort === "price_desc"
          ? "price DESC"
          : `${rankSql}, LENGTH(brand) ASC, brand ASC`;

    const limit = opts.limit ?? 40;
    const offset = opts.offset ?? 0;

    const [countRow, rows] = await Promise.all([
      db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM medicines WHERE ${where.join(" AND ")}`,
        params,
      ),
      db.getAllAsync<LocalMedicine>(
        `SELECT ${SELECT_COLUMNS} FROM medicines WHERE ${where.join(" AND ")}
         ORDER BY ${order} NULLS LAST LIMIT ? OFFSET ?`,
        [...params, ...rankParams, limit, offset],
      ),
    ]);
    return { items: rows, total: countRow?.c ?? rows.length };
  }

  if (opts.form) {
    where.push("form = ?");
    params.push(opts.form);
  }
  if (opts.pack === "Loose") where.push("pack_size = 1 AND pack_type IN ('Tablet','Capsule')");
  else if (opts.pack) {
    const [type, size] = opts.pack.split(":");
    where.push("pack_type = ?");
    params.push(type);
    if (size) {
      where.push("pack_size = ?");
      params.push(Number(size));
    }
  }
  if (opts.category) {
    // Prefix match covers the whole branch of the category tree.
    where.push("(category_slug_path = ? OR category_slug_path LIKE ?)");
    params.push(opts.category, `${opts.category}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order =
    opts.sort === "price_asc"
      ? "price ASC"
      : opts.sort === "price_desc"
        ? "price DESC"
        : "brand ASC";

  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;

  const [countRow, rows] = await Promise.all([
    db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM medicines ${whereSql}`, params),
    db.getAllAsync<LocalMedicine>(
      `SELECT ${SELECT_COLUMNS} FROM medicines ${whereSql} ORDER BY ${order} NULLS LAST LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
  ]);

  return { items: rows, total: countRow?.c ?? rows.length };
}

export async function getMedicineBySlug(slug: string): Promise<LocalMedicine | null> {
  const db = await open();
  const row = await db.getFirstAsync<LocalMedicine>(
    `SELECT ${SELECT_COLUMNS} FROM medicines WHERE slug = ?`,
    [slug],
  );
  return row ?? null;
}

/**
 * Other companies selling the same generic at the same strength and form.
 *
 * Alternatives are matched on the generic slug plus strength value/unit and
 * form - exactly the columns the "same generic, same dose" comparison needs,
 * so the offline result matches the server's.
 *
 * Well-known manufacturers are listed first so a familiar brand leads the list
 * rather than the cheapest one from an unfamiliar maker; price only breaks ties
 * within the same standing.
 */
export async function getAlternatives(slug: string, limit = 40): Promise<LocalMedicine[]> {
  const db = await open();
  return db.getAllAsync<LocalMedicine>(
    `SELECT ${SELECT_COLUMNS} FROM medicines
     WHERE generic_slug = (SELECT generic_slug FROM medicines WHERE slug = ?)
       AND slug <> ?
       AND form = (SELECT form FROM medicines WHERE slug = ?)
       AND strength_value IS (SELECT strength_value FROM medicines WHERE slug = ?)
       AND strength_unit IS (SELECT strength_unit FROM medicines WHERE slug = ?)
     ORDER BY ${companyRankSql("company_slug")} ASC, price ASC NULLS LAST
     LIMIT ?`,
    [slug, slug, slug, slug, slug, limit],
  );
}

export async function getOtherStrengths(slug: string, limit = 20): Promise<LocalMedicine[]> {
  const db = await open();
  return db.getAllAsync<LocalMedicine>(
    `SELECT ${SELECT_COLUMNS} FROM medicines
     WHERE generic_slug = (SELECT generic_slug FROM medicines WHERE slug = ?)
       AND slug <> ?
       AND (
         strength_value IS NOT (SELECT strength_value FROM medicines WHERE slug = ?)
         OR strength_unit IS NOT (SELECT strength_unit FROM medicines WHERE slug = ?)
       )
     ORDER BY price ASC NULLS LAST
     LIMIT ?`,
    [slug, slug, slug, slug, limit],
  );
}

export async function getBrandsOfGeneric(genericSlug: string): Promise<LocalMedicine[]> {
  const db = await open();
  return db.getAllAsync<LocalMedicine>(
    `SELECT ${SELECT_COLUMNS} FROM medicines
     WHERE generic_slug = ?
     ORDER BY strength_value ASC NULLS LAST, price ASC NULLS LAST`,
    [genericSlug],
  );
}

export async function listGenerics(limit = 200): Promise<{ slug: string; name: string; brandCount: number }[]> {
  const db = await open();
  return db.getAllAsync(
    `SELECT generic_slug AS slug, generic AS name, COUNT(*) AS brandCount
     FROM medicines WHERE generic_slug IS NOT NULL
     GROUP BY generic_slug ORDER BY brandCount DESC, name ASC LIMIT ?`,
    [limit],
  );
}

export async function listCategories(
  limit = 200,
): Promise<{ slugPath: string; name: string; depth: number; productCount: number }[]> {
  const db = await open();
  return db.getAllAsync(
    `SELECT category_slug_path AS slugPath,
            category AS name,
            LENGTH(category_slug_path) - LENGTH(REPLACE(category_slug_path, '/', '')) + 1 AS depth,
            COUNT(*) AS productCount
     FROM medicines WHERE category_slug_path IS NOT NULL
     GROUP BY category_slug_path ORDER BY productCount DESC LIMIT ?`,
    [limit],
  );
}

/* ------------------------------------------------------------- brand grouping */

/**
 * Dosage forms where the thing that varies between otherwise-identical rows is
 * the bottle/jar size ("60ml" vs "100ml" syrup) rather than the dose. For these
 * the variant chips show the pack size; everything else follows the trade
 * naming convention and chips on the strength.
 *
 * Based on the canonical forms produced by `normaliseForm` (see
 * src/lib/medicine.ts): powder-in-suspension already lands in Suspension, so
 * Powders and Sachets here are solid-dose forms and stay strength-based.
 */
const FLUID_FORMS = new Set([
  "Syrup",
  "Suspension",
  "Drops",
  "Injection",
  "Cream",
  "Ointment",
  "Gel",
  "Lotion",
  "Shampoo",
  "Solution",
  "Spray",
  "Foam",
]);

export function isFluidForm(form: string): boolean {
  return FLUID_FORMS.has(form);
}

/**
 * Volume or weight token from the pack, e.g. "60ml" from "60ml Bottle".
 *
 * The source keeps these in `pack_type`, not a numeric column, and the unit
 * spellings are loose ("200m bot" was seen in the wild), so the token is
 * scraped and normalised rather than parsed.
 */
export function sizeTokenOf(m: LocalMedicine): string | null {
  const t = [m.packType, m.brand].filter(Boolean).join(" ");
  const mt = t.match(/(\d+(?:\.\d+)?)\s*(ml|litre|l|gm|g|m)(?:\b|s)/i);
  if (!mt) return null;
  const unit = mt[2].toLowerCase();
  const norm = unit === "m" ? "ml" : unit === "litre" ? "L" : unit === "gm" ? "g" : unit;
  return `${mt[1]}${norm}`;
}

/** One chip on a grouped brand row / the detail screen. */
export type BrandChip = { slug: string; label: string };

/**
 * Chip label for one variant: the pack size for fluids, the dose otherwise.
 *
 * When a fluid family also spans several concentrations, the size alone would
 * be ambiguous ("60ml" of a 120mg/5ml and of a 250mg/5ml), so the strength is
 * appended as context, e.g. "60ml · 125mg/5ml".
 */
export function variantLabel(m: LocalMedicine, fluidStrengthCount?: number): string {
  if (isFluidForm(m.form)) {
    const size = sizeTokenOf(m);
    if (size) {
      if (fluidStrengthCount && fluidStrengthCount > 1 && m.strength) return `${size} · ${m.strength}`;
      return size;
    }
  }
  return m.strength || m.brand;
}

/** Chips sort by dose for solids and by bottle size for fluids. */
function dimValue(v: LocalMedicine): number {
  if (isFluidForm(v.form)) {
    const n = parseFloat(sizeTokenOf(v) ?? "");
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  }
  return v.strengthValue ?? Number.MAX_SAFE_INTEGER;
}

/** Orders the members of one family, low dose/size to high, cheapest first. */
export function sortVariants(rows: LocalMedicine[]): LocalMedicine[] {
  return [...rows].sort(
    (a, b) =>
      dimValue(a) - dimValue(b) ||
      (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) ||
      a.brand.localeCompare(b.brand),
  );
}

/**
 * Distinct chips for a family, one per label. Duplicate rows (the same syrup
 * size listed twice) collapse into a single chip pointing at the cheapest one.
 */
export function chipsOf(variants: LocalMedicine[]): BrandChip[] {
  const strengths = new Set(variants.map((v) => v.strength).filter(Boolean));
  const seen = new Set<string>();
  const chips: BrandChip[] = [];
  for (const v of sortVariants(variants)) {
    const label = variantLabel(v, strengths.size);
    if (seen.has(label)) continue;
    seen.add(label);
    chips.push({ slug: v.slug, label });
  }
  return chips;
}

/** One entry per brand family, with its mg (or size) variants collapsed underneath. */
export type BrandGroup = {
  key: string;
  /** Trade name with the strength suffix removed, e.g. "Napa". */
  brand: string;
  generic: string | null;
  genericSlug: string | null;
  company: string | null;
  companySlug: string | null;
  form: string;
  /** Cheapest price across the variants, shown on the collapsed row. */
  price: number | null;
  /** The strengths (or pack sizes for fluids), ordered low to high. */
  variants: LocalMedicine[];
  /** Unique chips for the variants, cheapest variant per label. */
  chips: BrandChip[];
};

/**
 * Collapses medicine rows into one entry per brand family so a brand's mg
 * variants render as chips instead of separate rows.
 *
 * The family key is (brand family, company, form): "Napa 500" and "Napa 650"
 * from the same company merge into one "Napa" entry, while a same-named
 * product from a different company, or in a different form, stays separate.
 * Insertion order is preserved, so the caller's search ranking is retained.
 */
export function groupByBrand(rows: LocalMedicine[]): BrandGroup[] {
  const groups = new Map<string, BrandGroup>();

  for (const r of rows) {
    const base = r.brandBase || r.brand;
    const key = `${base}|${r.companySlug ?? r.company ?? ""}|${r.form}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        brand: base,
        generic: r.generic,
        genericSlug: r.genericSlug,
        company: r.company,
        companySlug: r.companySlug,
        form: r.form,
        price: null,
        variants: [],
        chips: [],
      };
      groups.set(key, g);
    }
    g.variants.push(r);
    if (r.price != null && (g.price == null || r.price < g.price)) g.price = r.price;
  }

  for (const g of groups.values()) {
    g.variants = sortVariants(g.variants);
    g.chips = chipsOf(g.variants);
  }

  return [...groups.values()];
}

/**
 * Every strength of the same brand family, for the mg chips on the detail
 * screen. Results include the medicine itself so the current dose can be
 * highlighted.
 */
export async function getBrandStrengths(slug: string, limit = 24): Promise<LocalMedicine[]> {
  const db = await open();
  return db.getAllAsync<LocalMedicine>(
    `SELECT ${SELECT_COLUMNS} FROM medicines
     WHERE COALESCE(brand_base, brand) = (SELECT COALESCE(brand_base, brand) FROM medicines WHERE slug = ?)
       AND company_slug IS (SELECT company_slug FROM medicines WHERE slug = ?)
       AND form = (SELECT form FROM medicines WHERE slug = ?)
     ORDER BY strength_value ASC NULLS LAST, price ASC NULLS LAST
     LIMIT ?`,
    [slug, slug, slug, limit],
  );
}