import type { ChatSource, RagSnippet } from "./types";
import type { Env } from "../rateLimiter";
import { openAIEmbedTexts } from "./openai";

function toVectorIndex(env: Env): any {
  return env.BALLOONING_VECTOR_INDEX as any;
}

function toSnippet(match: any): RagSnippet {
  const metadata = (match?.metadata || {}) as Record<string, unknown>;
  const text = String(metadata.text || metadata.excerpt || "").trim();
  return {
    id: String(match?.id || metadata.docId || "unknown"),
    score: Number.isFinite(match?.score) ? Number(match.score) : 0,
    title: String(metadata.title || "Ballooning Reference"),
    section: String(metadata.section || "General"),
    sourcePath: String(metadata.sourcePath || metadata.docId || ""),
    text,
  };
}

export async function retrieveBallooningSnippets(
  env: Env,
  question: string,
  topK = 6,
): Promise<RagSnippet[]> {
  if (!env.OPENAI_API_KEY) return [];
  const index = toVectorIndex(env);
  if (!index || typeof index.query !== "function") return [];

  try {
    const [vector] = await openAIEmbedTexts(env, [question]);
    if (!vector || vector.length === 0) return [];

    const queryResult = await index.query(vector, {
      topK: Math.max(1, Math.min(topK, 10)),
      returnMetadata: "all",
    });

    const matches = Array.isArray(queryResult?.matches) ? queryResult.matches : [];
    return matches
      .map(toSnippet)
      .filter((item) => item.text.length > 0)
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

export function ragSnippetsToSources(snippets: RagSnippet[]): ChatSource[] {
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const snippet of snippets) {
    const key = `${snippet.title}:${snippet.section}:${snippet.sourcePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      title: `${snippet.title} (${snippet.section})`,
      excerpt: snippet.text.slice(0, 220),
      type: "rag",
    });
  }
  return sources;
}
