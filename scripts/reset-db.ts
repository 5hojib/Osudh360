import { createPgClient, migrationUrl } from "./lib/pg-client.ts";

/**
 * Drops and recreates the public schema.
 *
 * Only for local development against a fresh database - it destroys all data.
 *   node --env-file=.env.local --experimental-strip-types scripts/reset-db.ts
 */
const client = createPgClient(migrationUrl());
await client.connect();
try {
  const answer = process.argv.includes("--yes");
  if (!answer) {
    console.log("This drops every table in the public schema. Re-run with --yes to proceed.");
    process.exitCode = 1;
  } else {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("CREATE SCHEMA public");
    console.log("✓ public + drizzle schemas reset");
  }
} finally {
  await client.end().catch(() => {});
}