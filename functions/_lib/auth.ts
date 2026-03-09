import type { Env } from "./rateLimiter";

const SESSION_COOKIE = "weather_griff_session";

type DbSession = {
  id: string;
  user_id: string;
  expires_at: string;
};

type DbUser = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
};

function textEncoder(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder(value));
  return toHex(signature);
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", textEncoder(value)));
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  return header.split(";").reduce<Record<string, string>>((acc, chunk) => {
    const [key, ...rest] = chunk.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${padding}`);
}

export function authConfigured(env: Env): boolean {
  return !!(env.DB && env.SESSION_SECRET);
}

export function googleAuthConfigured(env: Env): boolean {
  return !!(
    authConfigured(env) &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_REDIRECT_URI
  );
}

export function buildSessionCookie(value: string, expiresAt: string): string {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSessionCookie(env: Env, sessionId: string): Promise<string> {
  const payload = `${sessionId}.${crypto.randomUUID()}`;
  const signature = await hmac(env.SESSION_SECRET || "", payload);
  return toBase64Url(`${payload}.${signature}`);
}

async function verifySessionCookie(env: Env, cookieValue: string): Promise<{ sessionId: string; token: string } | null> {
  try {
    const decoded = fromBase64Url(cookieValue);
    const parts = decoded.split(".");
    if (parts.length < 3) return null;
    const signature = parts.pop() || "";
    const token = parts.pop() || "";
    const sessionId = parts.join(".");
    const payload = `${sessionId}.${token}`;
    const expected = await hmac(env.SESSION_SECRET || "", payload);
    if (signature !== expected) return null;
    return { sessionId, token };
  } catch {
    return null;
  }
}

export async function createUserSession(
  env: Env,
  userId: string,
): Promise<{ cookieValue: string; expiresAt: string }> {
  if (!env.DB || !env.SESSION_SECRET) {
    throw new Error("Auth is not configured");
  }

  const sessionId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(sessionId, userId, tokenHash, expiresAt, new Date().toISOString())
    .run();
  const signature = await hmac(env.SESSION_SECRET, `${sessionId}.${token}`);
  return {
    cookieValue: toBase64Url(`${sessionId}.${token}.${signature}`),
    expiresAt,
  };
}

export async function getSessionUser(env: Env, request: Request): Promise<DbUser | null> {
  if (!env.DB || !env.SESSION_SECRET) return null;

  const cookie = parseCookies(request)[SESSION_COOKIE];
  if (!cookie) return null;

  const verified = await verifySessionCookie(env, cookie);
  if (!verified) return null;

  const tokenHash = await sha256(verified.token);
  const session = await env.DB.prepare(
    "SELECT id, user_id, expires_at FROM sessions WHERE id = ?1 AND token_hash = ?2",
  )
    .bind(verified.sessionId, tokenHash)
    .first<DbSession>();

  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(session.id).run();
    return null;
  }

  return env.DB.prepare(
    "SELECT id, email, name, avatar_url FROM users WHERE id = ?1",
  )
    .bind(session.user_id)
    .first<DbUser>();
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  if (!env.DB || !env.SESSION_SECRET) return;
  const cookie = parseCookies(request)[SESSION_COOKIE];
  if (!cookie) return;
  const verified = await verifySessionCookie(env, cookie);
  if (!verified) return;
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(verified.sessionId).run();
}

export async function ensureProfileRows(env: Env, userId: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_preferences (user_id, preferences_json, updated_at) VALUES (?1, ?2, ?3)",
  )
    .bind(
      userId,
      JSON.stringify({
        temperatureUnit: "fahrenheit",
        windSpeedUnit: "knots",
        pressureUnit: "inhg",
        distanceUnit: "miles",
        altitudeUnit: "feet",
        timeFormat: "12",
        autoRefresh: true,
        defaultWindsView: "table",
        showDetailedWindTable: true,
        enableDiscussionInBriefing: true,
        flight_tools: {
          preferredCruiseAltitudeFt: null,
          defaultAircraftType: "",
        },
      }),
      new Date().toISOString(),
    )
    .run();
}

export async function upsertGoogleUser(
  env: Env,
  payload: { sub: string; email: string; name: string; picture?: string },
): Promise<DbUser> {
  if (!env.DB) {
    throw new Error("Database is not configured");
  }

  const existing = await env.DB.prepare(
    "SELECT id, email, name, avatar_url FROM users WHERE google_sub = ?1 OR email = ?2",
  )
    .bind(payload.sub, payload.email)
    .first<DbUser & { id: string }>();

  const userId = existing?.id || crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, avatar_url, google_sub, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url, google_sub = excluded.google_sub, updated_at = excluded.updated_at",
  )
    .bind(
      userId,
      payload.email,
      payload.name,
      payload.picture ?? null,
      payload.sub,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();

  await ensureProfileRows(env, userId);

  return {
    id: userId,
    email: payload.email,
    name: payload.name,
    avatar_url: payload.picture ?? null,
  };
}
