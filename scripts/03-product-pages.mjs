// Step 3 - crawl product pages for full pack details.
//
// The sitemap lists every product URL; ground truth comes from each page's own
// JSON-LD (stale slugs are common, so a URL that says "tablet" can serve a
// syrup). Every dosage form is now kept - the catalogue is no longer limited to
// tablets and capsules - so a page is stored as long as it reports a form.
//
// Priority order (so an interrupted run still leaves the best data):
//   1. canonical URLs harvested from generic pages
//   2. remaining sitemap candidates
//
// Output: data/products.jsonl

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { fetchPrefix, pool, jsonlWriter, loadSeenKeys, withRetry } from "./lib/http.mjs";
import { parseProductPage } from "./lib/parse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const OUT = resolve(DATA, "products.jsonl");
const GENERIC_ROWS = resolve(DATA, "generic-products.jsonl");
const SITEMAP_CANDIDATES = resolve(DATA, "sitemap-products.json");

const CONCURRENCY = 4;
const DELAY_MS = 220; // ~4.5 req/s ceiling against a single host
const PREFIX_BYTES = 24 * 1024;

/** Read a JSONL file as a stream so a 100k-row file does not need to be resident. */
async function forEachJsonLine(path, onRow) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      onRow(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
}

async function buildQueue() {
  const canonical = new Map(); // url -> {url, priority}
  // data/generic-products.jsonl is line-delimited; data/sitemap-products.json is
  // a single pretty-printed array, so the two need different readers.
  await forEachJsonLine(GENERIC_ROWS, (r) => {
    if (!r.sourceUrl) return;
    canonical.set(`id:${r.sourceId}`, { url: r.sourceUrl, priority: 0 });
  });

  let sitemapRows = [];
  try {
    sitemapRows = JSON.parse(await readFile(SITEMAP_CANDIDATES, "utf8"));
  } catch {
    /* run without the sitemap supplement */
  }
  for (const r of sitemapRows) {
    if (!r?.url) continue;
    canonical.set(`url:${r.url}`, { url: r.url, priority: 1 });
  }

  const seenUrls = new Set();
  const queue = [];
  for (const item of canonical.values()) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    queue.push(item);
  }
  queue.sort((a, b) => a.priority - b.priority);
  return queue;
}

async function crawlOne(url) {
  const res = await withRetry(() => fetchPrefix(url, { maxBytes: PREFIX_BYTES }));
  if (!res.ok) return { ok: false, status: res.status };

  let record = parseProductPage(res.text, { requestedUrl: res.url });
  if (!record) {
    // JSON-LD may sit past the prefix on unusually large pages; retry in full.
    const full = await withRetry(() => fetchPrefix(res.url, { maxBytes: 4 * 1024 * 1024 }));
    if (!full.ok) return { ok: false, status: full.status };
    record = parseProductPage(full.text, { requestedUrl: full.url });
  }
  if (!record) return { ok: true, skipped: "no-jsonld" };

  if (!record.form) return { ok: true, skipped: "no-form" };
  if (!record.sourceId) return { ok: true, skipped: "no-id" };

  return { ok: true, record };
}

async function main() {
  const queue = await buildQueue();
  console.log(`• ${queue.length} unique product URLs to crawl`);

  // Resume: skip anything whose sourceId we have already stored.
  const seen = await loadSeenKeys(OUT, (r) => r.sourceId);
  const idFromUrl = (url) => url.match(/\/product\/(\d+)\//)?.[1];
  const todo = queue.filter((q) => !seen.has(String(idFromUrl(q.url))));
  if (seen.size) console.log(`  resuming — ${seen.size} already stored, ${todo.length} remaining`);

  const writer = jsonlWriter(OUT);
  let stored = 0;
  let noForm = 0;
  let notFound = 0;
  let other = 0;
  const t0 = Date.now();

  await pool(
    todo,
    async (item) => {
      const r = await crawlOne(item.url);
      if (!r.ok) {
        if (r.status === 404 || r.status === 410) notFound++;
        else other++;
        return;
      }
      if (r.record) {
        // The same product can be reached through more than one URL (sitemap vs
        // generic page), and the URL's id does not always equal the page's SKU.
        // Track what we actually wrote so a run never emits duplicate source ids.
        const key = String(r.record.sourceId);
        if (seen.has(key)) return;
        seen.add(key);
        writer.write([r.record]);
        stored++;
      } else if (r.skipped === "no-form") noForm++;
      else other++;
    },
    {
      concurrency: CONCURRENCY,
      delayMs: DELAY_MS,
      onProgress(done, total) {
        const rate = (done / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write(
          `\r  ${done}/${total} — stored ${stored}, no-form ${noForm}, 404 ${notFound}, other ${other} (${rate}/s)   `,
        );
      },
    },
  );

  await writer.close();
  process.stdout.write("\n");
  console.log(`✓ stored ${stored} medicines`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});