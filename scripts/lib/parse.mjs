// Parses Arogga product pages into a normalised medicine record.
//
// Everything needed is inside the first ~20 KB of the page as a single
// schema.org `Product` JSON-LD block:
//
//   name              "Napa 500 Paracetamol  Tablet 500mg"
//   brand.name        "Beximco Pharmaceuticals Ltd."   (manufacturer)
//   offers.price      10.8  + priceCurrency BDT + availability
//   additionalProperty  Form / Strength / Base Unit / Sales Unit
//   isSimilarTo       Drug { name: "Paracetamol", @id: .../generics/1124/paracetamol }
//
// A sibling `BreadcrumbList` block supplies the therapeutic category path.
//
// Note: we never trust the URL slug. Arogga serves a 200 with *different*
// product data under stale slugs, so `sku` and `url` from the JSON-LD are the
// only trustworthy identity fields.

const ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(str) {
  return str.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

/** Pull every <script type="application/ld+json"> block and JSON-parse it leniently. */
export function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      try {
        out.push(JSON.parse(decodeEntities(raw)));
      } catch {
        /* unparseable block - ignore */
      }
    }
  }
  return out;
}

/**
 * "Sales Unit": "Strip × 10"  ->  { packType: "Strip", packSize: 10 }
 * "Base Unit":   "Tablet × 1" ->  { baseUnit: "Tablet", baseCount: 1 }
 * Tolerates the ASCII "x" variant and stray whitespace.
 */
function parseQuantity(raw) {
  if (!raw) return {};
  const normalised = raw.replace(/\s+/g, " ").trim();
  const m = normalised.match(/^(.+?)\s*[×xX]\s*(\d+(?:\.\d+)?)$/);
  if (!m) {
    const n = normalised.match(/(\d+(?:\.\d+)?)/);
    return n ? { packType: normalised.replace(/[\d\s.]+$/, "").trim(), packSize: Number(n[1]) } : { packType: normalised };
  }
  const packSize = Number(m[2]);
  const head = m[1].trim();
  return Number.isFinite(packSize) ? { packType: head, packSize } : { packType: head };
}

function propsMap(list) {
  const map = {};
  for (const p of list ?? []) {
    if (p && typeof p.name === "string") map[p.name.trim()] = String(p.value ?? "").trim();
  }
  return map;
}

export const squeeze = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Split the display name into brand + generic.
 *
 * Names follow `{brand} {generic} {form} {strength}`. We strip the known
 * form+strength suffix first, then peel the generic off the end.
 *
 * The "keep the whole remainder" fallback matters for products whose brand is
 * derived from the generic, e.g. name "Aceclofenac 100 Tablet 100mg" with
 * generic "Aceclofenac" - peeling the generic would leave the meaningless
 * "100", whereas the true brand is "Aceclofenac 100".
 */
export function splitBrandAndGeneric(name, { generic, form, strength }) {
  let rest = squeeze(name);
  const suffix = [form, strength].map(squeeze).filter(Boolean).join(" ");
  if (suffix && rest.toLowerCase().endsWith(suffix.toLowerCase())) {
    rest = rest.slice(0, rest.length - suffix.length).trim();
  }

  const g = squeeze(generic);
  if (g && rest.toLowerCase().endsWith(g.toLowerCase())) {
    const head = rest.slice(0, rest.length - g.length).trim();
    if (head) return { brandName: head, genericName: g };
  }
  return { brandName: rest || g, genericName: g || null };
}

/** Strip Arogga's slug noise to get a usable fallback name. */
function titleFromSlug(slug) {
  return squeeze(
    String(slug ?? "")
      .split("-")
      .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ")
      .replace(/\s+/g, " ")
  );
}

const AVAILABILITY = {
  InStock: "in_stock",
  OutOfStock: "out_of_stock",
  PreOrder: "pre_order",
  PreSale: "pre_order",
  BackOrder: "back_order",
  Discontinued: "discontinued",
  LimitedAvailability: "in_stock",
  SoldOut: "out_of_stock",
  OnlineOnly: "in_stock",
};

/**
 * Convert a fetched HTML page into a raw medicine record, or null when the page
 * carries no usable product data.
 */
export function parseProductPage(html, { requestedUrl } = {}) {
  if (!html) return null;
  const blocks = extractJsonLd(html);
  const product = blocks.find((b) => b && b["@type"] === "Product");
  if (!product) return null;

  const crumbs = blocks.find((b) => b && b["@type"] === "BreadcrumbList");
  const props = propsMap(product.additionalProperty);

  const genericRaw = product.isSimilarTo?.activeIngredient || product.isSimilarTo?.name || null;
  const genericName = squeeze(genericRaw);
  const genericIdUrl = product.isSimilarTo?.["@id"] || null;
  const genericIdMatch = genericIdUrl?.match(/\/generics\/(\d+)\/([\w-]+)/);
  const form = squeeze(props["Form"]);
  const strength = squeeze(props["Strength"]);

  const { brandName, genericName: genericOut } = splitBrandAndGeneric(product.name, {
    generic: genericName,
    form,
    strength,
  });

  const slugFromUrl = String(product.url || requestedUrl || "").split("/").filter(Boolean).pop() ?? null;
  const fallbackTitle = titleFromSlug(slugFromUrl);

  // "Medicine > Analgesic & Antipyretic > NSAIDs > Ace 500" -> drop Home,
  // Medicine and the trailing node, which names the product itself rather than
  // a therapeutic class. The breadcrumb uses the brand name ("Ace 500") while
  // the Product name is the full "Ace 500 Paracetamol Tablet 500mg" string, so
  // both have to be compared.
  const trail = (crumbs?.itemListElement ?? [])
    .map((i) => squeeze(i?.name))
    .filter(Boolean)
    .filter((n) => !/^home$/i.test(n))
    .filter((n) => !/^medicine$/i.test(n));

  const last = squeeze(trail[trail.length - 1] ?? "").toLowerCase();
  if (
    last &&
    (last === squeeze(product.name).toLowerCase() || last === squeeze(brandName).toLowerCase())
  ) {
    trail.pop();
  }

  const sales = parseQuantity(props["Sales Unit"]);
  const base = parseQuantity(props["Base Unit"]);

  const priceRaw = product.offers?.price;
  const price = priceRaw === undefined || priceRaw === null ? null : Number(priceRaw);
  const unitPriceRaw = product.offers?.pricePerUnit?.price ?? props["Unit Price"];

  return {
    sourceId: String(product.sku ?? "").trim() || null,
    sourceUrl: product.url ?? requestedUrl ?? null,
    slug: slugFromUrl,
    displayName: squeeze(product.name),
    brandName: brandName || fallbackTitle,
    genericName: genericOut || genericName || null,
    genericSlug: genericIdMatch?.[2] ?? null,
    genericSourceId: genericIdMatch?.[1] ?? null,
    companyName: squeeze(product.brand?.name) || null,
    form: form || null,
    strength: strength || null,
    baseUnit: base.packType ?? base.baseUnit ?? null,
    baseCount: base.packSize ?? base.baseCount ?? null,
    packType: sales.packType ?? null,
    packSize: sales.packSize ?? null,
    price: Number.isFinite(price) ? price : null,
    unitPrice: Number.isFinite(Number(unitPriceRaw)) ? Number(unitPriceRaw) : null,
    currency: product.offers?.priceCurrency ?? "BDT",
    availability:
      AVAILABILITY[String(product.offers?.availability ?? "").split("/").pop()] ?? null,
    priceValidUntil: product.offers?.priceValidUntil ?? null,
    image: product.image ?? null,
    categoryTrail: trail,
    category: trail.length ? trail[trail.length - 1] : null,
  };
}

/** Normalise a generic-page ItemList entry (used for the brand-level crawl). */
export function parseGenericPageItem(item, { genericName, genericSlug, genericId }) {
  if (!item || !item.url) return null;
  const p = item;
  return {
    sourceId: String(p.sku ?? "").trim() || null,
    sourceUrl: p.url,
    slug: String(p.url).split("/").filter(Boolean).pop() ?? null,
    displayName: squeeze(p.name),
    companyName: squeeze(p.brand?.name) || null,
    price: Number.isFinite(Number(p.offers?.price)) ? Number(p.offers.price) : null,
    currency: p.offers?.priceCurrency ?? "BDT",
    availability:
      AVAILABILITY[String(p.offers?.availability ?? "").split("/").pop()] ?? null,
    image: p.image ?? null,
    genericName: genericName ?? null,
    genericSlug: genericSlug ?? null,
    genericSourceId: genericId ?? null,
  };
}