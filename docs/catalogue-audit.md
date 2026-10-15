# Catalogue audit

Read-only review of the `medicines` catalogue (Neon), produced with
`npm run db:audit` (`scripts/audit-catalogue.ts`). Numbers are as of the
curation pass that removed unpriced and generic-named rows.

## Current shape

| | |
|---|---|
| medicines | 23,994 |
| generics | 1,944 |
| companies | 434 |
| categories | 599 |
| price_history rows | 23,994 |

Form mix: Tablet 54.6%, Capsule 15.4%, Injection 8.7%, Suspension 4.9%,
Syrup 4.2%, Drops 4.0%, the rest ≤2% each.

Price: min ৳0.17, mean ৳505.59, max ৳287,850.

## What this pass changed

* Removed **313 rows** (24,307 → 23,994):
  * 196 with no usable price (source publishes 0 / nothing for delisted stock);
  * 120 whose trade name merely repeats the generic (`Omeprazole 20` under
    `Omeprazole`) — 3 rows were both.
* The same rules now run on every import (`scripts/lib/curation.ts`), and the
  importer prunes rows that predate the rules, so the table self-heals.
* Alternatives are now ordered well-known-manufacturer-first
  (`src/lib/companies.ts`), then by price.

## Findings

1. **364 medicines (1.5%) have no generic.** They cannot be grouped, have no
   alternatives, and never appear on a generic page. Examples: `Aro Bion`,
   `Bone Meal`, `Vimpat 50`, `Coxidan 100mg (Coenzyme Q10)`. Mostly the source
   page had no generic link.
2. **1,854 generic+form+strength groups hold a single product**, so the
   "alternatives" section is empty for them. Expected for niche drugs, but it
   means alternatives is blank often on less common generics.
3. **162 duplicate groups** — same company + brand family + form + strength +
   pack under different source ids (the same SKU reached via two crawl URLs).
4. **The 9 rows priced > ৳100,000 are legitimate**, not parse errors: they are
   oncology/specialty products (Zytiga ৳221,069, Jakavi ৳218,759, Perjeta,
   Pemro, …). Do not clamp them.
5. **All 448 rows priced under ৳1 are loose single units** (`pack_size = 1`), so
   they are correct as per-tablet prices, not corruption.
6. **Company concentration is high:** the top 10 manufacturers are ~35% of the
   catalogue (Incepta 1,367, Opsonin 1,145, Square 893, …).
7. **Offline search never matches the company name.** The server's
   `search_vector` includes `company_name`, but the app's SQLite search
   (`searchMedicines`) only looks at `brand` and `generic`. Searching a
   manufacturer ("Square") works online and not offline — a real inconsistency.

## Suggested improvements

### High impact

* **Repair or drop the 364 generics-less rows.** Best path is to recover the
  generic from the display name / category during the crawl; failing that,
  exclude them so they stop diluting search results.
* **Deduplicate the 162 same-SKU groups** in the importer (keep the newest
  crawl, drop the rest) — right now the same product shows twice.
* **Re-run the import on the finished crawl.** `data/products.jsonl` now holds
  ~26,686 curated unique products versus 23,994 in the database, i.e. about
  +2,700 medicines that were crawled but never imported.

### Medium impact

* **Make offline search match the server**: add `company` to the OR terms in
  `searchMedicines` (the `idx_med_company` index already exists).
* **Bangla / synonym search.** Users type brand names in Bangla or misspell
  them ("Napa"/"নাপা"); a small alias table would widen recall.
* **Surface the price history.** `price_history` already records every move but
  no screen shows a trend — a sparkline on the medicine page is nearly free.
* **Badge the alternatives list.** Now that well-known makers sort first, a
  subtle "জনপ্রিয়" tag on those rows would explain the ordering.

### Lower impact

* **Company pages**: browse everything from one manufacturer (the `/companies`
  endpoint and counts already exist).
* **Strength-agnostic fallback**: when an exact strength has no alternative,
  fall back to the same generic at other strengths (the "other strengths"
  section partly covers this).
* **Cache images** locally so the catalogue is fully offline, not just text.
* **Prescription/OTC flag** if the source exposes it — useful for a medicine
  finder and cheap to carry through the sync payload.
