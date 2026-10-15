// Imports crawled JSONL into Neon (PostgreSQL).
//
//   node --env-file=.env.local --experimental-strip-types scripts/import-neon.ts
//
// Bulk loading is batched rather than row-by-row: every statement is a network
// round-trip to Neon's compute, so a per-row INSERT would take hours for ~15k
// medicines. Rows go in as multi-row upserts, and every lookup map is loaded
// once up front so the hot loop never issues a SELECT.
//
// Idempotent: re-running updates prices in place and only appends to
// price_history when a price actually changed.

import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { createPgClient, migrationUrl } from "./lib/pg-client.ts";
import { brandBaseOf, normaliseForm, parseStrength, slugify } from "../src/lib/medicine.ts";
import { DROP_WHERE, keepRow } from "./lib/curation.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const PRODUCTS = process.env.PRODUCTS_PATH ?? resolve(DATA, "products.jsonl");

const BATCH = 400;

/**
 * Canonicalises the pack description.
 *
 * The source is inconsistent: "Strip", "Strips", and even the typo "Stripi"
 * all appear, as do "Box", "50 Tablets" and "450ml Bottle". Since strip and box
 * size is a headline field, these are folded into a small controlled vocabulary
 * at import time rather than being shown raw.
 *
 * Returns the pack type and, when the size was only recoverable from the label
 * ("50 Tablets"), the corrected size.
 */
function normalisePack(rawType: string | null | undefined, rawSize: number | null | undefined): {
  packType: string | null;
  packSize: number | null;
} {
  const value = String(rawType ?? "").trim();
  const packSize: number | null = Number.isFinite(rawSize) ? (rawSize as number) : null;

  if (!value) return { packType: null, packSize };

  // "50 Tablets" / "3's Pack" -> the size comes from the label itself.
  const bare = value.replace(/^\d+\s*/, "").toLowerCase();
  const leadingCount = value.match(/^(\d+)\s*/);
  const size = leadingCount && packSize === 1 ? Number(leadingCount[1]) : packSize;

  if (/^strip/.test(bare) || bare === "stripi" || bare === "srtip") {
    return { packType: "Strip", packSize: size };
  }
  if (/^box/.test(bare)) return { packType: "Box", packSize: size };
  if (/^(tab|tabs|tablet|tablets)$/.test(bare)) return { packType: "Tablet", packSize: size };
  if (/^(capsul|capsule|capsules|softgel capsule|inhalation capsule)$/.test(bare)) {
    return { packType: "Capsule", packSize: size };
  }
  // Bottles, kits and vials are not a strip or box format we can express.
  if (/bottle|kit|pot|vial/.test(bare)) return { packType: null, packSize: size };

  return { packType: value, packSize: size };
}

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
  image?: string | null;
  categoryTrail?: string[] | null;
};

const companyIdBySlug = new Map<string, number>();
const genericIdBySlug = new Map<string, number>();
const categoryIdByPath = new Map<string, number>();
const categorySlugPathTaken = new Set<string>();
const categorySlugPathOwner = new Map<string, string>();
const existingPrice = new Map<string, number | null>();
const storedSlugBySource = new Map<string, string>();
const usedMedicineSlugs = new Set<string>();

const client = createPgClient(migrationUrl());
await client.connect();
console.log("→ connected to Neon");

// ---------------------------------------------------------------- caches

async function loadCaches() {
  for (const row of (
    await client.query<{ id: number; slug: string }>("SELECT id, slug FROM companies")
  ).rows) {
    companyIdBySlug.set(row.slug, row.id);
  }
  for (const row of (
    await client.query<{ id: number; slug: string }>("SELECT id, slug FROM generics")
  ).rows) {
    genericIdBySlug.set(row.slug, row.id);
  }
  for (const row of (
    await client.query<{ id: number; path: string; slug_path: string }>("SELECT id, path, slug_path FROM categories")
  ).rows) {
    categoryIdByPath.set(row.path, row.id);
    categorySlugPathTaken.add(row.slug_path);
    categorySlugPathOwner.set(row.slug_path, row.path);
  }
  for (const row of (
    await client.query<{ source_id: string; current_price: number | null; slug: string }>(
      "SELECT source_id, current_price, slug FROM medicines",
    )
  ).rows) {
    existingPrice.set(row.source_id, row.current_price === null ? null : Number(row.current_price));
    storedSlugBySource.set(row.source_id, row.slug);
    usedMedicineSlugs.add(row.slug);
  }
  console.log(
    `  cached ${companyIdBySlug.size} companies, ${genericIdBySlug.size} generics, ` +
      `${categoryIdByPath.size} categories, ${existingPrice.size} medicines`,
  );
}

/**
 * Inserts any missing values for one column and returns the placeholder
 * fragment to splice into the medicine INSERT.
 *
 * `ids` is a dense array aligned with the unique keys of this batch.
 */
async function resolveLookup(
  kind: "companies" | "generics" | "categories",
  cache: Map<string, number>,
  rows: { key: string; name: string; slug: string; path?: string; slugPath?: string; depth?: number; parentId?: number | null }[],
): Promise<string> {
  const missing = rows.filter((r) => !cache.has(r.key));
  if (missing.length > 0) {
    // One statement for the whole batch instead of N round-trips.
    const cols =
      kind === "categories"
        ? "(name, slug, path, slug_path, depth, parent_id)"
        : kind === "generics"
          ? "(name, slug, source_id)"
          : "(name, slug)";
    const placeholders = missing.map((_, i) => {
      const base = i * (kind === "categories" ? 6 : kind === "generics" ? 3 : 2);
      return kind === "categories"
        ? `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`
        : kind === "generics"
          ? `($${base + 1},$${base + 2},$${base + 3})`
          : `($${base + 1},$${base + 2})`;
    });
    const values = missing.flatMap((r) =>
      kind === "categories"
        ? [r.name, r.slug, r.path!, r.slugPath!, r.depth!, r.parentId ?? null]
        : kind === "generics"
          ? [r.name, r.slug, null]
          : [r.name, r.slug],
    );

    const conflict =
      kind === "categories"
        ? "ON CONFLICT (path) DO NOTHING"
        : kind === "generics"
          ? "ON CONFLICT (slug) DO NOTHING"
          : "ON CONFLICT (slug) DO NOTHING";

    await client.query(
      `INSERT INTO ${kind} ${cols} VALUES ${placeholders.join(",")} ${conflict}`,
      values,
    );

    // Re-read the rows we just inserted to pick up their generated ids.
    // Only the key column that actually exists on this table may be selected.
    const keyCol = kind === "categories" ? "path" : "slug";
    const keys = missing.map((r) => (kind === "categories" ? r.path! : r.slug));
    const { rows: fresh } = await client.query<{ id: number; slug: string | null; path: string | null }>(
      `SELECT id, ${kind === "categories" ? "path" : "slug"} FROM ${kind} WHERE ${keyCol} = ANY($1)`,
      [keys],
    );
    for (const r of fresh) cache.set(kind === "categories" ? r.path! : r.slug!, r.id);
  }
  return rows.map((r) => cache.get(r.key) ?? null).join(",");
}

async function flush(batch: CrawledMedicine[]) {
  // ---- resolve dimension tables in one pass each
  const companies = new Map<string, { key: string; name: string; slug: string }>();
  const generics = new Map<string, { key: string; name: string; slug: string }>();
  const categories = new Map<string, { key: string; name: string; slug: string; path: string; slugPath: string; depth: number; parentId: number | null }>();

  const params = batch.map((r) => {
    const companySlug = r.companyName ? slugify(r.companyName) : null;
    if (companySlug && r.companyName && !companies.has(companySlug)) {
      companies.set(companySlug, { key: companySlug, name: r.companyName, slug: companySlug });
    }
    const genericSlug = r.genericName ? slugify(r.genericName) : null;
    if (genericSlug && r.genericName && !generics.has(genericSlug)) {
      generics.set(genericSlug, { key: genericSlug, name: r.genericName, slug: genericSlug });
    }

    // Materialise every level of the therapeutic trail.
    let parentId: number | null = null;
    if (r.categoryTrail?.length) {
      let path = "";
      for (let i = 0; i < r.categoryTrail.length; i++) {
        const name = String(r.categoryTrail[i]).trim();
        if (!name) continue;
        path = path ? `${path} > ${name}` : name;
        if (!categories.has(path)) {
          // The upstream taxonomy is not fully normalised - it contains both
          // "Beta Blockers" and "Beta-Blockers", which slugify identically -
          // so the unique index on slug_path needs a disambiguating suffix.
          const base = path
            .split(" > ")
            .map((p) => slugify(p))
            .filter(Boolean)
            .join("/");
          let slugPath = base;
          // Only disambiguate when a *different* trail already owns this
          // slug; re-importing the same row must keep its original slug or
          // every URL would churn on every run.
          for (
            let n = 2;
            categorySlugPathTaken.has(slugPath) && categorySlugPathOwner.get(slugPath) !== path;
            n++
          ) {
            slugPath = `${base}-${n}`;
          }
          categorySlugPathTaken.add(slugPath);
          categorySlugPathOwner.set(slugPath, path);

          categories.set(path, {
            key: path,
            name,
            slug: slugify(name),
            path,
            slugPath,
            depth: i + 1,
            parentId,
          });
        }
        parentId = categoryIdByPath.get(path) ?? parentId;
      }
    }
    return { companySlug, genericSlug, parentId };
  });

  await resolveLookup("companies", companyIdBySlug, [...companies.values()]);
  await resolveLookup("generics", genericIdBySlug, [...generics.values()]);

  // Categories must be inserted parents-first so parent_id resolves.
  const orderedCategories = [...categories.values()].sort((a, b) => a.depth - b.depth);
  for (let i = 0; i < orderedCategories.length; i += 200) {
    const slice = orderedCategories.slice(i, i + 200);
    // Link parents that are already known.
    for (const c of slice) {
      const parentPath = c.path.split(" > ").slice(0, -1).join(" > ");
      const known = parentPath ? categoryIdByPath.get(parentPath) : null;
      if (known) c.parentId = known;
    }
    await resolveLookup("categories", categoryIdByPath, slice as never);
  }

  // ---- medicines
  const values: unknown[] = [];
  const tuples: string[] = [];
  const priceRows: unknown[] = [];
  let changed = 0;

  batch.forEach((r, i) => {
    const strength = parseStrength(r.strength);
    const form = normaliseForm(r.form) ?? r.form ?? "Tablet";
    const sourceId = String(r.sourceId);
    const meta = params[i];

    // Reuse the slug this product already publishes. Re-deriving it would
    // rename every URL on every re-import, because the slug set is seeded from
    // the database and would therefore always look "taken".
    const brandSlug = slugify(r.brandName ?? "") || `med-${sourceId}`;
    const existingSlug = storedSlugBySource.get(sourceId);
    let slug = existingSlug ?? brandSlug;
    if (!existingSlug) {
      // Genuinely new row: disambiguate if the brand slug is already in use.
      if (usedMedicineSlugs.has(slug)) slug = `${slug}-${sourceId}`;
      usedMedicineSlugs.add(slug);
    }

    // The source publishes 0 for products it no longer stocks. Keeping that
    // would display as "৳0", which reads as free rather than unknown.
    const price = Number.isFinite(r.price) && (r.price as number) > 0 ? r.price : null;

    const pack = normalisePack(r.packType ?? null, Number.isFinite(r.packSize) ? r.packSize : null);
    const packType = pack.packType;
    const packSize = pack.packSize;

    const genericId = meta.genericSlug ? (genericIdBySlug.get(meta.genericSlug) ?? null) : null;
    const companyId = meta.companySlug ? (companyIdBySlug.get(meta.companySlug) ?? null) : null;
    const categoryPath = r.categoryTrail?.filter(Boolean).join(" > ") ?? "";
    const categoryId = categoryPath ? (categoryIdByPath.get(categoryPath) ?? null) : null;

    const row: unknown[] = [
      sourceId,
      slug,
      r.brandName ?? r.displayName ?? "Unknown",
      r.displayName ?? r.brandName ?? "Unknown",
      // Trade name with a redundant strength suffix removed, so the app can
      // group one brand's mg variants into a single entry.
      brandBaseOf(r.brandName, r.strength) || r.brandName || r.displayName || "Unknown",
      genericId,
      companyId,
      categoryId,
      r.genericName ?? null,
      r.genericName ? slugify(r.genericName) : null,
      r.companyName ?? null,
      r.companyName ? slugify(r.companyName) : null,
      r.categoryTrail?.filter(Boolean).at(-1) ?? null,
      categoryPath ? categoryPath.split(" > ").map((p) => slugify(p)).filter(Boolean).join("/") : null,
      form,
      r.strength ?? "",
      strength.value,
      strength.unit,
      strength.isCombo,
      packType,
      packSize,
      r.baseUnit ?? null,
      Number.isFinite(r.baseCount) ? r.baseCount : null,
      price,
      r.currency ?? "BDT",
      r.image ?? null,
      r.sourceUrl ?? `https://www.arogga.com/product/${sourceId}`,
      new Date(),
    ];

    // Placeholders are derived from the row's real width, so adding a column
    // above can never silently desync from the placeholder count (which
    // Postgres reports only as "more target columns than expressions").
    const start = values.length + 1;
    const offset = row.map((_, n) => `$${start + n}`);
    tuples.push(`(${offset.join(",")})`);
    values.push(...row);

    // A new medicine gets a baseline history row so the price chart has a
    // starting point; that is not a "change". Only a pre-existing row whose
    // price actually moved counts, otherwise the first import would report
    // thousands of price moves that never happened.
    const previous = existingPrice.get(sourceId);
    const isNew = previous === undefined;
    if (isNew || previous !== (price ?? null)) {
      priceRows.push(
        sourceId,
        price,
        r.currency ?? "BDT",
        packType,
        packSize,
        new Date(),
      );
    }
    if (!isNew && previous !== (price ?? null)) changed++;
  });

  await client.query(
    `INSERT INTO medicines (
       source_id, slug, brand_name, display_name, brand_base, generic_id, company_id, category_id,
       generic_name, generic_slug, company_name, company_slug, category_name, category_slug_path,
       form, strength_raw, strength_value, strength_unit, is_combo_strength,
       pack_type, pack_size, base_unit, base_count,
       current_price, currency, image_url, source_url, scraped_at
     ) VALUES ${tuples.join(",")}
     ON CONFLICT (source_id) DO UPDATE SET
       slug = EXCLUDED.slug,
       brand_name = EXCLUDED.brand_name,
       display_name = EXCLUDED.display_name,
       brand_base = EXCLUDED.brand_base,
       generic_id = EXCLUDED.generic_id,
       company_id = EXCLUDED.company_id,
       category_id = EXCLUDED.category_id,
       generic_name = EXCLUDED.generic_name,
       generic_slug = EXCLUDED.generic_slug,
       company_name = EXCLUDED.company_name,
       company_slug = EXCLUDED.company_slug,
       category_name = EXCLUDED.category_name,
       category_slug_path = EXCLUDED.category_slug_path,
       form = EXCLUDED.form,
       strength_raw = EXCLUDED.strength_raw,
       strength_value = EXCLUDED.strength_value,
       strength_unit = EXCLUDED.strength_unit,
       is_combo_strength = EXCLUDED.is_combo_strength,
       pack_type = EXCLUDED.pack_type,
       pack_size = EXCLUDED.pack_size,
       base_unit = EXCLUDED.base_unit,
       base_count = EXCLUDED.base_count,
       current_price = EXCLUDED.current_price,
       currency = EXCLUDED.currency,
       image_url = EXCLUDED.image_url,
       source_url = EXCLUDED.source_url,
       scraped_at = EXCLUDED.scraped_at,
       updated_at = now()`,
    values,
  );

  if (priceRows.length > 0) {
    // Record only genuine price movements, against the rows just written.
    // The casts matter: an untyped parameter in a VALUES list is inferred as
    // text, which Postgres then refuses to compare against numeric, integer or
    // timestamptz columns.
    await client.query(
      `INSERT INTO price_history (medicine_id, price, currency, pack_type, pack_size, captured_at)
       SELECT m.id, v.price::numeric, v.currency, v.pack_type, v.pack_size::int, v.captured_at::timestamptz
       FROM (VALUES ${chunkTuples(priceRows, 6).join(",")}) AS v(source_id, price, currency, pack_type, pack_size, captured_at)
       JOIN medicines m ON m.source_id = v.source_id`,
      priceRows,
    );
  }

  return changed;
}

/** Splits a flat VALUES array into parameterised tuples of `width` columns. */
function chunkTuples(flat: unknown[], width: number) {
  const tuples: string[] = [];
  for (let i = 0; i < flat.length; i += width) {
    const s = i + 1;
    tuples.push(`(${Array.from({ length: width }, (_, n) => `$${s + n}`).join(",")})`);
  }
  return tuples;
}

if (!existsSync(PRODUCTS)) {
  console.error(`✗ ${PRODUCTS} not found — run scripts/03-product-pages.mjs first`);
  process.exit(1);
}

await loadCaches();

const runInfo = await client.query(
  `INSERT INTO scrape_runs (kind, status) VALUES ('import', 'running') RETURNING id`,
);
const runId = runInfo.rows[0].id as number;

let priceChanges = 0;
const t0 = Date.now();

const rl = createInterface({ input: createReadStream(PRODUCTS), crlfDelay: Infinity });

/**
 * Read every crawled row, ordered by source id.
 *
 * Slugs are assigned in processing order, so without a fixed order a partial
 * import and a full import would mint *different* slugs for the same products
 * (which would in turn republish URLs that search engines already know). The
 * whole file is small enough to sort in memory.
 */
const all: CrawledMedicine[] = [];
let dropped = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line) as CrawledMedicine;
    if (!row?.sourceId || !row?.brandName) continue;
    // Curation: no usable price, or a name that just repeats the generic.
    if (!keepRow(row)) {
      dropped++;
      continue;
    }
    all.push(row);
  } catch {
    /* skip malformed */
  }
}
if (dropped > 0) console.log(`  skipped ${dropped} row(s) failing curation (no price / generic-named)`);
all.sort((a, b) => Number(a.sourceId) - Number(b.sourceId));

// The expanded crawl can reach the same product (same SKU) through more than
// one URL — the sitemap and the generic pages disagree on the slug — so the
// file can hold duplicate source_ids. Postgres refuses an ON CONFLICT batch
// that touches the same row twice, and the later line is the freshly crawled
// one, so collapse to one entry per source id (last write wins).
const uniqueById = new Map<string, CrawledMedicine>();
for (const row of all) uniqueById.set(String(row.sourceId), row);

// Deduplicate the same SKU reached through different source ids. Two crawls
// can publish the same company + brand family + strength + form + pack under
// distinct source ids; without this they show up as duplicate rows.
const uniqueBySku = new Map<string, CrawledMedicine>();
for (const row of uniqueById.values()) {
  const key = [
    row.companyName ? slugify(row.companyName) : "",
    (brandBaseOf(row.brandName, row.strength) || row.brandName || "").toLowerCase(),
    normaliseForm(row.form) ?? "",
    (row.strength ?? "").trim().toLowerCase(),
    row.genericName ? slugify(row.genericName) : "",
    (row.packType ?? "").trim().toLowerCase(),
    String(row.packSize ?? ""),
  ].join("|");
  uniqueBySku.set(key, row);
}
const rowsToImport = [...uniqueBySku.values()];
const sourceDupes = all.length - uniqueById.size;
const skuDupes = uniqueById.size - uniqueBySku.size;
if (sourceDupes > 0) {
  console.log(`  collapsed ${sourceDupes} duplicate source id(s) (same SKU via multiple URLs)`);
}
if (skuDupes > 0) {
  console.log(`  collapsed ${skuDupes} cross-source SKU duplicate(s) (same company/brand/strength/pack)`);
}

for (let i = 0; i < rowsToImport.length; i += BATCH) {
  const batch = rowsToImport.slice(i, i + BATCH);
  priceChanges += await flush(batch);
  const read = Math.min(i + BATCH, rowsToImport.length);
  const rate = (read / ((Date.now() - t0) / 1000)).toFixed(0);
  process.stdout.write(`\r  ${read}/${rowsToImport.length} rows, ${priceChanges} price changes (${rate}/s)   `);
}

process.stdout.write("\n");
const read = rowsToImport.length;
console.log(`✓ imported ${read} rows, ${priceChanges} price changes recorded`);

// Upserting only adds and updates; rows that a *previous* import wrote and the
// current rules now exclude would otherwise linger forever. Clear them here so
// one import always converges the table on the current rules.
const importedSourceIds = rowsToImport.map((r) => String(r.sourceId));
const pruned = await client.query(`DELETE FROM medicines WHERE ${DROP_WHERE}`);
if ((pruned.rowCount ?? 0) > 0) {
  console.log(`✓ pruned ${pruned.rowCount} row(s) that fail the current curation rules`);
}
// Remove rows that a previous import wrote but this one no longer carries
// (retired duplicates across source ids), so the table converges on the
// current rules and dedup decisions rather than accumulating stale rows.
const retired = await client.query(
  `DELETE FROM medicines WHERE NOT (source_id = ANY($1::text[]))`,
  [importedSourceIds],
);
if ((retired.rowCount ?? 0) > 0) {
  console.log(`✓ retired ${retired.rowCount} row(s) superseded by this import`);
}

await client.query(
  `UPDATE scrape_runs SET status='done', finished_at=now(), items_processed=$2, items_written=$2, notes=$3 WHERE id=$1`,
  [runId, read, `priceChanges=${priceChanges}`],
);

const stats = (
  await client.query<{
    medicines: number;
    generics: number;
    companies: number;
    categories: number;
  }>(`SELECT
        (SELECT COUNT(*) FROM medicines)  AS medicines,
        (SELECT COUNT(*) FROM generics)   AS generics,
        (SELECT COUNT(*) FROM companies)  AS companies,
        (SELECT COUNT(*) FROM categories) AS categories`)
).rows[0];

console.log("✓ Neon now holds:", stats);
await client.end();