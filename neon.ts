import { defineConfig } from "@neon/config/v1";

/**
 * Neon project config.
 *
 * The catalogue function runs as a SELECT-only role. Neon injects the branch's
 * owner `DATABASE_URL` automatically, so it is overridden here with the
 * least-privilege URL produced by `npm run db:readonly`. Both pooler and direct
 * names are overridden so the owner credential is not reachable from the
 * function at runtime; the function itself only reads `DATABASE_URL`.
 *
 * The values are read from the file passed to `neon deploy --env <file>`, which
 * is loaded into `process.env` before this config is evaluated.
 */
const readOnlyUrl = process.env.READONLY_DATABASE_URL;

if (!readOnlyUrl) {
  throw new Error(
    "READONLY_DATABASE_URL is not set. Run `npm run db:readonly`, then deploy with `--env .env.local`.",
  );
}

const readOnlyDirectUrl = process.env.READONLY_DATABASE_URL_UNPOOLED ?? readOnlyUrl;
const writeUrl = process.env.DATABASE_URL_UNPOOLED ?? "";

export default defineConfig({
  auth: true,
  functions: {
    api: {
      name: "Osudh360 catalogue API",
      source: "./api.ts",
      env: {
        // Override the owner URLs Neon would otherwise inject.
        DATABASE_URL: readOnlyUrl,
        DATABASE_URL_UNPOOLED: readOnlyDirectUrl,
        // Prescription writes need a connection that can write; keep this to a
        // dedicated writer role in production.
        WRITE_DATABASE_URL: writeUrl,
      },
    },
  },
});
