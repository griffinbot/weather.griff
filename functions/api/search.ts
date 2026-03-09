import { fetchSearchResults } from "../_lib/domain";
import { jsonError, withCors } from "../_lib/proxy";
import type { Env } from "../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 120) {
    return jsonError(400, "Query must be between 2 and 120 characters", request, env);
  }

  try {
    const results = await fetchSearchResults(context, query);
    return withCors(Response.json({ results }), request, env);
  } catch (error: any) {
    return jsonError(502, error?.message || "Search failed", request, env);
  }
}
