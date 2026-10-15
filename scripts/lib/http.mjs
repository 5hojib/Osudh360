// Polite HTTP helpers shared by the scraper scripts.
//
// Two behaviours matter here:
//  1. Early stream abort. Arogga product pages are ~690 KB, but every field we
//     need (schema.org Product JSON-LD, including `isSimilarTo` for the generic)
//     lives inside the first ~20 KB. Reading only that much and destroying the
//     stream cuts bandwidth by ~97% and spares the origin server.
//  2. Resumability. Long crawls must survive restarts, so every write is
//     appended to JSONL and completed work is skipped on the next run.

import { createWriteStream } from "node:fs";

export const UA =
  "Osudh360Bot/1.0 (+https://github.com/5hojib/Osudh360; medicine price index; contact via repo)";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch a URL, reading at most `maxBytes` of the response body and then
 * aborting the connection. Returns `null` for any failure so callers can treat
 * network errors and dead pages identically.
 */
export async function fetchPrefix(url, { maxBytes = 24 * 1024, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!res.ok) {
      // Drain politely so the connection can be reused/closed cleanly.
      if (res.body) await res.body.cancel().catch(() => {});
      return { ok: false, status: res.status, url: res.url, text: null };
    }

    if (!res.body) return { ok: false, status: res.status, url: res.url, text: null };

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    try {
      while (received < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
        }
      }
    } finally {
      // Stop downloading the remaining ~670 KB and release the socket.
      await reader.cancel().catch(() => {});
    }

    return {
      ok: true,
      status: res.status,
      url: res.url,
      text: new TextDecoder("utf-8").decode(Buffer.concat(chunks)),
      truncated: received >= maxBytes,
      bytesRead: received,
    };
  } catch (err) {
    return { ok: false, status: 0, url, text: null, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** GET a whole (small) text body, e.g. an XML sitemap. */
export async function fetchText(url, { timeoutMs = 45_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml,text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, text: null };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: null, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Claim a slot on a shared, strictly-ordered schedule.
 *
 * Reading `lastStart` and sleeping was racy: every worker could read the same
 * stale value, sleep for the same interval and then fire simultaneously, which
 * turned a 120 ms gap into a burst of `concurrency` requests. Assigning the
 * slot and bumping the cursor has to happen without an intervening `await` so
 * it stays atomic on the single JS thread — that yields a true global ceiling
 * of one request per `delayMs`.
 */
function createStartGate(delayMs) {
  let nextSlot = 0;
  return async function waitForSlot() {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + delayMs;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };
}

/**
 * Run `worker` over `items` with bounded concurrency and a minimum gap between
 * request starts, so we stay a well-behaved client rather than a load test.
 */
export async function pool(items, worker, { concurrency = 6, delayMs = 120, onProgress } = {}) {
  const results = [];
  let cursor = 0;
  let done = 0;
  const waitForSlot = createStartGate(delayMs);

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await waitForSlot();
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { __error: String(err?.message ?? err) };
      }
      done++;
      if (onProgress && (done % 100 === 0 || done === items.length)) onProgress(done, items.length);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Retry wrapper for transient failures: network resets, 429s and 5xx.
 * Permanent failures (404/410) are returned immediately without burning retries.
 */
export async function withRetry(fn, { attempts = 4, baseDelayMs = 1200 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await fn(attempt);
    if (last?.ok) return last;
    const permanent = last?.status === 404 || last?.status === 410;
    if (permanent || attempt === attempts) return last;
    // Exponential backoff with jitter so retries do not re-synchronise.
    const backoff = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 400;
    await sleep(backoff);
  }
  return last;
}

/** Read an existing JSONL file and return the set of keys already stored. */
export async function loadSeenKeys(path, keyFn) {
  const { readFile } = await import("node:fs/promises");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return new Set();
  }
  const seen = new Set();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const k = keyFn(obj);
      if (k !== undefined && k !== null) seen.add(String(k));
    } catch {
      /* skip malformed line */
    }
  }
  return seen;
}

/** Append many records to a JSONL file. */
export function jsonlWriter(path) {
  const stream = createWriteStream(path, { flags: "a" });
  return {
    write(records) {
      if (!records.length) return;
      stream.write(records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    },
    async close() {
      await new Promise((resolve) => stream.end(resolve));
    },
  };
}