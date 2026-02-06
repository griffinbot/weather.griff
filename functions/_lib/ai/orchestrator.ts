import { HttpError } from "../proxy";
import type { Env } from "../rateLimiter";
import { runRiskAgent } from "./agents/riskAgent";
import { runTrajectoryAgent } from "./agents/trajectoryAgent";
import { runWeatherAgent } from "./agents/weatherAgent";
import { retrieveBallooningSnippets, ragSnippetsToSources } from "./retrieval";
import type {
  AgentHint,
  AgentName,
  AgentResult,
  ChatMessageInput,
  ChatRequest,
  ChatResponse,
  LiveWeatherContext,
  RiskLevel,
} from "./types";
import {
  MAX_HISTORY_MESSAGES,
  MAX_INPUT_TOKENS_APPROX,
  MAX_MESSAGE_CHARS,
  MAX_QUESTION_CHARS,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function firstSentence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/.*?[.!?](\s|$)/);
  return match?.[0]?.trim() || trimmed;
}

function sanitizeText(value: unknown, maxLength: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function approxTokens(messages: ChatMessageInput[], question: string): number {
  const totalChars =
    messages.reduce((sum, message) => sum + message.content.length, 0) + question.length;
  return Math.ceil(totalChars / 4);
}

function normalizeMessages(raw: unknown): ChatMessageInput[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((item: any) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: sanitizeText(item?.content, MAX_MESSAGE_CHARS),
      ts: typeof item?.ts === "string" ? item.ts : undefined,
    }))
    .filter((item) => item.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
}

function normalizeRequest(input: any): ChatRequest {
  const sessionId = sanitizeText(input?.sessionId, 100);
  if (!sessionId) throw new HttpError(400, "sessionId is required.");

  const location = {
    name: sanitizeText(input?.location?.name, 120),
    airport: sanitizeText(input?.location?.airport, 12).toUpperCase(),
    lat: Number(input?.location?.lat),
    lon: Number(input?.location?.lon),
  };
  if (!location.name || !location.airport || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
    throw new HttpError(400, "Valid location (name, airport, lat, lon) is required.");
  }

  const userQuestion = sanitizeText(input?.userQuestion, MAX_QUESTION_CHARS);
  if (!userQuestion) throw new HttpError(400, "userQuestion is required.");

  const messages = normalizeMessages(input?.messages);
  if (approxTokens(messages, userQuestion) > MAX_INPUT_TOKENS_APPROX) {
    throw new HttpError(400, "Conversation payload too large.");
  }

  const agentHintRaw = sanitizeText(input?.options?.agentHint, 20).toLowerCase();
  const agentHint: AgentHint =
    agentHintRaw === "weather" || agentHintRaw === "risk" || agentHintRaw === "trajectory"
      ? (agentHintRaw as AgentHint)
      : "auto";
  const maxTokens = clamp(Number(input?.options?.maxTokens || 700), 200, 1200);

  return {
    sessionId,
    location,
    messages,
    userQuestion,
    options: {
      maxTokens,
      agentHint,
    },
  };
}

function buildConversationSummary(messages: ChatMessageInput[]): string {
  if (messages.length === 0) return "No prior conversation.";
  return messages
    .slice(-6)
    .map((message) => `${message.role}: ${message.content.slice(0, 220)}`)
    .join("\n");
}

function selectAgents(question: string, hint: AgentHint): Array<"weather" | "risk" | "trajectory"> {
  if (hint === "weather" || hint === "risk" || hint === "trajectory") return [hint];

  const selected = new Set<"weather" | "risk" | "trajectory">();
  const lower = question.toLowerCase();

  if (/(weather|forecast|temperature|cloud|metar|taf|pressure|visibility)/.test(lower)) {
    selected.add("weather");
  }
  if (/(risk|safe|safety|launch|go\/no-go|go no-go|abort|hazard|caution)/.test(lower)) {
    selected.add("risk");
  }
  if (/(drift|trajectory|aloft|wind profile|track|landing zone|lz)/.test(lower)) {
    selected.add("trajectory");
  }

  if (selected.size === 0) {
    selected.add("weather");
    selected.add("risk");
  }
  if (!selected.has("trajectory")) selected.add("trajectory");

  return Array.from(selected);
}

async function fetchLocalJson<T>(
  request: Request,
  path: string,
  timeoutMs = 5_000,
): Promise<T | null> {
  const base = new URL(request.url);
  const url = `${base.origin}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildLiveWeatherContext(
  request: Request,
  location: ChatRequest["location"],
): Promise<LiveWeatherContext> {
  const forecastParams = new URLSearchParams({
    latitude: location.lat.toString(),
    longitude: location.lon.toString(),
    current: [
      "temperature_2m",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "cloud_cover",
      "precipitation",
      "surface_pressure",
      "relative_humidity_2m",
      "apparent_temperature",
    ].join(","),
    hourly: [
      "temperature_2m",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "cloud_cover",
      "visibility",
      "precipitation_probability",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "precipitation_probability_max",
    ].join(","),
    timezone: "auto",
    wind_speed_unit: "kn",
    temperature_unit: "fahrenheit",
    forecast_hours: "12",
    forecast_days: "2",
  });

  const aloftParams = new URLSearchParams({
    latitude: location.lat.toString(),
    longitude: location.lon.toString(),
    hourly: [
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_speed_1000hPa",
      "wind_direction_1000hPa",
      "wind_speed_925hPa",
      "wind_direction_925hPa",
      "wind_speed_850hPa",
      "wind_direction_850hPa",
    ].join(","),
    timezone: "auto",
    wind_speed_unit: "kn",
    forecast_hours: "8",
  });

  const [forecast, points, metar, taf, windsAloft] = await Promise.all([
    fetchLocalJson<any>(request, `/api/open-meteo/forecast?${forecastParams.toString()}`),
    fetchLocalJson<any>(request, `/api/weather-gov/points/${location.lat.toFixed(4)},${location.lon.toFixed(4)}`),
    fetchLocalJson<any>(request, `/api/aviationweather?type=metar&ids=${encodeURIComponent(location.airport)}&format=json`),
    fetchLocalJson<any>(request, `/api/aviationweather?type=taf&ids=${encodeURIComponent(location.airport)}&format=json`),
    fetchLocalJson<any>(request, `/api/open-meteo/forecast?${aloftParams.toString()}`),
  ]);

  return {
    openMeteoCurrent: forecast?.current ?? null,
    openMeteoHourly: forecast?.hourly ?? null,
    openMeteoDaily: forecast?.daily ?? null,
    windsAloft,
    metar: Array.isArray(metar) ? metar[0] ?? null : metar ?? null,
    taf: Array.isArray(taf) ? taf[0] ?? null : taf ?? null,
    points,
  };
}

function dedupeStrings(values: string[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = sanitizeText(value, 220);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function deriveRiskLevel(riskResult: AgentResult | undefined): RiskLevel {
  if (!riskResult?.riskLevel) return "unknown";
  return riskResult.riskLevel;
}

export async function orchestrateBallooningChat(
  rawRequestBody: any,
  env: Env,
  request: Request,
): Promise<ChatResponse> {
  const parsed = normalizeRequest(rawRequestBody);
  const conversationSummary = buildConversationSummary(parsed.messages);

  const [liveWeather, ragSnippets] = await Promise.all([
    buildLiveWeatherContext(request, parsed.location),
    retrieveBallooningSnippets(env, parsed.userQuestion, 6),
  ]);

  const selectedAgents = selectAgents(parsed.userQuestion, parsed.options?.agentHint || "auto");

  const jobs: Array<Promise<AgentResult>> = [];
  if (selectedAgents.includes("weather")) {
    jobs.push(
      runWeatherAgent({
        env,
        question: parsed.userQuestion,
        location: parsed.location,
        liveWeather,
        ragSnippets,
        conversationSummary,
      }),
    );
  }
  if (selectedAgents.includes("risk")) {
    jobs.push(
      runRiskAgent({
        env,
        question: parsed.userQuestion,
        location: parsed.location,
        liveWeather,
        ragSnippets,
        conversationSummary,
      }),
    );
  }
  if (selectedAgents.includes("trajectory")) {
    jobs.push(
      runTrajectoryAgent({
        env,
        question: parsed.userQuestion,
        location: parsed.location,
        liveWeather,
        ragSnippets,
        conversationSummary,
      }),
    );
  }

  const results = await Promise.all(jobs);
  const weatherResult = results.find((item) => item.agent === "weather");
  const riskResult = results.find((item) => item.agent === "risk");
  const trajectoryResult = results.find((item) => item.agent === "trajectory");

  const summaryContent =
    weatherResult?.summary ||
    `Weather context for ${parsed.location.airport} is partially available; use official observations for final decision support.`;
  const riskContent =
    riskResult?.summary ||
    "Risk assessment is limited by available data. Apply conservative local launch criteria.";
  const driftContent =
    trajectoryResult?.summary ||
    "Drift outlook is uncertain without robust winds-aloft confirmation. Use short-horizon checks.";
  const actionContent = dedupeStrings([
    ...(weatherResult?.actions || []),
    ...(riskResult?.actions || []),
    ...(trajectoryResult?.actions || []),
  ]).join(" ");

  const sections: ChatResponse["sections"] = [
    { title: "Summary", content: summaryContent },
    { title: "Risks", content: riskContent },
    { title: "Drift Outlook", content: driftContent },
    {
      title: "Actionable Checks",
      content:
        actionContent ||
        "Verify latest METAR/TAF and local winds immediately before launch. Re-brief if conditions shift.",
    },
  ];

  const weatherSources: ChatResponse["sources"] = [
    {
      title: "Open-Meteo Forecast Data",
      url: "https://open-meteo.com/en/docs",
      type: "weather",
    },
    {
      title: "Aviation Weather Center",
      url: "https://aviationweather.gov/",
      type: "weather",
    },
    {
      title: "NWS API weather.gov",
      url: "https://www.weather.gov/documentation/services-web-api",
      type: "weather",
    },
    {
      title: "Derived Drift Interpretation",
      excerpt: "Interpretation based on available wind profile and short-horizon uncertainty.",
      type: "derived",
    },
  ];

  const sources = [...weatherSources, ...ragSnippetsToSources(ragSnippets)];
  const riskLevel = deriveRiskLevel(riskResult);

  const followUps =
    riskLevel === "high"
      ? [
          "Would you like a stricter no-launch threshold checklist for this window?",
          "Should I compare next 3 hours for a safer launch window?",
        ]
      : [
          "Do you want a launch-window comparison for the next 6 hours?",
          "Should I focus next on landing zone drift uncertainty?",
        ];

  const agentTrace: AgentName[] = ["coordinator", ...selectedAgents];
  const answer =
    `${firstSentence(summaryContent)} ${firstSentence(riskContent)} ${firstSentence(driftContent)}`.trim();

  return {
    answer,
    sections,
    riskLevel,
    agentTrace,
    sources: sources.slice(0, 10),
    followUps,
    generatedAt: new Date().toISOString(),
  };
}

