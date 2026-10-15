import { createPgClient, migrationUrl } from "./lib/pg-client.ts";

// Applies SQL migrations to Neon.
//
//   node --env-file=.env.local --experimental-strip-types scripts/migrate.ts
//
// Uses the direct (unpooled) endpoint: the pooled one goes through PgBouncer in
// transaction mode, which drops the session state schema migration relies on.

const client = createPgClient(migrationUrl());

try {
  await client.connect();
  console.log("→ connected to Neon");

  const { rows } = await client.query<{ version: string }>("select version()");
  console.log(`  ${rows[0].version.split(" ").slice(0, 2).join(" ")}`);

  console.log("→ applying migrations from ./drizzle");
  const { readdirSync, readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const folder = resolve(process.cwd(), "drizzle");

  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL UNIQUE,
      created_at bigint
    )
  `);

  const applied = new Set(
    (await client.query<{ hash: string }>(`SELECT hash FROM drizzle.__drizzle_migrations`)).rows.map(
      (r) => r.hash,
    ),
  );

  const files = readdirSync(folder).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    const sql = readFileSync(resolve(folder, file), "utf8");
    // A content hash keeps re-runs idempotent even if a file is edited.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(sql).digest("hex");

    if (applied.has(hash)) {
      console.log(`  · ${file} (already applied)`);
      continue;
    }

    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      await client.query(trimmed);
    }
    await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [
      hash,
      Date.now(),
    ]);
    console.log(`  ✓ ${file}`);
    count++;
  }

  console.log(count === 0 ? "✓ schema already up to date" : `✓ applied ${count} migration(s)`);
} finally {
  await client.end().catch(() => {});
}