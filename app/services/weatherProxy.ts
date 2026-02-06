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
): Promise<T> {
  const proxyUrl = toProxyUrl(url);

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
      const response = await fetch(proxyUrl, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
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
): Promise<T> {
  return cachedFetch<T>(
    url,
    {
      headers: {
        Accept: "application/geo+json",
        // weather.gov requests a unique User-Agent; browsers restrict setting
        // this header directly, so we rely on the browser default UA plus the
        // Accept header. For server-side usage, set the User-Agent here.
      },
    },
    ttl,
  );
}

/**
 * Convenience wrapper for Open-Meteo API calls.
 */
export async function openMeteoFetch<T = any>(
  url: string,
  ttl = DEFAULT_TTL_MS,
): Promise<T> {
  return cachedFetch<T>(url, undefined, ttl);
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
