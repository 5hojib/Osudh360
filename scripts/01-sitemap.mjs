// Step 1 - build the crawl universe.
//
// Sources:
//   * sitemap.xml  -> every /generics/{id}/{slug} page (2.6k) and every
//                     /product/... URL (~57k). Every product URL is kept now
//                     that the catalogue covers all dosage forms; the page's
//                     own JSON-LD is the ground truth for form and identity.
//   * /generics/ pages -> their embedded ItemList, which yields canonical
//                     product URLs (stale slugs are corrected by the source).
//
// Writes:
//   data/generics.json        [{ id, slug, url }]
//   data/sitemap-products.json { url, slug }

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText } from "./lib/http.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const BASE = "https://www.arogga.com";

async function main() {
  await mkdir(DATA, { recursive: true });

  console.log("• fetching sitemap index");
  const idx = await fetchText(`${BASE}/sitemap.xml`);
  if (!idx.ok) throw new Error(`sitemap index failed: ${idx.status} ${idx.error ?? ""}`);

  const chunks = [...idx.text.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => /sitemap\/\d+\.xml$/.test(u));
  console.log(`  ${chunks.length} sitemap chunks`);

  const genericUrls = new Map(); // id -> {id, slug, url}
  const productUrls = new Map(); // url -> {url, slug}

  let chunkNo = 0;
  for (const chunkUrl of chunks) {
    const res = await fetchText(chunkUrl);
    if (!res.ok) {
      console.warn(`  ! chunk ${chunkUrl} failed (${res.status})`);
      continue;
    }
    for (const m of res.text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const loc = m[1];
      const g = loc.match(/\/generics\/(\d+)\/([\w-]+)$/);
      if (g) {
        genericUrls.set(g[1], { id: g[1], slug: g[2], url: loc });
        continue;
      }
      const p = loc.match(/\/product\/(\d+)\/([\w-]+)$/);
      if (p) productUrls.set(loc, { url: loc, slug: p[2] });
    }
    process.stdout.write(`\r  chunk ${++chunkNo}/${chunks.length} — generics ${genericUrls.size}, candidate products ${productUrls.size}`);
  }
  process.stdout.write("\n");

  await writeFile(resolve(DATA, "generics.json"), JSON.stringify([...genericUrls.values()], null, 0));
  await writeFile(resolve(DATA, "sitemap-products.json"), JSON.stringify([...productUrls.values()], null, 0));

  console.log(`✓ generics: ${genericUrls.size}`);
  console.log(`✓ product candidates (all forms): ${productUrls.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});