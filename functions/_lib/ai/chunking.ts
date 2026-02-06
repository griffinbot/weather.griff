function compactWhitespace(input: string): string {
  return input.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function readableTitleFromKey(key: string): string {
  const last = key.split("/").filter(Boolean).pop() || key;
  return last.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
}

export function docIdFromKey(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) + hash) + key.charCodeAt(i);
  }
  return `doc_${Math.abs(hash >>> 0).toString(16)}`;
}

function extractLikelyPdfText(raw: string): string {
  const matches = raw.match(/[A-Za-z0-9][A-Za-z0-9 ,.;:()/%+\-'"!?]{20,}/g) || [];
  return compactWhitespace(matches.join("\n"));
}

export async function extractTextFromR2Object(
  object: any,
  key: string,
): Promise<{ title: string; text: string }> {
  const title = readableTitleFromKey(key);
  const contentType = String(object?.httpMetadata?.contentType || "").toLowerCase();
  const buffer = await object.arrayBuffer();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const raw = decoder.decode(buffer);

  if (key.toLowerCase().endsWith(".json") || contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return { title, text: compactWhitespace(JSON.stringify(parsed)) };
    } catch {
      return { title, text: compactWhitespace(raw) };
    }
  }

  if (key.toLowerCase().endsWith(".pdf") || contentType.includes("application/pdf")) {
    return { title, text: extractLikelyPdfText(raw) };
  }

  return { title, text: compactWhitespace(raw) };
}

export function chunkText(
  text: string,
  options?: { chunkSize?: number; overlap?: number },
): string[] {
  const cleaned = compactWhitespace(text);
  if (!cleaned) return [];

  const chunkSize = Math.max(200, Math.min(options?.chunkSize ?? 1_000, 2_000));
  const overlap = Math.max(0, Math.min(options?.overlap ?? 150, 400));

  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const roughEnd = Math.min(start + chunkSize, cleaned.length);
    let end = roughEnd;
    if (roughEnd < cleaned.length) {
      const lastPeriod = cleaned.lastIndexOf(". ", roughEnd);
      const lastBreak = cleaned.lastIndexOf("\n", roughEnd);
      end = Math.max(lastPeriod > start + 350 ? lastPeriod + 1 : 0, lastBreak > start + 350 ? lastBreak : 0) || roughEnd;
    }
    const piece = cleaned.slice(start, end).trim();
    if (piece.length > 80) chunks.push(piece);
    if (end >= cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

