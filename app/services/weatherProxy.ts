/**
 * Client-side dedupe/cache helper for API calls.
 *
 * Global rate limiting is now handled at the Cloudflare edge (`/api/*`).
 * This module keeps only in-browser caching + in-flight deduplication for UX.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min default cache lifetime
const STALE_GRACE_MS = 30 * 60 * 1000; // keep stale entries for 30 min

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
interface CacheEntry {
  data: any;
  timestamp: number;
}

const responseCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<any>>();

function parseRetryAfterMs(value: string | null, attempt: number): number {
  if (!value) return Math.min(1500, 300 * (2 ** attempt));
  const asSeconds = Number.parseInt(value, 10);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(3000, asSeconds * 1000);
  }
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    return Math.max(250, Math.min(3000, asDate - Date.now()));
  }
  return Math.min(1500, 300 * (2 ** attempt));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toProxyUrl(url: string): string {
  if (url.startsWith("https://api.open-meteo.com/v1/forecast?")) {
    return `/api/open-meteo/forecast?${url.split("?")[1] ?? ""}`;
  }

  if (url.startsWith("https://api.weather.gov/")) {
    const u = new URL(url);
    return `/api/weather-gov${u.pathname}${u.search}`;
  }

  return url;
}

function toUpstreamUrlFromProxy(proxyUrl: string): string | null {
  if (proxyUrl.startsWith("/api/open-meteo/forecast?")) {
    return `https://api.open-meteo.com/v1/forecast?${proxyUrl.split("?")[1] ?? ""}`;
  }

  if (proxyUrl.startsWith("/api/openmeteo/")) {
    return `https://api.open-meteo.com/v1/${proxyUrl.slice("/api/openmeteo/".length)}`;
  }

  if (proxyUrl.startsWith("/api/weather-gov/")) {
    return `https://api.weather.gov/${proxyUrl.slice("/api/weather-gov/".length)}`;
  }

  if (proxyUrl.startsWith("/api/weather/")) {
    return `https://api.weather.gov/${proxyUrl.slice("/api/weather/".length)}`;
  }

  if (proxyUrl.startsWith("/api/aviationweather")) {
    const parsed = new URL(proxyUrl, "https://proxy.local");
    const type = (parsed.searchParams.get("type") || "taf").toLowerCase();
    if (type !== "taf" && type !== "metar") return null;
    parsed.searchParams.delete("type");
    const query = parsed.searchParams.toString();
    return `https://www.aviationweather.gov/api/data/${type}${query ? `?${query}` : ""}`;
  }

  return null;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const clone = response.clone();
  try {
    return (await response.json()) as T;
  } catch (error) {
    let snippet = "";
    try {
      snippet = (await clone.text()).trim().replace(/\s+/g, " ").slice(0, 220);
    } catch {
      // ignore
    }
    const contentType = clone.headers.get("content-type") || "unknown";
    const details = snippet ? ` Body starts with: ${snippet}` : "";
    throw new Error(
      `Invalid JSON response (status ${clone.status}, content-type ${contentType}).${details}`,
      { cause: error },
    );
  }
}

/** Remove entries that are well past their grace period. */
function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.timestamp > STALE_GRACE_MS) {
      responseCache.delete(key);
    }
  }
}

// Run pruning every 5 minutes
setInterval(pruneCache, 5 * 60_000);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cached fetch with deduplication.
 *
 * @param url      Full request URL (used as cache key)
 * @param options  Standard RequestInit (headers, etc.)
 * @param ttl      Time-to-live for the cached response in ms
 * @returns        Parsed JSON body
 */
export async function cachedFetch<T = any>(
  url: string,
  options?: RequestInit,
  ttl = DEFAULT_TTL_MS,
  timeoutMs = 8000,
): Promise<T> {
  const proxyUrl = toProxyUrl(url);
  const isOpenMeteoProxyUrl =
    proxyUrl.startsWith("/api/open-meteo/forecast?") ||
    proxyUrl.startsWith("/api/openmeteo/");
  const isWeatherGovProxyUrl =
    proxyUrl.startsWith("/api/weather-gov/") || proxyUrl.startsWith("/api/weather/");
  const isAviationWeatherProxyUrl = proxyUrl.startsWith("/api/aviationweather");
  const allowDirectUpstreamFallback =
    !proxyUrl.startsWith("/api/") ||
    isOpenMeteoProxyUrl ||
    isWeatherGovProxyUrl ||
    isAviationWeatherProxyUrl;
  const upstreamFallbackUrl = allowDirectUpstreamFallback ? toUpstreamUrlFromProxy(proxyUrl) : null;

  // 1. Cache hit?
  const cached = responseCache.get(proxyUrl);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }

  // 2. Deduplicate: return existing in-flight promise
  const pending = pendingRequests.get(proxyUrl);
  if (pending) return pending as Promise<T>;

  // 3. Make the request
  const promise = (async (): Promise<T> => {
    try {
      const fetchWithTimeout = async (
        requestUrl: string,
        requestTimeoutMs = timeoutMs,
      ): Promise<Response> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
          return await fetch(requestUrl, {
            ...options,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      };

      const tryFetchWithRetries = async (requestUrl: string): Promise<Response> => {
        let response: Response | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await fetchWithTimeout(requestUrl);
          if ((response.status !== 429 && response.status !== 503) || attempt === 1) {
            break;
          }
          await sleep(parseRetryAfterMs(response.headers.get("Retry-After"), attempt));
        }
        if (!response) throw new Error("No response");
        return response;
      };

      let response: Response;
      let usedUrl: "proxy" | "upstream" = "proxy";
      try {
        response = await tryFetchWithRetries(proxyUrl);
      } catch (e) {
        if (upstreamFallbackUrl) {
          usedUrl = "upstream";
          response = await tryFetchWithRetries(upstreamFallbackUrl);
        } else {
          throw e;
        }
      }

      if (!response.ok && upstreamFallbackUrl && usedUrl === "proxy") {
        // If the proxy is blocked upstream (403/5xx), try from the browser directly.
        usedUrl = "upstream";
        response = await tryFetchWithRetries(upstreamFallbackUrl);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let data: T;
      try {
        data = await parseJsonResponse<T>(response);
      } catch (error) {
        if (upstreamFallbackUrl && usedUrl === "proxy") {
          const upstream = await tryFetchWithRetries(upstreamFallbackUrl);
          if (!upstream.ok) {
            throw new Error(`HTTP ${upstream.status}: ${upstream.statusText}`, { cause: error });
          }
          data = await parseJsonResponse<T>(upstream);
        } else {
          throw error;
        }
      }

      responseCache.set(proxyUrl, { data, timestamp: Date.now() });
      return data as T;
    } catch (err) {
      // Stale-while-revalidate: return stale data on network failure
      if (cached) {
        console.warn("[weatherProxy] Returning stale data for:", proxyUrl);
        return cached.data as T;
      }
      throw err;
    } finally {
      pendingRequests.delete(proxyUrl);
    }
  })();

  pendingRequests.set(proxyUrl, promise);
  return promise;
}

/**
 * Convenience wrapper for the weather.gov API which needs specific headers.
 */
export async function weatherGovFetch<T = any>(
  url: string,
  ttl = DEFAULT_TTL_MS,
  timeoutMs = 15000,
): Promise<T> {
  return cachedFetch<T>(
    url,
    {
      headers: {
        Accept: "application/geo+json, application/ld+json, application/json",
        // weather.gov requests a unique User-Agent; browsers restrict setting
        // this header directly, so we rely on the browser default UA plus the
        // Accept header. For server-side usage, set the User-Agent here.
      },
    },
    ttl,
    timeoutMs,
  );
}

/**
 * Convenience wrapper for Open-Meteo API calls.
 */
export async function openMeteoFetch<T = any>(
  url: string,
  ttl = DEFAULT_TTL_MS,
  timeoutMs = 5000,
): Promise<T> {
  return cachedFetch<T>(url, undefined, ttl, timeoutMs);
}

// ---------------------------------------------------------------------------
// Diagnostics (for debugging in dev console)
// ---------------------------------------------------------------------------
export function getCacheStats() {
  return {
    entries: responseCache.size,
    pending: pendingRequests.size,
  };
}

export function clearProxyCache() {
  responseCache.clear();
  pendingRequests.clear();
}
