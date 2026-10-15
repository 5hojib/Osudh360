/** Shared medicine-domain helpers used by both the importer and the UI. */

/**
 * Canonical dosage-form vocabulary. The catalogue covers every form the source
 * publishes (tablet, capsule, syrup, drops, injection, cream, ...), so this is
 * a documented set of buckets rather than a filter.
 */
export const KNOWN_FORMS = [
  "Tablet",
  "Capsule",
  "Softgel Capsule",
  "Vaginal Tablet",
  "Syrup",
  "Suspension",
  "Drops",
  "Injection",
  "Cream",
  "Ointment",
  "Gel",
  "Suppository",
  "Inhaler",
  "Powder",
  "Lotion",
  "Shampoo",
  "Solution",
  "Patch",
  "Spray",
  "Sachet",
  "Foam",
] as const;

/**
 * Canonicalise the source's inconsistent form strings ("tablet", "Tablets",
 * "Dispersible Tablet", "Capsule") onto a small controlled vocabulary used for
 * filtering and alternative matching. Unrecognised values are Title-Cased
 * rather than dropped, so no product silently disappears.
 */
export function normaliseForm(form: string | null | undefined): string | null {
  if (!form) return null;
  // The source sometimes ships forms slugified ("Nebuliser_solution",
  // "Iv_injection"); treat _ and - as word separators so they land in the
  // right bucket (and read cleanly when they fall through to Title Case).
  const f = String(form).trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!f) return null;
  const lower = f.toLowerCase();
  if (/\b(vaginal|pessar(?:y|ies))\b/.test(lower) && /tablets?/.test(lower)) return "Vaginal Tablet";
  if (/\bsoft\s?-?gel\b/.test(lower) || /\bsoftgel\b/.test(lower)) return "Softgel Capsule";
  if (/\bcapsules?\b/.test(lower)) return "Capsule";
  if (/\btablets?\b/.test(lower)) return "Tablet";
  if (/\bsyrups?\b/.test(lower)) return "Syrup";
  if (/\bsuspensions?\b/.test(lower)) return "Suspension";
  if (/\bdrops?\b/.test(lower)) return "Drops";
  if (/\binjections?\b/.test(lower)) return "Injection";
  if (/\bointments?\b/.test(lower)) return "Ointment";
  if (/\bcreams?\b/.test(lower)) return "Cream";
  if (/\bgels?\b/.test(lower)) return "Gel";
  if (/\bsuppositor(?:y|ies)\b/.test(lower)) return "Suppository";
  if (/\binhalers?\b/.test(lower)) return "Inhaler";
  if (/\bpowders?\b/.test(lower)) return "Powder";
  if (/\blotions?\b/.test(lower)) return "Lotion";
  if (/\bshampoos?\b/.test(lower)) return "Shampoo";
  if (/\bsolutions?\b/.test(lower)) return "Solution";
  if (/\bpatches?\b/.test(lower)) return "Patch";
  if (/\bsprays?\b/.test(lower)) return "Spray";
  if (/\bsachets?\b/.test(lower)) return "Sachet";
  if (/\bfoams?\b/.test(lower)) return "Foam";
  return f.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * True when a record carries a usable dosage form. Any recognised or
 * Title-caseable form is in scope now that the catalogue is no longer limited
 * to tablets and capsules; only a missing/blank form is rejected.
 */
export function isSupportedForm(form: string | null | undefined): boolean {
  return normaliseForm(form) !== null;
}

/**
 * Brand-family key used to collapse a product's strengths into one entry.
 *
 * Trade names often repeat the strength ("Seclo 20", "Napa 500"), which would
 * otherwise make every strength its own row. Peel a trailing numeric token only
 * when it matches the parsed strength, so a name that merely ends in a number
 * for another reason is left intact:
 *
 *   ("Seclo 20", "20mg")     -> "Seclo"
 *   ("Napa 500", "500mg")    -> "Napa"
 *   ("A Tetra 250", "250mg") -> "A Tetra"
 *   ("Bumecard", "5mg")      -> "Bumecard"
 *   ("Napa Extend", "665mg") -> "Napa Extend"
 */
export function brandBaseOf(
  brandName: string | null | undefined,
  strengthRaw: string | null | undefined,
): string {
  const brand = String(brandName ?? "").trim();
  const strength = String(strengthRaw ?? "").toLowerCase().replace(/\s+/g, "");
  if (!brand || !strength) return brand;

  const parts = strength.split("+");
  let base = brand;
  // Allow two tokens, e.g. "Napa 500 SR" -> "Napa" only if both match.
  for (let i = 0; i < 2; i++) {
    const m = base.match(/^(.*\S)\s+([0-9][0-9./]*)([a-z%µμ]*)$/i);
    if (!m) break;
    const num = m[2];
    const token = (num + (m[3] ?? "")).toLowerCase();
    const matches =
      strength === token ||
      strength.startsWith(token) ||
      parts.includes(token) ||
      parts.includes(num);
    if (!matches) break;
    base = m[1].trim();
  }
  return base;
}

/**
 * Case- and punctuation-insensitive key for comparing two printed names.
 *
 * "Omeprazole 20" and "omeprazole-20" collapse to the same key; "Co-Irbesartan"
 * and "Coirbesartan" do too. Only ASCII survives, which is deliberate: every
 * generic name in this catalogue is Latin, so a Bangla trade name normalises to
 * an empty key and never spuriously matches one.
 */
export function nameKey(input: string | null | undefined): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * True when a product's trade name is just its own generic name.
 *
 * These rows add nothing: a product literally called "Omeprazole" (or
 * "Omeprazole 20", whose brand family is "Omeprazole") reads as a duplicate of
 * the generic it sits under. The importer drops them and the API/prune reuse
 * the same rule.
 */
export function brandEchoesGeneric(
  brandName: string | null | undefined,
  strengthRaw: string | null | undefined,
  genericName: string | null | undefined,
): boolean {
  const generic = nameKey(genericName);
  if (!generic) return false;
  const base = brandBaseOf(brandName, strengthRaw) || String(brandName ?? "");
  return nameKey(base) === generic;
}

const UNIT_ALIASES: Record<string, string> = {
  mg: "mg",
  milligram: "mg",
  gm: "g",
  g: "g",
  gram: "g",
  gramme: "g",
  mcg: "mcg",
  ug: "mcg",
  "µg": "mcg",
  μg: "mcg",
  microgram: "mcg",
  kg: "kg",
  ml: "ml",
  millilitre: "ml",
  milliliter: "ml",
  l: "L",
  iu: "IU",
  "%": "%",
};

/**
 * Turn a printed strength into a comparable number + unit.
 *
 * "500mg"            -> { value: 500,    unit: "mg",  isCombo: false }
 * "80mg/ml"          -> { value: 80,     unit: "mg/ml", isCombo: false }
 * "12.5mg + 40mg"    -> { value: null,   unit: null,  isCombo: true }
 *
 * Combination strengths deliberately get a null numeric value: there is no
 * single correct number to sort or match on, so they are only ever compared
 * against other identical combination strings.
 */
export function parseStrength(raw: string | null | undefined): {
  value: number | null;
  unit: string | null;
  isCombo: boolean;
} {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null, unit: null, isCombo: false };

  const normalised = text.replace(/\s+/g, "");
  // A "+" or "/" separating two actives indicates a fixed-dose combination.
  const isCombo = /\+/.test(normalised) || /\d(?:mg|mcg|g|ml)[\d.]*(?:mcg|mg|g|ml)/i.test(text);
  if (isCombo) return { value: null, unit: null, isCombo: true };

  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zµμ%\/]+)?/);
  if (!m) return { value: null, unit: null, isCombo: false };

  const value = Number(m[1].replace(",", "."));
  const rawUnit = (m[2] ?? "").trim().toLowerCase();

  if (!Number.isFinite(value)) return { value: null, unit: null, isCombo: false };
  if (!rawUnit) return { value, unit: null, isCombo: false };

  // "mg/ml" style ratios keep both parts.
  if (rawUnit.includes("/")) {
    const [a, b] = rawUnit.split("/").map((p) => UNIT_ALIASES[p] ?? p);
    return { value, unit: `${a}/${b}`, isCombo: false };
  }

  return { value, unit: UNIT_ALIASES[rawUnit] ?? rawUnit, isCombo: false };
}

/** URL-safe slug. Transliteration is out of scope, so Bangla is dropped. */
export function slugify(input: string): string {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** `10.8` -> `৳10.80`; keeps one decimal only when it is meaningful. */
export function formatPrice(price: number | null | undefined, currency = "BDT"): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return "—";
  const symbol = currency === "BDT" ? "৳" : "";
  const rounded = Math.round(price * 100) / 100;
  const hasFraction = Math.abs(rounded % 1) > 0.001;
  return `${symbol}${rounded.toFixed(hasFraction ? 2 : 0)}`;
}

/**
 * Grouped integer counts.
 *
 * Deliberately Latin digits in every locale: drug names, strengths and prices
 * are all Latin on the packs, so mixing Bengali digits into those would make
 * them harder to match against what is printed.
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString("en-US");
}

/** Price for a single tablet/capsule, derived from the pack price and size. */
export function unitPriceOf(price: number | null | undefined, packSize: number | null | undefined): number | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  if (!packSize || packSize <= 0) return null;
  return Math.round((price / packSize) * 100) / 100;
}

export const AVAILABILITY_LABEL: Record<string, { bn: string; en: string }> = {
  in_stock: { bn: "স্টকে আছে", en: "In stock" },
  out_of_stock: { bn: "স্টকে নেই", en: "Out of stock" },
  pre_order: { bn: "প্রি-অর্ডার", en: "Pre-order" },
  back_order: { bn: "ব্যাক-অর্ডার", en: "Back-order" },
  discontinued: { bn: "বন্ধ হয়ে গেছে", en: "Discontinued" },
};

export function formatPack(packType: string | null | undefined, packSize: number | null | undefined): string {
  if (!packType && !packSize) return "—";
  if (packType && packSize) return `${packType} × ${packSize}`;
  return (packType ?? String(packSize)) as string;
}

/** Sort strength strings numerically when possible, alphabetically otherwise. */
export function compareStrength(a: { strengthValue: number | null }, b: { strengthValue: number | null }) {
  if (a.strengthValue !== null && b.strengthValue !== null) return a.strengthValue - b.strengthValue;
  if (a.strengthValue !== null) return -1;
  if (b.strengthValue !== null) return 1;
  return 0;
}