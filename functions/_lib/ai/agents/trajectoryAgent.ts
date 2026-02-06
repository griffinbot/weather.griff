import { openAIChatJSON } from "../openai";
import type { AgentResult, LiveWeatherContext, RagSnippet } from "../types";
import type { Env } from "../../rateLimiter";

interface TrajectoryAgentInput {
  env: Env;
  question: string;
  location: { name: string; airport: string };
  liveWeather: LiveWeatherContext;
  ragSnippets: RagSnippet[];
  conversationSummary: string;
}

interface TrajectoryModelOutput {
  summary: string;
  actions: string[];
  confidence: "low" | "medium" | "high";
}

function buildWindAloftSummary(liveWeather: LiveWeatherContext): string {
  const aloft = liveWeather.windsAloft?.hourly || null;
  if (!aloft || !Array.isArray(aloft.time) || aloft.time.length === 0) {
    return "No winds-aloft profile available; using only surface wind context.";
  }

  const levels = [
    { speed: "wind_speed_1000hPa", dir: "wind_direction_1000hPa", label: "1000hPa" },
    { speed: "wind_speed_925hPa", dir: "wind_direction_925hPa", label: "925hPa" },
    { speed: "wind_speed_850hPa", dir: "wind_direction_850hPa", label: "850hPa" },
  ];

  const parts: string[] = [];
  for (const level of levels) {
    const speed = Number(aloft[level.speed]?.[0]);
    const direction = Number(aloft[level.dir]?.[0]);
    if (Number.isFinite(speed) && Number.isFinite(direction)) {
      parts.push(`${level.label}: ${direction}deg at ${speed}kt`);
    }
  }

  if (parts.length === 0) {
    const surfaceSpeed = Number(aloft.wind_speed_10m?.[0]);
    const surfaceDir = Number(aloft.wind_direction_10m?.[0]);
    if (Number.isFinite(surfaceSpeed) && Number.isFinite(surfaceDir)) {
      return `Surface proxy: ${surfaceDir}deg at ${surfaceSpeed}kt.`;
    }
    return "No winds-aloft profile available; using only qualitative drift guidance.";
  }
  return parts.join(" | ");
}

function fallbackSummary(input: TrajectoryAgentInput): AgentResult {
  return {
    agent: "trajectory",
    summary:
      `Drift outlook for ${input.location.airport}: ${buildWindAloftSummary(input.liveWeather)} ` +
      "Expect trajectory uncertainty to increase with altitude and time horizon.",
    actions: [
      "Run a short-horizon drift check (15-30 min) before launch.",
      "Re-evaluate at launch site with observed winds and pilot balloon if available.",
    ],
    confidence: "medium",
  };
}

export async function runTrajectoryAgent(input: TrajectoryAgentInput): Promise<AgentResult> {
  try {
    const ragContext = input.ragSnippets
      .slice(0, 3)
      .map((item, index) => `${index + 1}. ${item.title}/${item.section}: ${item.text.slice(0, 180)}`)
      .join("\n");

    const model = await openAIChatJSON<TrajectoryModelOutput>(input.env, {
      systemPrompt:
        "You are the Trajectory/Drift Analyst agent for balloon operations. " +
        "Return JSON only with keys: summary, actions, confidence. " +
        "Do not claim exact trajectory certainty. Emphasize uncertainty and conservative planning.",
      userPrompt:
        `Question: ${input.question}\n` +
        `Location: ${input.location.name} (${input.location.airport})\n` +
        `Conversation summary: ${input.conversationSummary}\n` +
        `Wind profile: ${buildWindAloftSummary(input.liveWeather)}\n` +
        `Relevant references:\n${ragContext || "none"}`,
      maxTokens: 380,
      temperature: 0.2,
    });

    return {
      agent: "trajectory",
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

