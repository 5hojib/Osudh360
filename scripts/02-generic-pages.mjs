// Step 2 - crawl every /generics/ page.
//
// Each generic page embeds a schema.org CollectionPage whose ItemList lists that
// generic's products with canonical URLs, manufacturer and price. That gives us
// an authoritative product -> generic mapping (and repairs the stale slugs in
// the sitemap).
//
// Output: data/generic-products.jsonl
//   { sourceId, sourceUrl, slug, displayName, companyName, price, currency,
//     availability, image, genericName, genericSlug, genericSourceId }

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPrefix, pool, jsonlWriter, loadSeenKeys, withRetry } from "./lib/http.mjs";
import { extractJsonLd, parseGenericPageItem, squeeze } from "./lib/parse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const OUT = resolve(DATA, "generic-products.jsonl");

const CONCURRENCY = 4;
const DELAY_MS = 220; // ~4.5 req/s ceiling against a single host
const PREFIX_BYTES = 40 * 1024;

async function crawlOne(generic) {
  let res = await withRetry(() => fetchPrefix(generic.url, { maxBytes: PREFIX_BYTES }));
  let blocks = res.ok ? extractJsonLd(res.text) : [];

  let collection = blocks.find((b) => b?.["@type"] === "CollectionPage");

  // Some pages push the ItemList further down; retry with the full document.
  if (!collection?.mainEntity?.itemListElement?.length) {
    res = await withRetry(() => fetchPrefix(generic.url, { maxBytes: 4 * 1024 * 1024 }));
    if (!res.ok) return { ok: false, id: generic.id, status: res.status };
    blocks = extractJsonLd(res.text);
    collection = blocks.find((b) => b?.["@type"] === "CollectionPage");
  }
  if (!collection?.mainEntity?.itemListElement?.length) return { ok: true, id: generic.id, items: 0 };

  const name = squeeze(collection.name);
  const items = collection.mainEntity.itemListElement
    .map((el) => parseGenericPageItem(el?.item, { genericName: name, genericSlug: generic.slug, genericId: generic.id }))
    .filter(Boolean);

  return { ok: true, id: generic.id, items: items.length, records: items };
}

async function main() {
  const generics = JSON.parse(await readFile(resolve(DATA, "generics.json"), "utf8"));
  console.log(`• ${generics.length} generic pages to crawl`);

  // Resume support: skip generics already fully recorded.
  const seen = await loadSeenKeys(OUT, (r) => r.genericSourceId);
  const todo = generics.filter((g) => !seen.has(String(g.id)));
  if (todo.length !== generics.length) console.log(`  resuming, ${generics.length - todo.length} already done`);

  const writer = jsonlWriter(OUT);
  let totalItems = 0;
  let failures = 0;

  await pool(
    todo,
    async (generic) => {
      const r = await crawlOne(generic);
      if (!r.ok) {
        failures++;
        return;
      }
      if (r.records?.length) {
        writer.write(r.records);
        totalItems += r.records.length;
      }
    },
    {
      concurrency: CONCURRENCY,
      delayMs: DELAY_MS,
      onProgress(done, total) {
        const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write(
          `\r  ${done}/${total} generics — ${totalItems} product rows, ${failures} failed (${rate}/s)   `,
        );
      },
    },
  );

  await writer.close();
  process.stdout.write("\n");
  console.log(`✓ wrote ${totalItems} product rows (${failures} page failures)`);
}

const t0 = Date.now();
main().catch((e) => {
  console.error(e);
  process.exit(1);
});