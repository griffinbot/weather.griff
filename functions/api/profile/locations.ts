import { getSessionUser } from "../../_lib/auth";
import { loadUserProfile, saveUserLocations } from "../../_lib/profile";
import { jsonError, withCors } from "../../_lib/proxy";
import type { SavedLocationRecord } from "../../../shared/contracts";
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
      locations: SavedLocationRecord[];
      selectedLocationId: string | null;
      migratedLocalDataAt?: string | null;
    };
    await saveUserLocations(
      context.env,
      user.id,
      payload.locations,
      payload.selectedLocationId,
      payload.migratedLocalDataAt ?? null,
    );
    const profile = await loadUserProfile(context.env, user.id);
    return withCors(Response.json({ ok: true, profile }), context.request, context.env);
  } catch (error: any) {
    return jsonError(400, error?.message || "Failed to save locations", context.request, context.env);
  }
}
