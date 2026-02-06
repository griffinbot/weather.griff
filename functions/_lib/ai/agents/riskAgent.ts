import { openAIChatJSON } from "../openai";
import type { AgentResult, LiveWeatherContext, RagSnippet, RiskLevel } from "../types";
import type { Env } from "../../rateLimiter";

interface RiskAgentInput {
  env: Env;
  question: string;
  location: { name: string; airport: string };
  liveWeather: LiveWeatherContext;
  ragSnippets: RagSnippet[];
  conversationSummary: string;
}

interface RiskAgentModelOutput {
  summary: string;
  actions: string[];
  confidence: "low" | "medium" | "high";
  riskLevel: RiskLevel;
}

function fallbackRiskLevel(liveWeather: LiveWeatherContext): RiskLevel {
  const current = liveWeather.openMeteoCurrent;
  if (!current) return "unknown";
  const wind = Number(current.wind_speed_10m || 0);
  const gust = Number(current.wind_gusts_10m || 0);
  const cloud = Number(current.cloud_cover || 0);
  if (gust >= 25 || wind >= 18) return "high";
  if (gust >= 18 || wind >= 12 || cloud >= 90) return "moderate";
  return "low";
}

function fallbackSummary(input: RiskAgentInput): AgentResult {
  const level = fallbackRiskLevel(input.liveWeather);
  const riskText =
    level === "high"
      ? "Elevated wind risk for balloon operations. Conservative launch/no-launch decision gates are advised."
      : level === "moderate"
      ? "Moderate operational risk with potentially narrow launch windows."
      : level === "low"
      ? "No dominant hazard detected from current snapshot, but standard conservative checks remain required."
      : "Risk level is uncertain due to incomplete weather context.";
  return {
    agent: "risk",
    summary: riskText,
    actions: [
      "Validate launch criteria against your local SOP and current observations.",
      "Treat this as advisory only and re-brief immediately before launch.",
    ],
    confidence: level === "unknown" ? "low" : "medium",
    riskLevel: level,
  };
}

export async function runRiskAgent(input: RiskAgentInput): Promise<AgentResult> {
  try {
    const current = input.liveWeather.openMeteoCurrent;
    const ragContext = input.ragSnippets
      .slice(0, 4)
      .map((item, index) => `${index + 1}. ${item.title}/${item.section}: ${item.text.slice(0, 240)}`)
      .join("\n");

    const model = await openAIChatJSON<RiskAgentModelOutput>(input.env, {
      systemPrompt:
        "You are the Balloon Risk Analyst agent. " +
        "Return JSON only with keys: summary, actions, confidence, riskLevel. " +
        "riskLevel must be one of: low, moderate, high, unknown. " +
        "Use conservative advisory language and never issue definitive go/no-go commands.",
      userPrompt:
        `Question: ${input.question}\n` +
        `Location: ${input.location.name} (${input.location.airport})\n` +
        `Conversation summary: ${input.conversationSummary}\n` +
        `Current weather snapshot: ${JSON.stringify(current || {})}\n` +
        `Ballooning reference snippets:\n${ragContext || "none"}`,
      maxTokens: 420,
      temperature: 0.15,
    });

    const riskLevel =
      model.riskLevel === "low" ||
      model.riskLevel === "moderate" ||
      model.riskLevel === "high" ||
      model.riskLevel === "unknown"
        ? model.riskLevel
        : fallbackRiskLevel(input.liveWeather);

    return {
      agent: "risk",
      summary: model.summary?.trim() || fallbackSummary(input).summary,
      actions: Array.isArray(model.actions) ? model.actions.slice(0, 5) : fallbackSummary(input).actions,
      confidence:
        model.confidence === "low" || model.confidence === "high" || model.confidence === "medium"
          ? model.confidence
          : "medium",
      riskLevel,
    };
  } catch {
    return fallbackSummary(input);
  }
}

