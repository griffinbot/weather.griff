import { HttpError, jsonError, withCors } from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";
import { orchestrateBallooningChat } from "../../_lib/ai/orchestrator";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Invalid JSON payload.");
    }

    const payload = await orchestrateBallooningChat(body, env, request);
    return withCors(Response.json(payload, { status: 200 }), request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "AI chat request failed.", request, env);
  }
}

