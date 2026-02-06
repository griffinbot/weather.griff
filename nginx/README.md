# Nginx setup for `weather.griffmathews.com`

This directory contains a ready-to-use Nginx config:

- `weather.griff.conf`

## Install

1. Copy config:
   ```bash
   sudo cp nginx/weather.griff.conf /etc/nginx/conf.d/weather.griff.conf
   ```
2. Replace API key placeholders in the file:
   - `YOUR_TIMEZONEDB_KEY`
   - `YOUR_GOOGLE_ELEVATION_KEY` (optional backup endpoint)
3. Ensure the built frontend files are served from:
   - `/usr/share/nginx/html`
4. Validate and reload:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

## Included behavior

- Serves `index.html` for SPA unknown routes and 404 responses with no-cache headers.
- Aggressively caches `/assets/*` for 1 year (`immutable`).
- Includes all required and optional reverse proxy endpoints from your spec.
- Attaches an outbound `User-Agent` header on proxied API requests.
- Uses a shared Nginx proxy cache (`weather_api_cache`) with route-specific TTLs:
  - Nominatim: 7 days
  - RAP/Open-Meteo/weather.gov/aviationweather/timezone/tfr/aviationalerts: 10 minutes
  - EPQS/Google elevation: 1 day

## TLS note

This config listens on port 80. If needed, add a separate TLS server block on `443` for direct HTTPS at origin, or terminate TLS at Cloudflare and keep this as origin HTTP.
