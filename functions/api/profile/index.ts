import { getSessionUser } from "../../_lib/auth";
import { loadUserProfile } from "../../_lib/profile";
import { jsonError, withCors } from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const user = await getSessionUser(context.env, context.request);
  if (!user) {
    return withCors(
      Response.json({ authenticated: false, profile: null }, { status: 200 }),
      context.request,
      context.env,
    );
  }

  try {
    const profile = await loadUserProfile(context.env, user.id);
    return withCors(
      Response.json({ authenticated: true, profile }, { status: 200 }),
      context.request,
      context.env,
    );
  } catch (error: any) {
    return jsonError(500, error?.message || "Failed to load profile", context.request, context.env);
  }
}
