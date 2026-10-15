// Step 4 - import crawled JSONL into SQLite.
//
// Bulk loading uses prepared statements inside one transaction rather than the
// ORM, because a full import is tens of thousands of rows and per-row queries
// dominate the runtime otherwise.
//
// Idempotent: re-running updates prices in place and only appends to
// price_history when the price actually changed.

import Database from "better-sqlite3";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { normaliseForm, parseStrength, slugify } from "../src/lib/medicine.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const PRODUCTS = resolve(DATA, "products.jsonl");
const DB_PATH = process.env.DATABASE_PATH ?? resolve(DATA, "osudh360.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/* ---------------------------------------------------------------- helpers */

const companyIds = new Map<string, number>(); // slug -> id
const genericIds = new Map<string, number>(); // slug -> id
const categoryIds = new Map<string, number>(); // path -> id
const usedMedicineSlugs = new Set<string>();
const storedSlugBySource = new Map<string, string>(); // source_id -> slug already in the database

type IdRow = { id: number };
type ExistingMedicine = { id: number; current_price: number | null };

/** `Statement.get` is typed as `unknown`; narrow it where the shape is known. */
const asId = (row: unknown): IdRow | undefined => row as IdRow | undefined;
const asMedicine = (row: unknown): ExistingMedicine | undefined => row as ExistingMedicine | undefined;
const asNumber = (info: { lastInsertRowid: number | bigint }) => Number(info.lastInsertRowid);

const selCompany = sqlite.prepare("SELECT id FROM companies WHERE slug = ?");
const insCompany = sqlite.prepare("INSERT INTO companies (name, slug) VALUES (?, ?)");
const selGeneric = sqlite.prepare("SELECT id FROM generics WHERE slug = ?");
const insGeneric = sqlite.prepare("INSERT INTO generics (name, slug, source_id) VALUES (?, ?, ?)");
const selCategory = sqlite.prepare("SELECT id FROM categories WHERE path = ?");
const selCategorySlug = sqlite.prepare("SELECT id FROM categories WHERE slug_path = ?");
const insCategory = sqlite.prepare(
  "INSERT INTO categories (name, slug, path, slug_path, depth, parent_id) VALUES (?, ?, ?, ?, ?, ?)",
);
const selMedicineById = sqlite.prepare("SELECT id, current_price FROM medicines WHERE source_id = ?");
const selMedicineSlug = sqlite.prepare("SELECT id FROM medicines WHERE slug = ?");
const insMedicine = sqlite.prepare(`
  INSERT INTO medicines (
    source_id, slug, brand_name, display_name, generic_id, company_id, category_id,
    form, strength_raw, strength_value, strength_unit, is_combo_strength,
    pack_type, pack_size, base_unit, base_count,
    current_price, currency, availability, price_valid_until, image_url, source_url, scraped_at
  ) VALUES (
    @sourceId, @slug, @brandName, @displayName, @genericId, @companyId, @categoryId,
    @form, @strengthRaw, @strengthValue, @strengthUnit, @isComboStrength,
    @packType, @packSize, @baseUnit, @baseCount,
    @currentPrice, @currency, @availability, @priceValidUntil, @imageUrl, @sourceUrl, @scrapedAt
  )
`);
const updMedicine = sqlite.prepare(`
  UPDATE medicines SET
    slug = @slug, brand_name = @brandName, display_name = @displayName,
    generic_id = @genericId, company_id = @companyId, category_id = @categoryId,
    form = @form, strength_raw = @strengthRaw, strength_value = @strengthValue,
    strength_unit = @strengthUnit, is_combo_strength = @isComboStrength,
    pack_type = @packType, pack_size = @packSize, base_unit = @baseUnit, base_count = @baseCount,
    current_price = @currentPrice, currency = @currency, availability = @availability,
    price_valid_until = @priceValidUntil, image_url = @imageUrl, source_url = @sourceUrl,
    scraped_at = @scrapedAt, updated_at = unixepoch()
  WHERE id = @id
`);
const insPrice = sqlite.prepare(`
  INSERT INTO price_history (medicine_id, price, currency, pack_type, pack_size, availability, source, captured_at)
  VALUES (?, ?, ?, ?, ?, ?, 'arogga', ?)
`);

function companyId(name: string | null | undefined): number | null {
  if (!name) return null;
  const slug = slugify(name) || `c-${name.length}`;
  const cached = companyIds.get(slug);
  if (cached !== undefined) return cached;
  const existing = asId(selCompany.get(slug));
  if (existing) {
    companyIds.set(slug, existing.id);
    return existing.id;
  }
  const id = asNumber(insCompany.run(name, slug));
  companyIds.set(slug, id);
  return id;
}

function genericId(name: string | null | undefined, sourceId: string | null | undefined): number | null {
  if (!name) return null;
  const slug = slugify(name) || `g-${sourceId ?? name.length}`;
  const cached = genericIds.get(slug);
  if (cached !== undefined) return cached;
  const existing = asId(selGeneric.get(slug));
  if (existing) {
    genericIds.set(slug, existing.id);
    return existing.id;
  }
  const id = asNumber(insGeneric.run(name, slug, sourceId ?? null));
  genericIds.set(slug, id);
  return id;
}

/** URL-safe trail, e.g. "gastrointestinal-system/chronic-inflammatory-disease". */
function slugPathFor(trail: string[], upto: number): string {
  return trail
    .slice(0, upto)
    .map((part) => slugify(String(part).trim()))
    .filter(Boolean)
    .join("/");
}

/** Materialises every level of the therapeutic trail so a branch can be listed by path prefix. */
function categoryIdFor(trail: string[] | null | undefined): number | null {
  if (!trail?.length) return null;
  let parent: number | null = null;
  let path = "";
  let last: number | null = null;
  for (let depth = 0; depth < trail.length; depth++) {
    const name = String(trail[depth]).trim();
    if (!name) continue;
    path = path ? `${path} > ${name}` : name;
    const cached = categoryIds.get(path);
    if (cached !== undefined) {
      parent = cached;
      last = cached;
      continue;
    }
    const existing = asId(selCategory.get(path));
    if (existing) {
      categoryIds.set(path, existing.id);
      parent = existing.id;
      last = existing.id;
      continue;
    }

    // The upstream taxonomy is not fully normalised - it contains both
    // "Beta Blockers" and "Beta-Blockers", which slugify identically - so the
    // unique index on slug_path can still bite. Disambiguate rather than drop
    // the branch.
    const base = slugPathFor(trail, depth + 1) || slugify(name);
    let slugPath = base;
    for (let n = 2; selCategorySlug.get(slugPath); n++) slugPath = `${base}-${n}`;

    const id = asNumber(insCategory.run(name, slugify(name), path, slugPath, depth + 1, parent));
    categoryIds.set(path, id);
    parent = id;
    last = id;
  }
  return last;
}

/* ------------------------------------------------------------ FTS search */

/**
 * Standalone (non external-content) FTS5 index kept in sync by triggers.
 * Deliberately stores its own copy of the text: it survives rebuilds and makes
 * weighted bm25 ranking straightforward.
 */
function ensureFts() {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS medicines_fts USING fts5(
      brand_name, generic_name, display_name, company_name, category,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS medicines_ai AFTER INSERT ON medicines BEGIN
      INSERT INTO medicines_fts(rowid, brand_name, generic_name, display_name, company_name, category)
      SELECT new.id, new.brand_name,
             COALESCE((SELECT g.name FROM generics g WHERE g.id = new.generic_id), ''),
             new.display_name,
             COALESCE((SELECT c.name FROM companies c WHERE c.id = new.company_id), ''),
             COALESCE((SELECT cat.name FROM categories cat WHERE cat.id = new.category_id), '');
    END;
    CREATE TRIGGER IF NOT EXISTS medicines_ad AFTER DELETE ON medicines BEGIN
      DELETE FROM medicines_fts WHERE rowid = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS medicines_au AFTER UPDATE ON medicines BEGIN
      DELETE FROM medicines_fts WHERE rowid = old.id;
      INSERT INTO medicines_fts(rowid, brand_name, generic_name, display_name, company_name, category)
      SELECT new.id, new.brand_name,
             COALESCE((SELECT g.name FROM generics g WHERE g.id = new.generic_id), ''),
             new.display_name,
             COALESCE((SELECT c.name FROM companies c WHERE c.id = new.company_id), ''),
             COALESCE((SELECT cat.name FROM categories cat WHERE cat.id = new.category_id), '');
    END;
  `);
}

function rebuildFts() {
  sqlite.exec("DELETE FROM medicines_fts");
  sqlite.exec(`
    INSERT INTO medicines_fts(rowid, brand_name, generic_name, display_name, company_name, category)
    SELECT m.id, m.brand_name,
           COALESCE((SELECT g.name FROM generics g WHERE g.id = m.generic_id), ''),
           m.display_name,
           COALESCE((SELECT c.name FROM companies c WHERE c.id = m.company_id), ''),
           COALESCE((SELECT cat.name FROM categories cat WHERE cat.id = m.category_id), '')
    FROM medicines m
  `);
}

/* ----------------------------------------------------------------- import */

/**
 * Source values arrive inconsistently cased ("tablet" vs "Tablet"). Filters and
 * alternative-matching compare these strings, so they have to be canonical.
 *
 * Note `packType` is deliberately allowed to be "Tablet"/"Capsule": the source
 * really does list some products as "Tablet × 1", i.e. sold as a loose single
 * unit rather than a strip. That is meaningful data, not a parse artefact.
 */
function normalisePackType(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "strip") return "Strip";
  if (lower === "box") return "Box";
  return value;
}

function uniqueSlug(base: string | null | undefined, sourceId: string): string {
  let slug = base || `med-${sourceId}`;
  if (usedMedicineSlugs.has(slug) || selMedicineSlug.get(slug)) slug = `${slug}-${sourceId}`;
  usedMedicineSlugs.add(slug);
  return slug;
}

/** One crawled record as written by scripts/03-product-pages.mjs. */
type CrawledMedicine = {
  sourceId?: string | number | null;
  sourceUrl?: string | null;
  displayName?: string | null;
  brandName?: string | null;
  genericName?: string | null;
  genericSourceId?: string | null;
  companyName?: string | null;
  form?: string | null;
  strength?: string | null;
  packType?: string | null;
  packSize?: number | null;
  baseUnit?: string | null;
  baseCount?: number | null;
  price?: number | null;
  currency?: string | null;
  availability?: string | null;
  priceValidUntil?: string | null;
  image?: string | null;
  categoryTrail?: string[] | null;
};

async function main() {
  if (!existsSync(PRODUCTS)) {
    console.error(`✗ ${PRODUCTS} not found — run scripts/03-product-pages.mjs first`);
    process.exit(1);
  }

  for (const row of sqlite
    .prepare("SELECT source_id, slug FROM medicines")
    .all() as { source_id: string; slug: string }[]) {
    usedMedicineSlugs.add(row.slug);
    storedSlugBySource.set(row.source_id, row.slug);
  }

  ensureFts();

  const runInfo = sqlite
    .prepare("INSERT INTO scrape_runs (kind, status, started_at) VALUES ('import', 'running', unixepoch())")
    .run();
  const runId = Number(runInfo.lastInsertRowid);

  let read = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let priceChanges = 0;

  const applyRow = sqlite.transaction((r: CrawledMedicine) => {
    const strength = parseStrength(r.strength);
    const form = normaliseForm(r.form) ?? r.form ?? "Tablet";

    const params = {
      sourceId: String(r.sourceId),
      slug: "",
      /** Only set on update; the UPDATE statement keys off it. */
      id: 0,
      brandName: r.brandName ?? r.displayName ?? "Unknown",
      displayName: r.displayName ?? r.brandName ?? "Unknown",
      genericId: genericId(r.genericName, r.genericSourceId),
      companyId: companyId(r.companyName),
      categoryId: categoryIdFor(r.categoryTrail),
      form,
      strengthRaw: r.strength ?? "",
      strengthValue: strength.value,
      strengthUnit: strength.unit,
      isComboStrength: strength.isCombo ? 1 : 0,
      packType: normalisePackType(r.packType),
      packSize: Number.isFinite(r.packSize) ? r.packSize : null,
      baseUnit: r.baseUnit ?? null,
      baseCount: Number.isFinite(r.baseCount) ? r.baseCount : null,
      // The source publishes 0 for products it no longer stocks. Keeping that
      // value would render as "৳0", which reads as free rather than unknown.
      currentPrice: Number.isFinite(r.price) && (r.price as number) > 0 ? r.price : null,
      currency: r.currency ?? "BDT",
      availability: r.availability ?? "in_stock",
      priceValidUntil: r.priceValidUntil ?? null,
      imageUrl: r.image ?? null,
      sourceUrl: r.sourceUrl ?? `https://www.arogga.com/product/${r.sourceId}`,
      scrapedAt: Math.floor(Date.now() / 1000),
    };

    const existing = asMedicine(selMedicineById.get(params.sourceId));

    if (existing) {
      params.id = existing.id;
      // Keep the slug the site already published so URLs stay stable; only mint
      // a new one if the row somehow lost it.
      params.slug =
        storedSlugBySource.get(params.sourceId) ??
        uniqueSlug(slugify(params.brandName) || `med-${params.sourceId}`, params.sourceId);
      updMedicine.run(params);
      updated++;
      // History should record real movements, not every re-crawl.
      if (!sameNumber(existing.current_price, params.currentPrice)) {
        insPrice.run(
          existing.id, params.currentPrice, params.currency, params.packType,
          params.packSize, params.availability, params.scrapedAt,
        );
        priceChanges++;
      }
    } else {
      params.slug = uniqueSlug(slugify(params.brandName) || `med-${params.sourceId}`, params.sourceId);
      const medicineId = asNumber(insMedicine.run(params));
      inserted++;
      if (params.currentPrice !== null) {
        insPrice.run(
          medicineId, params.currentPrice, params.currency, params.packType,
          params.packSize, params.availability, params.scrapedAt,
        );
      }
    }
  });

  const sameNumber = (a: number | null | undefined, b: number | null | undefined): boolean => {
    const an = a === null || a === undefined ? null : Number(a);
    const bn = b === null || b === undefined ? null : Number(b);
    if (an === null && bn === null) return true;
    if (an === null || bn === null) return false;
    return Math.abs(an - bn) < 1e-9;
  };

  const rl = createInterface({ input: createReadStream(PRODUCTS), crlfDelay: Infinity });
  const pending: CrawledMedicine[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    read++;
    let row: CrawledMedicine;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (!row?.sourceId || !row.brandName) {
      skipped++;
      continue;
    }
    pending.push(row);
    if (pending.length >= 500) {
      sqlite.transaction(() => pending.forEach(applyRow))();
      pending.length = 0;
      process.stdout.write(`\r  imported ${read} rows — ${inserted} new, ${updated} updated   `);
    }
  }
  if (pending.length) sqlite.transaction(() => pending.forEach(applyRow))();

  process.stdout.write("\n");
  console.log(`✓ read ${read} rows — ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
  console.log(`  ${priceChanges} price changes recorded in history`);

  rebuildFts();

  sqlite
    .prepare("UPDATE scrape_runs SET status='done', finished_at=unixepoch(), items_processed=?, items_written=?, notes=? WHERE id=?")
    .run(read, inserted + updated, `new=${inserted} updated=${updated} priceChanges=${priceChanges}`, runId);

  const stats = sqlite
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM medicines)  AS medicines,
         (SELECT COUNT(*) FROM generics)   AS generics,
         (SELECT COUNT(*) FROM companies)  AS companies,
         (SELECT COUNT(*) FROM categories) AS categories`,
    )
    .get();
  console.log("✓ database now holds:", stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});