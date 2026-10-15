// Catalogue curation rules, shared by the importer and the prune script.
//
// Two kinds of row are kept out of the catalogue:
//
//   1. No usable price. The source publishes 0 (and sometimes nothing) for a
//      product it no longer stocks; showing it as "৳0" reads as free rather
//      than unknown, and it drags every price sort to the top.
//   2. A trade name that just repeats the generic name ("Omeprazole 20" under
//      generic "Omeprazole"). It looks like a duplicate of the generic and
//      crowds out the branded alternatives.
//
// `keepRow` decides in memory while the crawler's JSONL is read; `DROP_WHERE`
// is the identical rule expressed in SQL, used to clear rows that predate the
// rule and keep the table self-healing on every import. The two must agree.

import { brandEchoesGeneric } from "../../src/lib/medicine.ts";

export type Curatable = {
  price?: unknown;
  brandName?: string | null;
  displayName?: string | null;
  strength?: string | null;
  genericName?: string | null;
};

/** True when a crawled product belongs in the catalogue. */
export function keepRow(row: Curatable): boolean {
  const price = typeof row.price === "number" ? row.price : Number(row.price);
  if (!Number.isFinite(price) || price <= 0) return false;

  const brand = row.brandName ?? row.displayName;
  if (!brand) return false;

  return !brandEchoesGeneric(brand, row.strength ?? null, row.genericName ?? null);
}

/**
 * SQL mirror of the reverse of `keepRow`, for `DELETE FROM medicines WHERE …`.
 *
 * `brand_base` is the strength-stripped trade name the importer already stores,
 * so the comparison here matches `brandBaseOf()` exactly. The regexp strips
 * everything but ASCII alphanumerics, matching `nameKey`.
 */
export const DROP_WHERE = `
  current_price IS NULL
  OR (generic_name IS NOT NULL
      AND regexp_replace(lower(coalesce(brand_base, brand_name)), '[^a-z0-9]+', '', 'g')
        = regexp_replace(lower(generic_name), '[^a-z0-9]+', '', 'g'))
`;
