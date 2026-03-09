import { clearSessionCookie, destroySession } from "../_lib/auth";
import { withCors } from "../_lib/proxy";
import type { Env } from "../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  await destroySession(context.env, context.request);
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return withCors(response, context.request, context.env);
}
