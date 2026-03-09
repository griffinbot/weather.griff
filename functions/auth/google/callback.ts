import { buildSessionCookie, createUserSession, googleAuthConfigured, upsertGoogleUser } from "../../_lib/auth";
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

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return withCors(Response.json({ error: "Missing OAuth code" }, { status: 400 }), request, env);
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || "",
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: env.GOOGLE_REDIRECT_URI || "",
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    return withCors(Response.json({ error: "Google token exchange failed" }, { status: 502 }), request, env);
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return withCors(Response.json({ error: "Google access token missing" }, { status: 502 }), request, env);
  }

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userInfoResponse.ok) {
    return withCors(Response.json({ error: "Failed to fetch Google profile" }, { status: 502 }), request, env);
  }

  const userInfo = (await userInfoResponse.json()) as {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };

  const user = await upsertGoogleUser(env, userInfo);
  const session = await createUserSession(env, user.id);
  const response = Response.redirect(new URL("/", request.url).toString(), 302);
  response.headers.set("Set-Cookie", buildSessionCookie(session.cookieValue, session.expiresAt));
  return response;
}
