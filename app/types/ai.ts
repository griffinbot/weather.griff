export type AgentHint = "weather" | "risk" | "trajectory" | "auto";
export type SectionTitle = "Summary" | "Risks" | "Drift Outlook" | "Actionable Checks";
export type RiskLevel = "low" | "moderate" | "high" | "unknown";

export interface ChatMessageInput {
  role: "user" | "assistant";
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

export interface ChatSource {
  title: string;
  url?: string;
  excerpt?: string;
  type: "weather" | "rag" | "derived";
}

export interface ChatResponse {
  answer: string;
  sections: Array<{
    title: SectionTitle;
    content: string;
  }>;
  riskLevel: RiskLevel;
  agentTrace: Array<"coordinator" | "weather" | "risk" | "trajectory">;
  sources: ChatSource[];
  followUps: string[];
  generatedAt: string;
}

