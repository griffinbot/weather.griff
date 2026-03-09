import { getSessionUser } from "../../_lib/auth";
import { loadUserProfile, saveUserPreferences } from "../../_lib/profile";
import { jsonError, withCors } from "../../_lib/proxy";
import type { UserPreferences } from "../../../shared/contracts";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestPut(context: EventContext): Promise<Response> {
  const user = await getSessionUser(context.env, context.request);
  if (!user) return jsonError(401, "Authentication required", context.request, context.env);

  try {
    const payload = (await context.request.json()) as {
      preferences: UserPreferences;
      selectedLocationId?: string | null;
      migratedLocalDataAt?: string | null;
    };
    await saveUserPreferences(
      context.env,
      user.id,
      payload.preferences,
      payload.selectedLocationId,
      payload.migratedLocalDataAt,
    );
    const profile = await loadUserProfile(context.env, user.id);
    return withCors(Response.json({ ok: true, profile }), context.request, context.env);
  } catch (error: any) {
    return jsonError(400, error?.message || "Failed to save preferences", context.request, context.env);
  }
}
