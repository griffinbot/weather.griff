import { openAIChatJSON } from "../openai";
import type { AgentResult, LiveWeatherContext, RagSnippet } from "../types";
import type { Env } from "../../rateLimiter";

interface WeatherAgentInput {
  env: Env;
  question: string;
  location: { name: string; airport: string };
  liveWeather: LiveWeatherContext;
  ragSnippets: RagSnippet[];
  conversationSummary: string;
}

interface WeatherAgentModelOutput {
  summary: string;
  actions: string[];
  confidence: "low" | "medium" | "high";
}

function buildWeatherSnapshot(liveWeather: LiveWeatherContext): string {
  const current = liveWeather.openMeteoCurrent;
  if (!current) return "Current weather unavailable.";
  const temp = current?.temperature_2m;
  const wind = current?.wind_speed_10m;
  const gust = current?.wind_gusts_10m;
  const direction = current?.wind_direction_10m;
  const cloud = current?.cloud_cover;
  const precip = current?.precipitation;
  return `Current: temp=${temp}F, wind=${wind}kt, gust=${gust}kt, direction=${direction}deg, cloud=${cloud}%, precip=${precip}in.`;
}

function fallbackSummary(input: WeatherAgentInput): AgentResult {
  const current = input.liveWeather.openMeteoCurrent;
  if (!current) {
    return {
      agent: "weather",
      summary: `Live weather data for ${input.location.airport} is currently unavailable.`,
      actions: [
        "Refresh weather feeds and verify METAR before launch.",
        "Delay briefing until current observation data is available.",
      ],
      confidence: "low",
    };
  }
  return {
    agent: "weather",
    summary:
      `At ${input.location.airport}, temperature is ${current.temperature_2m}F with winds ` +
      `${current.wind_direction_10m}deg at ${current.wind_speed_10m}kt (gust ${current.wind_gusts_10m}kt). ` +
      `Cloud cover is ${current.cloud_cover}% and precipitation is ${current.precipitation}in.`,
    actions: [
      "Compare surface and low-level winds before launch window.",
      "Cross-check with latest METAR/TAF and local observation trends.",
    ],
    confidence: "medium",
  };
}

export async function runWeatherAgent(input: WeatherAgentInput): Promise<AgentResult> {
  try {
    const ragContext = input.ragSnippets
      .slice(0, 3)
      .map((item, index) => `${index + 1}. ${item.title}/${item.section}: ${item.text.slice(0, 220)}`)
      .join("\n");

    const model = await openAIChatJSON<WeatherAgentModelOutput>(input.env, {
      systemPrompt:
        "You are the Weather Summarizer agent for a ballooning assistant. " +
        "Return JSON only with keys: summary (string), actions (string[] max 4), confidence (low|medium|high). " +
        "Keep the summary operational and concise. Do not issue hard go/no-go commands.",
      userPrompt:
        `Question: ${input.question}\n` +
        `Location: ${input.location.name} (${input.location.airport})\n` +
        `Conversation summary: ${input.conversationSummary}\n` +
        `Weather snapshot: ${buildWeatherSnapshot(input.liveWeather)}\n` +
        `Relevant ballooning references:\n${ragContext || "none"}`,
      maxTokens: 420,
      temperature: 0.2,
    });

    return {
      agent: "weather",
      summary: model.summary?.trim() || fallbackSummary(input).summary,
      actions: Array.isArray(model.actions) ? model.actions.slice(0, 4) : fallbackSummary(input).actions,
      confidence:
        model.confidence === "low" || model.confidence === "high" || model.confidence === "medium"
          ? model.confidence
          : "medium",
    };
  } catch {
    return fallbackSummary(input);
  }
}

