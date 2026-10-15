// Creates (or rotates) the least-privilege role the catalogue API runs as.
//
//   npm run db:readonly
//
// The function only ever SELECTs, so it should not connect as the owner. This
// provisions `oshudhika_readonly` with SELECT on the public schema and nothing
// else, verifies it can read and cannot write, and writes the two ready-to-use
// connection strings to $READONLY_ENV_OUT for the caller to move into .env.local.
//
// It never prints the password.

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { createPgClient, migrationUrl } from "./lib/pg-client.ts";

const ROLE = process.env.READONLY_ROLE ?? "oshudhika_readonly";
const OUT = process.env.READONLY_ENV_OUT ?? "/tmp/opencode/readonly.env";

const ownerDirectUrl = migrationUrl();
const ownerDirect = new URL(ownerDirectUrl);
const ownerPooled = new URL(process.env.DATABASE_URL ?? ownerDirectUrl);
const dbName = decodeURIComponent(ownerDirect.pathname.replace(/^\//, ""));
if (!dbName) throw new Error("Could not parse the database name from DATABASE_URL_UNPOOLED");

// base64url: safe in SQL literals and URLs, no quoting or escaping surprises.
const password = randomBytes(30).toString("base64url");

const admin = createPgClient(ownerDirectUrl);
await admin.connect();
try {
  await admin.query("BEGIN");
  await admin.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
         CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}';
       ELSE
         ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}';
       END IF;
     END $$;`,
  );
  // A fresh role holds no table privileges, so it starts read-only; these add
  // exactly SELECT and nothing more.
  await admin.query(`GRANT CONNECT ON DATABASE "${dbName.replace(/"/g, '""')}" TO ${ROLE}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE}`);
  await admin.query("COMMIT");

  const { rows } = await admin.query<{
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
  }>(
    `SELECT
       has_table_privilege('${ROLE}', 'medicines', 'SELECT') AS can_select,
       has_table_privilege('${ROLE}', 'medicines', 'INSERT') AS can_insert,
       has_table_privilege('${ROLE}', 'medicines', 'UPDATE') AS can_update,
       has_table_privilege('${ROLE}', 'medicines', 'DELETE') AS can_delete`,
  );
  const p = rows[0];
  const readOnly = p.can_select && !p.can_insert && !p.can_update && !p.can_delete;
  console.log(
    `privileges:      SELECT=${p.can_select} INSERT=${p.can_insert} UPDATE=${p.can_update} DELETE=${p.can_delete}`,
  );
  if (!readOnly) throw new Error("role is not read-only — refusing to write credentials");
} catch (error) {
  await admin.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await admin.end();
}

const direct = withCredentials(ownerDirect, password).toString();
const pooled = withCredentials(ownerPooled, password).toString();

// Prove the role can actually read over each endpoint before recommending it.
const readPooled = await probe(pooled);
const readDirect = await probe(direct);

writeFileSync(
  OUT,
  `READONLY_DATABASE_URL=${pooled}\nREADONLY_DATABASE_URL_UNPOOLED=${direct}\n`,
  { mode: 0o600 },
);

console.log(`role:            ${ROLE}`);
console.log(`database:        ${dbName}`);
console.log(`pooled endpoint: ${readPooled ? "OK (read works, write denied)" : "FAILED"}`);
console.log(`direct endpoint: ${readDirect ? "OK (read works, write denied)" : "FAILED"}`);
console.log(`wrote:           ${OUT}`);
if (!readPooled && readDirect) {
  console.log("note: the pooler rejected the new role — use the UNPOOLED URL");
}

function withCredentials(url: URL, pass: string) {
  const copy = new URL(url.toString());
  copy.username = ROLE;
  copy.password = pass;
  return copy;
}

/** Reads a row and confirms a write is rejected. Returns false on any failure. */
async function probe(connectionString: string): Promise<boolean> {
  const client = createPgClient(connectionString);
  try {
    await client.connect();
    const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM medicines");
    if (typeof rows[0]?.n !== "number") return false;
    try {
      await client.query("UPDATE medicines SET updated_at = updated_at WHERE false");
      return false; // a write succeeded, so the role is not read-only
    } catch {
      return true; // permission denied, as intended
    }
  } catch (error) {
    console.error(`  probe failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
