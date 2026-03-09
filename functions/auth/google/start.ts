import { googleAuthConfigured } from "../../_lib/auth";
import { withCors } from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;
  if (!googleAuthConfigured(env)) {
    return withCors(Response.json({ error: "Google OAuth is not configured" }, { status: 501 }), request, env);
  }

  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return Response.redirect(url.toString(), 302);
}
