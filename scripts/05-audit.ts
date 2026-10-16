// Step 5 - data quality audit.
//
// Prints the kinds of problems that quietly ruin a medicine database: missing
// links, duplicate listings, implausible prices and names that failed to split
// cleanly into brand + generic. Read-only; it never mutates data.

import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = process.env.DATABASE_PATH ?? resolve(process.cwd(), "data", "osudh360.sqlite");
const db = new Database(DB_PATH);

const pct = (n: number, total: number) => (total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`);

const total = (db.prepare("SELECT COUNT(*) c FROM medicines").get() as { c: number }).c;
console.log(`\ntotal medicines: ${total}\n`);

const missing = db
  .prepare(
    `SELECT
       SUM(generic_id IS NULL)   AS noGeneric,
       SUM(company_id IS NULL)   AS noCompany,
       SUM(current_price IS NULL) AS noPrice,
       SUM(pack_size IS NULL)    AS noPackSize,
       SUM(strength_raw = '')    AS noStrength,
       SUM(category_id IS NULL)  AS noCategory,
       0 AS outOfStock
     FROM medicines`,
  )
  .get() as Record<string, number>;

console.log("completeness");
for (const [key, value] of Object.entries(missing)) {
  const label = key.replace(/([A-Z])/g, " $1").toLowerCase();
  console.log(`  ${label.padEnd(12)} ${String(value ?? 0).padStart(6)}  (${pct(value ?? 0, total)})`);
}

// The same brand at the same strength and pack size should only exist once.
const duplicates = db
  .prepare(
    `SELECT brand_name, strength_raw, company_id, pack_size, COUNT(*) c
     FROM medicines
     GROUP BY brand_name, strength_raw, company_id, pack_size
     HAVING c > 1
     ORDER BY c DESC
     LIMIT 10`,
  )
  .all() as { brand_name: string; strength_raw: string; c: number }[];

const dupCount = (
  db
    .prepare(
      `SELECT COUNT(*) c FROM (
         SELECT 1 FROM medicines
         GROUP BY brand_name, strength_raw, company_id, pack_size HAVING COUNT(*) > 1)`,
    )
    .get() as { c: number }
).c;

console.log(`\nduplicate (brand, strength, company, pack) groups: ${dupCount}`);
for (const row of duplicates) console.log(`  ${row.c}x  ${row.brand_name} ${row.strength_raw}`);

// A "brand" that is just the generic name means the name split failed.
const brandIsGeneric = (
  db
    .prepare(
      `SELECT COUNT(*) c FROM medicines m
       JOIN generics g ON g.id = m.generic_id
       WHERE LOWER(TRIM(m.brand_name)) = LOWER(TRIM(g.name))`,
    )
    .get() as { c: number }
).c;
console.log(`\nbrand name identical to generic name: ${brandIsGeneric}`);

const suspicious = db
  .prepare(
    `SELECT brand_name, current_price, pack_size FROM medicines
     WHERE current_price IS NOT NULL AND (current_price <= 0 OR current_price > 100000)
     LIMIT 10`,
  )
  .all() as { brand_name: string; current_price: number; pack_size: number | null }[];
const suspiciousCount = (
  db.prepare("SELECT COUNT(*) c FROM medicines WHERE current_price IS NOT NULL AND (current_price <= 0 OR current_price > 100000)").get() as {
    c: number;
  }
).c;
console.log(`\nimplausible prices: ${suspiciousCount}`);
for (const row of suspicious) console.log(`  ${row.brand_name} ৳${row.current_price} (pack ${row.pack_size ?? "?"})`);

// How many medicines actually get alternative suggestions.
const withAlternatives = (
  db
    .prepare(
      `SELECT COUNT(*) c FROM (
         SELECT a.id FROM medicines a
         WHERE a.generic_id IS NOT NULL AND a.strength_value IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM medicines b
             WHERE b.generic_id = a.generic_id
               AND b.form = a.form
               AND b.id != a.id
               AND b.strength_value = a.strength_value
               AND b.strength_unit IS a.strength_unit
           ))`,
    )
    .get() as { c: number }
).c;
console.log(`\nmedicines with >=1 true alternative: ${withAlternatives} (${pct(withAlternatives, total)})`);

const orphanCategories = (
  db
    .prepare("SELECT COUNT(*) c FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM medicines WHERE category_id IS NOT NULL)")
    .get() as { c: number }
).c;
console.log(`categories with no medicines: ${orphanCategories}`);

db.close();