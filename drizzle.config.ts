import { defineConfig } from "drizzle-kit";

/**
 * Migrations must run over the *direct* (unpooled) connection: the pooled
 * endpoint goes through PgBouncer in transaction mode, which breaks session
 * state that schema tooling relies on.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) before running drizzle-kit");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
