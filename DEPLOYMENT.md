# Cloudflare Deploy Notes

This repo is Cloudflare-only: the app and `/api/*` proxy run on Cloudflare Pages Functions.

## API endpoints

Compatibility routes (kept for current frontend behavior):
- `/api/nominatim/search`
- `/api/open-meteo/forecast`
- `/api/weather-gov/*`

Contract routes:
- Required:
  - `/api/position/search`
  - `/api/position/reverse`
  - `/api/timezone`
  - `/api/openmeteo/*`
- Optional:
  - `/api/rap`
  - `/api/aviationweather`
  - `/api/weather/*`
  - `/api/pqs`
  - `/api/googleelevation`
  - `/api/tfr`
  - `/api/aviationalerts`

The proxy enforces:
- strict CORS (`ALLOWED_ORIGIN`)
- GET/OPTIONS method policy
- per-client and per-provider rate limits (Durable Object)
- edge cache + stale fallback
- outbound `User-Agent` on upstream requests

## 1. Prerequisites

- Domain in Cloudflare: `griffmathews.com`
- Node + pnpm installed
- Cloudflare auth:

```sh
npx wrangler whoami
```

If needed:

```sh
npx wrangler login
```

## 2. Runtime variables and secrets

Set non-secret vars in `wrangler.jsonc` or Pages project settings:
- `ALLOWED_ORIGIN=https://weather.griffmathews.com`
- `PROXY_USER_AGENT=weather-griff-proxy/1.0 (contact: admin@griffmathews.com)`
- optional: `TFR_UPSTREAM_URL`
- optional: `AVIATIONALERTS_UPSTREAM_URL`

Set required secrets (do not commit these):

```sh
npx wrangler secret put TIMEZONEDB_API_KEY
npx wrangler secret put GOOGLE_ELEVATION_API_KEY
```

## 3. Build and deploy

```sh
pnpm install
pnpm run build
npx wrangler pages deploy dist --project-name new-weather-app --config wrangler.jsonc
```

## 4. Bind custom domain

In Cloudflare dashboard:

1. `Workers & Pages` -> `new-weather-app`
2. `Custom domains` -> `Set up a custom domain`
3. Add `weather.griffmathews.com`

## Note on Pages project name

This repo currently deploys to the Cloudflare Pages project `new-weather-app` (e.g. `*.new-weather-app-7b4.pages.dev`).
