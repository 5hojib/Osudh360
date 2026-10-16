# Osudh360 · Osudh360

A Bangladeshi medicine database covering **tablets and capsules**: price, strip
and box pack size, manufacturer, and every alternative brand of the same generic
from other companies.

It ships as two clients over one dataset:

- **`mobile/`** — an Android app (Expo / React Native) that mirrors the whole
  catalogue into on-device SQLite, so **everything works offline**.
- **the web app** (`src/`) — the same data as a server-rendered site.

Both read from **Neon Postgres** via `api.ts`, a Neon Function.

This is a reference database, not a shop: there is no cart, and stock status is
deliberately not shown.

---

## Where the data comes from

Prices are **scraped from publicly published listings** by Bangladeshi online
pharmacies, not invented. The crawler targets Arogga (Arogga Ltd, a registered
Bangladesh online pharmacy), which publishes a machine-readable
[schema.org](https://schema.org/Product) block on every product page:

| Field | Source |
| --- | --- |
| Brand name | Derived by removing the generic, form and strength from the display name |
| Generic | `isSimilarTo` → `Drug.name` in the same JSON-LD block |
| Manufacturer | `brand.name` |
| Price + currency | `offers.price` / `offers.priceCurrency` |
| Strip / box size | `additionalProperty` → `Sales Unit` (e.g. `Strip × 10`) |
| Strength | `additionalProperty` → `Strength` |
| Therapeutic class | `BreadcrumbList` trail |

Every page links to the original listing and shows when its data was last
verified. Prices change; the "updated" line and the `price_history` table make
that visible rather than hiding it.

### Being a good client

- ~4.5 requests/second ceiling, enforced by a **global rate gate** (not per
  worker — an earlier racy limiter let bursts through and triggered throttling).
- Each product page is ~690 KB, but every field we need sits in the first
  ~24 KB. The client reads that much and then **aborts the stream**, cutting
  bandwidth by roughly 97% and sparing the origin server.
- Retries use exponential backoff with jitter; permanent 404s are not retried.
- Identifies itself with a descriptive User-Agent and a contact URL.

---

## Pipeline

```bash
npm run data:sitemap    # sitemap  -> data/generics.json, data/sitemap-products.json
npm run data:generics   # 2.6k generic pages -> data/generic-products.jsonl
npm run data:products   # 23k product pages  -> data/products.jsonl   (~2h, resumable)
npm run data:import     # JSONL -> SQLite (local, optional)
npm run data:neon       # JSONL -> Neon Postgres
npm run data:refresh    # products + neon
```

Every crawl step is **resumable**: progress is appended to JSONL and completed
URLs are skipped on the next run. The Neon import is idempotent — re-running
changes no slugs and records history only when a price actually moved.

Other tooling:

```bash
npm run db:migrate      # apply migrations (uses the UNPOOLED url)
npm run db:reset        # drop the schema - destructive, local only
npm run typecheck && npm run lint
node --experimental-strip-types scripts/test-offline.ts   # offline-layer checks
```

### Why slugs are never trusted

Arogga serves HTTP 200 with *different* product data under a stale slug — a URL
containing `tablet` can return a syrup. So the sitemap slug is used only as a
cheap pre-filter, and identity always comes from the page's own `source_id` and
JSON-LD. Products are then kept or dropped based on the **dosage form reported
by the page**, not the URL. That rejected 5,678 candidates.

---

## Neon

Project `dawn-field-41084696`, branch `production` (us-east-2).

```bash
neon deploy --env .env.local   # deploys api.ts
```

- `api.ts` — read-only catalogue API (`pg` pool at module scope +
  `attachDatabasePool`, per the Neon Functions guidance).
- `neon.ts` — infrastructure as code (function + auth).
- `drizzle/0000_init.sql` — schema.

Routes: `/`, `/sync`, `/medicines`, `/medicines/:slug`, `/medicines/:slug/history`,
`/generics`, `/generics/:slug`, `/categories`, `/companies`, `/prescriptions`,
`/prescriptions/:id`.

`/sync` has two modes with **different cursors**: a full sync pages by a stable
id (`?after=`), an incremental sync asks for rows changed after a timestamp
(`?since=`). Paging an ordered list without a stable cursor loops forever on the
same page — that bug shipped once and was caught by the offline test.

---

## Offline design (the Android app)

The app mirrors the **entire** catalogue — 17,015 rows, about 2 MB — into local
SQLite on first sync. After that the network is only needed to *refresh*:

- **Search** runs entirely locally: words are OR'd (so "napa ace" returns Napa
  *or* Ace brands), ranked brand-prefix > brand-contains > generic match.
- **Alternatives are computed on-device** from `generic_slug + strength_value +
  strength_unit + form`, so they work with the radio off and match the server's
  definition exactly.
- Later syncs request only rows changed since the last watermark, which is a few
  kilobytes.
- **Company filtering** is computed on-device too; the home screen offers a short
  list of companies, so every filter works with the radio off.
- **Saved medicines and prescriptions** are stored locally and work offline;
  prescriptions saved while connected are also mirrored locally for offline use.
- **Images** are the exception: they are shown from the pharmacy's CDN, and only
  once already cached by the OS. The catalogue itself is fully offline.

`scripts/test-offline.ts` replays the app's real schema and queries against a
temporary SQLite file, asserts the offline alternatives set is identical to the
server's, and guards the search ranking.

---

## Stack

- **Neon Postgres** (18.6) + Drizzle ORM, `tsvector` + GIN for search
- **Neon Function** (`api.ts`) on Node 24
- **Next.js 16** (App Router, Turbopack, React 19), Tailwind v4, shadcn/ui
- **Expo 57 / React Native 0.86**, Expo Router, expo-sqlite
- Hind Siliguri + Inter typography

### Notable implementation details

- **Alternatives** match on generic + strength value + unit + form. Combination
  strengths (`12.5mg + 40mg`) get a null numeric value so they are only ever
  matched against an identical combination.
- `search_vector` is a **stored generated column** (the `simple` text-search
  config — English stemming mangles drug names), so it cannot drift from the
  columns it is built from.
- **Category URLs** use slash-separated slug paths
  (`/category/gastrointestinal-system/chronic-inflammatory-disease`); the display
  trail contains spaces and `>`, which are unreliable in a URL segment.
- **No stock badges, no "cheapest" crown.** The alternatives table is a plain
  price comparison; the reader decides.
- **`cacheComponents` is deliberately off** on the web app — every page reads the
  locale cookie then queries Postgres, so there is no static shell worth
  streaming.
- Language lives in a cookie, not a URL segment, keeping one canonical URL per
  page while still server-rendering in the visitor's language.

### Local networking note

Neon publishes IPv6 addresses that `dns.lookup` returns first. On a host without
IPv6 routing they blackhole and connections time out, although the same endpoint
answers over IPv4 in ~280 ms. `scripts/lib/pg-client.ts` pins the socket to IPv4
for the local scripts. If the web app also fails to connect locally, map the
Neon hostnames to their IPv4 addresses in `/etc/hosts`. Production hosts resolve
both families normally.

---

## Android APK (GitHub Actions)

`.github/workflows/android-release.yml` builds and publishes a signed APK.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The workflow regenerates the native project with `expo prebuild --clean`, so
`mobile/android/` is never committed and cannot drift from `app.json`. It then
runs `./gradlew assembleRelease` and attaches the APK to a GitHub Release.

### Signing

The Expo template signs **release** builds with the *debug* key — an APK no
store accepts, and one that can never be updated in place.
`mobile/scripts/patch-android-signing.mjs` replaces that with a real signing
config, injected after prebuild (which would otherwise overwrite it) and driven
by credentials from `gradle.properties`.

Set up the upload key once:

```bash
./scripts/setup-android-signing.sh
```

That generates `mobile/android/osudh360-release.keystore` and registers four
repository secrets — `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` — if the `gh` CLI is available.

**If those secrets are missing the build still succeeds**, using a throwaway key
minted inside CI, so the pipeline is never blocked. The workflow verifies the
resulting certificate and the release body says plainly that such a build is a
test build: it cannot go to Play Store and will not accept updates. Once the
secrets exist, a new tag produces a properly signed, updatable APK.

> The upload key is permanent. If it is lost, no future build can update the
> published app — keep `mobile/android/osudh360-release.keystore` backed up.

---

## Layout

```
api.ts                 Neon Function — catalogue API
neon.ts                Neon infrastructure as code
drizzle/               generated SQL migrations
scripts/               crawler, Neon importer, audit, offline test
src/app/               web routes
src/components/        web UI
src/lib/db/            schema, pool client, queries
src/lib/medicine.ts    strength parsing, price/pack formatting
src/lib/i18n.ts        dictionaries (safe in client components)
src/lib/i18n-server.ts cookie-based locale (server only)
mobile/src/app/        Expo Router screens
mobile/src/lib/        API client, SQLite cache, sync
```

## Disclaimer

Information only — not medical advice. Prices come from third-party listings and
change without notice; always check the MRP and expiry on the pack before
buying, and consult a doctor or pharmacist.