// Catalogue data-quality audit.
//
//   node --env-file=.env.local --experimental-strip-types scripts/audit-catalogue.ts
//
// Read-only. Reports the coverage and cleanliness problems that affect what a
// user sees: missing prices, brands that merely repeat the generic name, rows
// with no generic/company, duplicate SKUs, thin alternative sets, and the
// company concentration that drives the "well-known manufacturer" ordering.

import { createPgClient, migrationUrl } from "./lib/pg-client.ts";

const client = createPgClient(migrationUrl());
await client.connect();

const num = async (sql: string, params: unknown[] = []) => {
  const r = await client.query<{ n: string }>(sql, params);
  return Number(r.rows[0]?.n ?? 0);
};

const section = (title: string) => console.log(`\n${title}`);
const line = (label: string, value: unknown, note = "") =>
  console.log(`  ${label.padEnd(46)} ${String(value).padStart(7)}  ${note}`);

const total = await num(`SELECT count(*) AS n FROM medicines`);

section("Totals");
line("medicines", total);
line("generics", await num(`SELECT count(*) AS n FROM generics`));
line("companies", await num(`SELECT count(*) AS n FROM companies`));
line("categories", await num(`SELECT count(*) AS n FROM categories`));
line("price_history rows", await num(`SELECT count(*) AS n FROM price_history`));

section("Missing data (candidate removals)");
const noPrice = await num(`SELECT count(*) AS n FROM medicines WHERE current_price IS NULL`);
const brandEqGeneric = await num(
  `SELECT count(*) AS n FROM medicines
   WHERE generic_name IS NOT NULL
     AND regexp_replace(lower(brand_name), '[^a-z0-9]+', '', 'g')
       = regexp_replace(lower(generic_name), '[^a-z0-9]+', '', 'g')`,
);
const brandBaseEqGeneric = await num(
  `SELECT count(*) AS n FROM medicines
   WHERE generic_name IS NOT NULL AND brand_base IS NOT NULL
     AND regexp_replace(lower(brand_base), '[^a-z0-9]+', '', 'g')
       = regexp_replace(lower(generic_name), '[^a-z0-9]+', '', 'g')`,
);
line("no price", noPrice, `${((noPrice / total) * 100).toFixed(1)}% of catalogue`);
line("brand_name == generic_name", brandEqGeneric);
line("brand_base == generic_name", brandBaseEqGeneric, "includes the above");
line("no generic_id", await num(`SELECT count(*) AS n FROM medicines WHERE generic_id IS NULL`));
line("no company_id", await num(`SELECT count(*) AS n FROM medicines WHERE company_id IS NULL`));
line("no image", await num(`SELECT count(*) AS n FROM medicines WHERE image_url IS NULL`));

section("Alternatives health");
line(
  "medicines with >= 1 alternative",
  await num(
    `SELECT count(*) AS n FROM medicines m
     WHERE EXISTS (
       SELECT 1 FROM medicines a
       WHERE a.generic_id = m.generic_id
         AND a.id <> m.id
         AND a.form = m.form
         AND a.strength_value IS NOT DISTINCT FROM m.strength_value
         AND a.strength_unit IS NOT DISTINCT FROM m.strength_unit)`,
  ),
);
line(
  "generic+form+strength groups with 1 product",
  await num(
    `SELECT count(*) AS n FROM (
       SELECT generic_id, form, strength_value, strength_unit
       FROM medicines GROUP BY 1,2,3,4 HAVING count(*) = 1) g`,
  ),
);

section("Duplicates");
line(
  "same company+brand_base+form+strength+pack (distinct source ids)",
  await num(
    `SELECT count(*) AS n FROM (
       SELECT company_id, brand_base, form, strength_value, strength_unit, pack_type, pack_size, count(*) c
       FROM medicines GROUP BY 1,2,3,4,5,6,7 HAVING count(*) > 1) d`,
  ),
);

section("Dosage-form mix (top 15)");
const forms = await client.query<{ form: string; n: string }>(
  `SELECT form, count(*) AS n FROM medicines GROUP BY form ORDER BY count(*) DESC LIMIT 15`,
);
for (const f of forms.rows) line(f.form, f.n, `${((Number(f.n) / total) * 100).toFixed(1)}%`);

section("Top companies by product count (top 25)");
const companies = await client.query<{ name: string; slug: string; n: string }>(
  `SELECT coalesce(company_name, '(none)') AS name, coalesce(company_slug, '-') AS slug, count(*) AS n
   FROM medicines GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 25`,
);
for (const c of companies.rows) line(`${c.name} [${c.slug}]`, c.n);

section("Price sanity");
const price = await client.query<{ min: string | null; max: string | null; avg: string | null }>(
  `SELECT min(current_price)::text AS min, max(current_price)::text AS max, round(avg(current_price), 2)::text AS avg
   FROM medicines WHERE current_price IS NOT NULL`,
);
line("min / avg / max price (BDT)", `${price.rows[0]?.min} / ${price.rows[0]?.avg} / ${price.rows[0]?.max}`);
line(
  "priced > 100000 (possible parse errors)",
  await num(`SELECT count(*) AS n FROM medicines WHERE current_price > 100000`),
);
line(
  "priced < 1 (possible parse errors)",
  await num(`SELECT count(*) AS n FROM medicines WHERE current_price > 0 AND current_price < 1`),
);
line(
  "  of those, loose single units (pack_size = 1)",
  await num(`SELECT count(*) AS n FROM medicines WHERE current_price > 0 AND current_price < 1 AND pack_size = 1`),
);

section("Sample rows needing attention");
const orphaned = await client.query<{ brand_name: string; form: string }>(
  `SELECT brand_name, form FROM medicines WHERE generic_id IS NULL LIMIT 10`,
);
console.log("  no generic:");
for (const r of orphaned.rows) console.log(`    ${r.brand_name}  (${r.form})`);

const expensive = await client.query<{ brand_name: string; current_price: string; pack_type: string | null; pack_size: number | null }>(
  `SELECT brand_name, current_price, pack_type, pack_size FROM medicines
   WHERE current_price > 100000 ORDER BY current_price DESC LIMIT 10`,
);
console.log("  most expensive (suspect):");
for (const r of expensive.rows)
  console.log(`    ${r.brand_name}  ৳${r.current_price}  ${r.pack_type ?? "?"} × ${r.pack_size ?? "?"}`);

await client.end();
