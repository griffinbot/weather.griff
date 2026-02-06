import { chunkText, docIdFromKey, extractTextFromR2Object } from "../../_lib/ai/chunking";
import { openAIEmbedTexts } from "../../_lib/ai/openai";
import { HttpError, jsonError, requireEnvVar, withCors } from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface IndexBody {
  prefix?: string;
  maxDocs?: number;
  dryRun?: boolean;
}

interface VectorRecord {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function chunked<T>(arr: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < arr.length; index += size) {
    output.push(arr.slice(index, index + size));
  }
  return output;
}

function parseBody(raw: any): Required<IndexBody> {
  return {
    prefix: typeof raw?.prefix === "string" && raw.prefix.trim() ? raw.prefix.trim() : "ballooning/",
    maxDocs: clamp(Number(raw?.maxDocs || 25), 1, 200),
    dryRun: Boolean(raw?.dryRun),
  };
}

function requireBearerToken(request: Request, env: Env): void {
  const expected = requireEnvVar(env.AI_INDEX_ADMIN_TOKEN, "AI_INDEX_ADMIN_TOKEN");
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token.");
  const provided = auth.slice("Bearer ".length).trim();
  if (!provided || provided !== expected) throw new HttpError(403, "Invalid bearer token.");
}

async function listR2Keys(
  bucket: any,
  prefix: string,
  maxDocs: number,
): Promise<Array<{ key: string; uploaded?: string }>> {
  const keys: Array<{ key: string; uploaded?: string }> = [];
  let cursor: string | undefined;

  while (keys.length < maxDocs) {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: Math.min(100, maxDocs - keys.length),
    });
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    for (const object of objects) {
      keys.push({
        key: String(object.key),
        uploaded: object.uploaded ? new Date(object.uploaded).toISOString() : undefined,
      });
      if (keys.length >= maxDocs) break;
    }
    if (!page?.truncated) break;
    cursor = page.cursor;
    if (!cursor) break;
  }
  return keys;
}

async function upsertVectorRecords(index: any, records: VectorRecord[]): Promise<void> {
  if (records.length === 0) return;
  if (typeof index?.upsert !== "function") {
    throw new HttpError(500, "Vector index binding missing upsert.");
  }
  for (const batch of chunked(records, 64)) {
    await index.upsert(batch);
  }
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    requireBearerToken(request, env);
    const bucket = env.BALLOONING_DOCS_BUCKET as any;
    const index = env.BALLOONING_VECTOR_INDEX as any;
    if (!bucket || typeof bucket.list !== "function" || typeof bucket.get !== "function") {
      throw new HttpError(500, "BALLOONING_DOCS_BUCKET binding is not configured.");
    }
    if (!index) {
      throw new HttpError(500, "BALLOONING_VECTOR_INDEX binding is not configured.");
    }

    let parsedBody: Required<IndexBody>;
    try {
      const body = (await request.json()) as IndexBody;
      parsedBody = parseBody(body);
    } catch {
      parsedBody = parseBody({});
    }

    const entries = await listR2Keys(bucket, parsedBody.prefix, parsedBody.maxDocs);
    const skipped: Array<{ key: string; reason: string }> = [];
    let docsProcessed = 0;
    let chunksIndexed = 0;
    let vectorsUpserted = 0;

    for (const entry of entries) {
      const object = await bucket.get(entry.key);
      if (!object) {
        skipped.push({ key: entry.key, reason: "Object not found." });
        continue;
      }

      const extracted = await extractTextFromR2Object(object, entry.key);
      if (!extracted.text || extracted.text.length < 80) {
        skipped.push({ key: entry.key, reason: "Insufficient text content." });
        continue;
      }

      const chunks = chunkText(extracted.text, { chunkSize: 1_000, overlap: 140 }).slice(0, 40);
      if (chunks.length === 0) {
        skipped.push({ key: entry.key, reason: "No valid chunks extracted." });
        continue;
      }

      docsProcessed += 1;
      chunksIndexed += chunks.length;
      if (parsedBody.dryRun) continue;

      const embeddings: number[][] = [];
      for (const textBatch of chunked(chunks, 32)) {
        const batchEmbeddings = await openAIEmbedTexts(env, textBatch);
        embeddings.push(...batchEmbeddings);
      }

      const docId = docIdFromKey(entry.key);
      const records: VectorRecord[] = chunks.map((chunk, idx) => ({
        id: `${docId}:${idx}`,
        values: embeddings[idx],
        metadata: {
          docId,
          title: extracted.title,
          section: `chunk-${idx + 1}`,
          sourcePath: entry.key,
          updatedAt: entry.uploaded || new Date().toISOString(),
          text: chunk.slice(0, 800),
        },
      }));

      await upsertVectorRecords(index, records);
      vectorsUpserted += records.length;
    }

    return withCors(
      Response.json(
        {
          ok: true,
          dryRun: parsedBody.dryRun,
          prefix: parsedBody.prefix,
          maxDocs: parsedBody.maxDocs,
          docsDiscovered: entries.length,
          docsProcessed,
          chunksIndexed,
          vectorsUpserted,
          skipped: skipped.slice(0, 100),
        },
        { status: 200 },
      ),
      request,
      env,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "AI index job failed.", request, env);
  }
}

