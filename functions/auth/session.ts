import { getSessionUser } from "../_lib/auth";
import { withCors } from "../_lib/proxy";
import type { Env } from "../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const user = await getSessionUser(context.env, context.request);
  return withCors(
    Response.json({
      authenticated: !!user,
      user: user
        ? {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatar_url,
          }
        : null,
    }),
    context.request,
    context.env,
  );
}
