import { jsonError, withCors } from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  return withCors(
    Response.json(
      {
        ok: false,
        status: "not_implemented",
        contract: {
          departure: "ICAO code",
          destination: "ICAO code",
          cruiseAltitudeFt: "number",
          aircraftType: "string",
        },
      },
      { status: 501 },
    ),
    context.request,
    context.env,
  );
}
