import type { Env } from "./rateLimiter";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getAllowedOrigin(request: Request, env: Env): string {
  const configured = env.ALLOWED_ORIGIN?.trim();
  if (configured) return configured;
  const reqUrl = new URL(request.url);
  return reqUrl.origin;
}

export function buildCorsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin");
  const allowed = getAllowedOrigin(request, env);
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  if (origin && origin === allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    headers.set("Access-Control-Allow-Origin", allowed);
  }

  return headers;
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const cors = buildCorsHeaders(request, env);
  const headers = new Headers(response.headers);
  cors.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function normalizeQueryString(searchParams: URLSearchParams): string {
  const entries = Array.from(searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

export function requireAllowedQuery(
  searchParams: URLSearchParams,
  allowlist: Set<string>,
): void {
  for (const key of searchParams.keys()) {
    if (!allowlist.has(key)) {
      throw new HttpError(400, `Unsupported query parameter: ${key}`);
    }
  }
}

export function requireRegex(value: string, regex: RegExp, name: string): void {
  if (!regex.test(value)) {
    throw new HttpError(400, `Invalid ${name}`);
  }
}

export function getProxyUserAgent(env: Env): string {
  return env.PROXY_USER_AGENT || "weather-griff-proxy/1.0 (contact: admin@griffmathews.com)";
}

export function buildUpstreamHeaders(
  env: Env,
  accept: string = "application/json",
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(extra);
  headers.set("User-Agent", getProxyUserAgent(env));
  headers.set("Accept", accept);
  return headers;
}

export function requireEnvVar(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new HttpError(500, `Missing required env var: ${name}`);
  }
  return normalized;
}

export async function jsonError(status: number, message: string, request: Request, env: Env, extra?: Record<string, string | number>): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      headers.set(k, String(v));
    }
  }
  return withCors(Response.json({ error: message }, { status, headers }), request, env);
}
