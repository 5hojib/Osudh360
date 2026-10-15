/**
 * Manufacturers a reader is likely to recognise, in rough order of standing.
 *
 * The alternatives list is sorted so a familiar brand surfaces first and an
 * unknown one last, rather than purely by price. The order follows the local
 * market: the large, widely-stocked Bangladeshi manufacturers first, then the
 * multinationals whose products are here in small numbers, then long-standing
 * mid-size firms. Unknown companies sort after every listed one.
 *
 * Mirrored in mobile/src/lib/companies.ts — the app bundles its own copy
 * because it cannot import from this package. Keep the two lists in step.
 */
export const WELL_KNOWN_COMPANIES = [
  "square-pharmaceuticals-plc",
  "incepta-pharmaceuticals-ltd",
  "beximco-pharmaceuticals-ltd",
  "renata-limited",
  "eskayef",
  "aci-limited",
  "opsonin-pharma-limited",
  "aristopharma-limited",
  "healthcare-pharmaceuticals-ltd",
  "the-acme-laboratories-ltd",
  "drug-international-ltd",
  "general-pharmaceuticals-ltd",
  "beacon-pharmaceuticals-plc",
  "popular-pharmaceuticals-ltd",
  "radiant-pharmaceuticals-ltd",
  "the-ibn-sina-pharmaceutical-ind-ltd",
  "unimed-unihealth-pharmaceuticals-ltd",
  "orion-pharma-ltd",
  "navana-pharmaceuticals-ltd",
  "ziska-pharmaceuticals-ltd",
  "albion-laboratories-ltd",
  "synovia-pharma-plc",
  "globe-pharmaceuticals-ltd",
  "biopharma-ltd",
  "nevian-lifescience-plc",
  "pacific-pharmaceuticals-ltd",
  "delta-pharma-limited",
  "nipro-jmi-pharma-limited",
  "jayson-pharmaceuticals-ltd",
  "apex-pharma-ltd",
  "glaxo-smithkline-pharmaceuticals-ltd",
  "novartis",
  "pfizer",
  "sandoz",
  "sanofi-aventis",
  "roche-bangladesh-pharmaceutical",
  "novo-nordisk",
  "eli-lilly",
  "abbott",
  "astrazeneca",
] as const;

/** Sort rank for a company slug; unknown (and null) sort after every listed one. */
export function companyRank(slug: string | null | undefined): number {
  const index = (WELL_KNOWN_COMPANIES as readonly string[]).indexOf(slug ?? "");
  return index === -1 ? WELL_KNOWN_COMPANIES.length : index;
}

/**
 * `CASE <column> WHEN 'slug' THEN 0 … ELSE <n> END` for use in an ORDER BY, so
 * the database sorts by the curated order without shipping the list as data.
 *
 * The slugs are compile-time literals, so the interpolation carries no
 * injection risk. The syntax is identical in Postgres and SQLite.
 */
export function companyRankSql(column: string): string {
  const whens = WELL_KNOWN_COMPANIES.map((slug, i) => `WHEN '${slug}' THEN ${i}`).join(" ");
  return `CASE ${column} ${whens} ELSE ${WELL_KNOWN_COMPANIES.length} END`;
}
