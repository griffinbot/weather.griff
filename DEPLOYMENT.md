# Cloudflare Deploy Notes

This project already includes a reverse proxy at Cloudflare Pages Functions under `/api/*`:

- `/api/open-meteo/forecast`
- `/api/nominatim/search`
- `/api/weather-gov/*`

The proxy enforces:

- CORS allowlist (`ALLOWED_ORIGIN`)
- per-client and per-provider rate limits (Durable Object)
- edge cache + stale fallback

## 1. Prerequisites

- Domain in Cloudflare: `griffmathews.com`
- Node/pnpm installed
- Cloudflare auth:

```sh
npx wrangler whoami
```

If not logged in:

```sh
npx wrangler login
```

## 2. Build and deploy

```sh
pnpm install
pnpm run build
npx wrangler pages deploy dist --project-name weather-griff
```

## 3. Bind custom domain

In Cloudflare dashboard:

1. `Workers & Pages` -> `weather-griff`
2. `Custom domains` -> `Set up a custom domain`
3. Add `weather.griffmathews.com`

Cloudflare will create/validate the DNS record for the subdomain.

## 4. Required runtime vars

Already set in `wrangler.jsonc`:

- `ALLOWED_ORIGIN=https://weather.griffmathews.com`
- `PROXY_USER_AGENT=weather-griff-proxy/1.0 (contact: admin@griffmathews.com)`

You can override these in the Pages project settings per environment.
