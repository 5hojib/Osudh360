import { api, type Medicine } from "./api";
import {
  CATALOGUE_RULES_KEY,
  CATALOGUE_RULES_VERSION,
  countMedicines,
  countWithBrandBase,
  getMeta,
  replaceCatalogue,
  setMeta,
  upsertCatalogue,
} from "./db";

/**
 * Catalogue synchronisation.
 *
 * A refresh is two steps: a cheap `GET /` that reports the catalogue's
 * `lastUpdated`, and only if that disagrees with what we already hold do we
 * pull rows. So refreshing with no upstream change costs one small request
 * instead of a `/sync` round trip.
 *
 * First launch pulls the whole catalogue (roughly 2 MB) so every screen works
 * offline from then on. Later launches ask only for rows changed since the last
 * sync.
 *
 * The watermark is the server's own `updated_at`, never the device clock: a
 * phone whose clock runs behind the server would otherwise skip rows. The
 * watermark is written *after* the rows are committed, so an interrupted sync
 * re-fetches those rows rather than silently skipping them.
 */

const SYNC_KEY = "lastSyncAt";

export type SyncState = {
  status: "idle" | "syncing" | "error";
  count: number;
  lastSyncAt: string | null;
  /** True when the check found nothing new and no rows were pulled. */
  upToDate?: boolean;
  error?: string;
};

export async function syncCatalogue(
  onProgress?: (done: number) => void,
): Promise<SyncState> {
  const existing = await countMedicines();
  const withBrandBase = await countWithBrandBase();
  const storedVersion = await getMeta(SYNC_KEY);
  const storedRules = await getMeta(CATALOGUE_RULES_KEY);

  // A cache from a build before `brand_base` existed holds rows but no brand
  // families. Resync in full once so the grouped view is populated; otherwise
  // an incremental sync would never touch the unchanged rows.
  //
  // A changed rules version means rows the cache still holds were dropped
  // upstream (no price, or a name that repeats the generic). `/sync` only
  // reports rows that changed, so those stale copies would never be deleted by
  // an incremental pull — force one full replacement instead.
  const rulesChanged = storedRules !== CATALOGUE_RULES_VERSION;
  const isFirstSync = existing === 0 || withBrandBase === 0 || rulesChanged;
  const rows: Medicine[] = [];

  try {
    // Cheap version check first: one small request that tells us whether a pull
    // is needed at all.
    const stats = await api.stats();
    const serverVersion = stats.lastUpdated;

    if (!isFirstSync && serverVersion && storedVersion && serverVersion === storedVersion) {
      // Nothing changed upstream. Leave every row exactly where it is.
      return { status: "idle", count: existing, lastSyncAt: storedVersion, upToDate: true };
    }

    if (isFirstSync) {
      // Page by a stable id cursor. Using offset or a timestamp here would
      // re-serve the same page and loop forever.
      let after: number | null = null;
      for (;;) {
        const page = await api.sync({ after, limit: 5000 });
        rows.push(...page.items);
        onProgress?.(rows.length);
        if (!page.hasMore || page.items.length === 0) break;
        after = page.cursor ?? after;
      }
      await replaceCatalogue(rows);
    } else {
      // Incremental: only what changed since the last successful sync. The
      // server applies `since` and `after` together, so a change set larger
      // than one page is paged rather than silently truncated.
      let after: number | null = null;
      for (;;) {
        const page = await api.sync({ since: storedVersion, after, limit: 20000 });
        rows.push(...page.items);
        onProgress?.(rows.length);
        if (!page.hasMore || page.items.length === 0) break;
        after = page.cursor ?? after;
      }
      if (rows.length > 0) await upsertCatalogue(rows);
    }

    // The server's catalogue version is the correct watermark: the next
    // incremental sync asks for rows strictly newer than it. The rules version
    // is written alongside it so a later bump is detected on the next launch.
    const stamp = serverVersion ?? new Date().toISOString();
    await setMeta(SYNC_KEY, stamp);
    await setMeta(CATALOGUE_RULES_KEY, CATALOGUE_RULES_VERSION);

    // `count` is the size of the *local catalogue*, not the number of rows this
    // sync happened to fetch. Screens gate on `count > 0` to decide whether the
    // cache is usable offline, so an incremental sync that downloads nothing
    // must still report the real total - otherwise a no-op refresh would look
    // like an empty catalogue and hide data we already have.
    const total = await countMedicines();
    return { status: "idle", count: total, lastSyncAt: stamp };
  } catch (error) {
    // A failed refresh must not wipe the cached catalogue. Keep the count we
    // already had so every screen keeps working from local data with the radio
    // off; only the error flag changes.
    let count = existing;
    try {
      count = await countMedicines();
    } catch {
      /* DB unavailable too - fall back to the pre-sync count */
    }
    return {
      status: "error",
      count,
      lastSyncAt: storedVersion,
      error: error instanceof Error ? error.message : "Sync failed",
    };
  }
}

export async function currentSyncState(): Promise<SyncState> {
  return {
    status: "idle",
    count: await countMedicines(),
    lastSyncAt: await getMeta(SYNC_KEY),
  };
}
