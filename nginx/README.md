# Nginx setup for `weather.griffmathews.com`

This directory contains a ready-to-use Nginx config:

- `weather.griff.conf`

## Install

1. Copy config:
   ```bash
   sudo cp nginx/weather.griff.conf /etc/nginx/conf.d/weather.griff.conf
   ```
2. Replace API keys inside the file:
   - `YOUR_TIMEZONEDB_KEY`
   - `YOUR_GOOGLE_ELEVATION_KEY` (optional if you don't use the endpoint)
3. Ensure your frontend build is served from:
   - `/usr/share/nginx/html`
4. Validate + reload:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

## Included behavior

- SPA fallback: serves `index.html` for 404 routes with no-cache headers.
- Aggressive static caching for `/assets/*`.
- Reverse proxy routes for required and optional weather/location endpoints.
- Shared API cache configured via `proxy_cache_path`.
- `User-Agent` attached on outbound API requests.

## TLS note

This config listens on port 80. If Cloudflare is in front, you can terminate TLS at Cloudflare or add an additional `server` block for `listen 443 ssl;` depending on your origin setup.
