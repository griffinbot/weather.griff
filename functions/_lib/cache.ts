interface CacheProxyOptions {
  cacheKeyPath: string;
  cacheQuery: URLSearchParams;
  targetUrl: string;
  ttlSeconds: number;
  staleTtlSeconds: number;
  upstreamHeaders?: HeadersInit;
  request: Request;
  ctx: { waitUntil: (promise: Promise<unknown>) => void };
}

function makeCacheRequest(path: string, searchParams: URLSearchParams): Request {
  const normalized = new URLSearchParams(Array.from(searchParams.entries()).sort(([a], [b]) => a.localeCompare(b)));
  const qs = normalized.toString();
  // Synthetic hostname used only as the cache key namespace.
  const url = `https://cache.internal${path}${qs ? `?${qs}` : ""}`;
  return new Request(url, { method: "GET" });
}

function cacheable(response: Response): boolean {
  return response.ok && response.status < 400;
}

export async function fetchJsonWithCache(options: CacheProxyOptions): Promise<Response> {
  const cache = caches.default;
  const freshKey = makeCacheRequest(options.cacheKeyPath, options.cacheQuery);
  const staleQuery = new URLSearchParams(options.cacheQuery);
  staleQuery.set("__stale", "1");
  const staleKey = makeCacheRequest(options.cacheKeyPath, staleQuery);

  const freshHit = await cache.match(freshKey);
  if (freshHit) {
    const headers = new Headers(freshHit.headers);
    headers.set("X-Proxy-Cache", "HIT");
    return new Response(freshHit.body, {
      status: freshHit.status,
      statusText: freshHit.statusText,
      headers,
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(options.targetUrl, {
      method: "GET",
      headers: options.upstreamHeaders,
    });
  } catch (error) {
    const staleHit = await cache.match(staleKey);
    if (staleHit) {
      const headers = new Headers(staleHit.headers);
      headers.set("X-Proxy-Cache", "STALE");
      return new Response(staleHit.body, {
        status: staleHit.status,
        statusText: staleHit.statusText,
        headers,
      });
    }
    throw error;
  }

  if (upstream.status === 429 || upstream.status >= 500) {
    const staleHit = await cache.match(staleKey);
    if (staleHit) {
      const headers = new Headers(staleHit.headers);
      headers.set("X-Proxy-Cache", "STALE");
      headers.set("X-Proxy-Upstream-Status", String(upstream.status));
      return new Response(staleHit.body, {
        status: staleHit.status,
        statusText: staleHit.statusText,
        headers,
      });
    }
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("X-Proxy-Cache", "MISS");

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });

  if (cacheable(response) && response.status !== 429 && response.status < 500) {
    const freshResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    freshResponse.headers.set("Cache-Control", `public, max-age=${options.ttlSeconds}`);

    const staleResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    staleResponse.headers.set("Cache-Control", `public, max-age=${options.staleTtlSeconds}`);

    options.ctx.waitUntil(Promise.all([
      cache.put(freshKey, freshResponse),
      cache.put(staleKey, staleResponse),
    ]));
  }

  return response;
}
