import type { Env } from "../rateLimiter";

export type AgentName = "coordinator" | "weather" | "risk" | "trajectory";
export type AgentHint = "weather" | "risk" | "trajectory" | "auto";
export type MessageRole = "user" | "assistant";
export type SectionTitle = "Summary" | "Risks" | "Drift Outlook" | "Actionable Checks";
export type SourceType = "weather" | "rag" | "derived";
export type RiskLevel = "low" | "moderate" | "high" | "unknown";

export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_QUESTION_CHARS = 2_000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_INPUT_TOKENS_APPROX = 10_000;

export interface ChatMessageInput {
  role: MessageRole;
  content: string;
  ts?: string;
}

export interface ChatRequest {
  sessionId: string;
  location: {
    name: string;
    airport: string;
    lat: number;
    lon: number;
  };
  messages: ChatMessageInput[];
  userQuestion: string;
  options?: {
    maxTokens?: number;
    agentHint?: AgentHint;
  };
}

export interface ChatSection {
  title: SectionTitle;
  content: string;
}

export interface ChatSource {
  title: string;
  url?: string;
  excerpt?: string;
  type: SourceType;
}

export interface ChatResponse {
  answer: string;
  sections: ChatSection[];
  riskLevel: RiskLevel;
  agentTrace: AgentName[];
  sources: ChatSource[];
  followUps: string[];
  generatedAt: string;
}

export interface IndexRequest {
  prefix?: string;
  maxDocs?: number;
  dryRun?: boolean;
}

export interface RagSnippet {
  id: string;
  score: number;
  title: string;
  section: string;
  sourcePath: string;
  text: string;
}

export interface AgentResult {
  agent: Exclude<AgentName, "coordinator">;
  summary: string;
  actions: string[];
  confidence: "low" | "medium" | "high";
  riskLevel?: RiskLevel;
}

export interface LiveWeatherContext {
  openMeteoCurrent: any | null;
  openMeteoHourly: any | null;
  openMeteoDaily: any | null;
  windsAloft: any | null;
  metar: any | null;
  taf: any | null;
  points: any | null;
}

export interface OrchestratorContext {
  request: ChatRequest;
  env: Env;
  liveWeather: LiveWeatherContext;
  ragSnippets: RagSnippet[];
}

