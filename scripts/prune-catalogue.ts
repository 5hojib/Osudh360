// Removes catalogue rows that fail the current curation rules, without
// re-importing.
//
//   node --env-file=.env.local --experimental-strip-types scripts/prune-catalogue.ts
//
// The rule lives in scripts/lib/curation.ts and is the same one the importer
// applies; this is the one-shot version for a database that predates it. The
// importer also prunes on every run, so this is mainly for applying the change
// immediately. price_history rows cascade.

import { createPgClient, migrationUrl } from "./lib/pg-client.ts";
import { DROP_WHERE } from "./lib/curation.ts";

const client = createPgClient(migrationUrl());
await client.connect();

const before = (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM medicines`)).rows[0];
const deleted = await client.query(`DELETE FROM medicines WHERE ${DROP_WHERE}`);
const after = (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM medicines`)).rows[0];

console.log(`pruned ${deleted.rowCount} row(s): ${before?.n} -> ${after?.n} medicines`);

await client.end();
