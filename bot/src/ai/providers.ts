/**
 * Non-Claude AI brains: Ollama (native API, local or cloud) and OpenAI-compatible
 * APIs (OpenRouter, xAI Grok). They answer with JSON that we validate with zod,
 * exactly like the Claude path, so the rest of the bot doesn't care which is used.
 */
import { z } from "zod";
import { config } from "../config.js";
import type { ModelInfo } from "./models.js";
import { costUsd } from "./models.js";

export interface ImageInput {
  /** Base64 data without the "data:" prefix. */
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface StructuredResult<T> {
  data: T | null;
  usd: number;
  inTokens: number;
  outTokens: number;
  error?: string;
}

/** JSON Schema for a zod schema, tightened for "strict" structured-output APIs. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  const tighten = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object" && n.properties && typeof n.properties === "object") {
      n.additionalProperties = false;
      n.required = Object.keys(n.properties as object);
      for (const v of Object.values(n.properties as object)) tighten(v);
    }
    if (n.items) tighten(n.items);
  };
  tighten(js);
  return js;
}

/**
 * Pulls the JSON object out of a model reply. Handles <think>…</think> blocks,
 * ```json fences and chatter before/after the object.
 */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("No JSON object in the model's reply");
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

function validate<T>(schema: z.ZodType<T>, text: string): { data: T | null; error?: string } {
  try {
    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) return { data: parsed.data };
    return { data: null, error: `Reply didn't match the expected format: ${parsed.error.issues[0]?.message ?? "?"}` };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------- Ollama

async function ollamaChat<T>(m: ModelInfo, system: string, user: string, schema: z.ZodType<T>, image?: ImageInput): Promise<StructuredResult<T>> {
  const o = config.ollama;
  const res = await postJson(
    `${o.url.replace(/\/+$/, "")}/api/chat`,
    {
      model: m.name,
      stream: false,
      ...(o.think !== undefined ? { think: o.think } : {}),
      format: jsonSchemaFor(schema),
      // Ollama's default context window is small; our prompts need more or they get cut off silently.
      options: { num_ctx: o.numCtx, temperature: 0.2 },
      messages: [
        { role: "system", content: system },
        // Vision models (e.g. Gemma 3, Qwen-VL, LLaVA) read images passed here.
        { role: "user", content: user, ...(image ? { images: [image.base64] } : {}) },
      ],
    },
    o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {},
    // A local model on a free CPU server can take several minutes.
    15 * 60_000,
  );
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  const body = JSON.parse(res.text) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  const inTokens = body.prompt_eval_count ?? 0;
  const outTokens = body.eval_count ?? 0;
  const v = validate(schema, body.message?.content ?? "");
  return { ...v, inTokens, outTokens, usd: costUsd(m, inTokens, outTokens) };
}

// ---------------------------------------------------------------- OpenAI-compatible (OpenRouter, xAI)

const OPENAI_COMPAT: Record<"openrouter" | "xai", { base: () => string; key: () => string | undefined }> = {
  openrouter: { base: () => config.openrouter.baseUrl, key: () => config.openrouter.apiKey },
  xai: { base: () => config.xai.baseUrl, key: () => config.xai.apiKey },
};

async function openAiCompatChat<T>(
  m: ModelInfo & { provider: "openrouter" | "xai" },
  system: string,
  user: string,
  schema: z.ZodType<T>,
  image?: ImageInput,
): Promise<StructuredResult<T>> {
  const p = OPENAI_COMPAT[m.provider];
  const headers = { authorization: `Bearer ${p.key() ?? ""}` };
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: image
        ? [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
          ]
        : user,
    },
  ];
  const schemaJson = jsonSchemaFor(schema);

  let res = await postJson(
    `${p.base()}/chat/completions`,
    {
      model: m.name,
      messages,
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: schemaJson } },
    },
    headers,
    5 * 60_000,
  );
  // Some models don't support structured outputs: ask for JSON in the prompt instead.
  if (res.status === 400 || res.status === 422) {
    res = await postJson(
      `${p.base()}/chat/completions`,
      {
        model: m.name,
        messages: [
          ...messages,
          {
            role: "user",
            content: `Reply with ONLY one JSON object (no other text) that matches this JSON Schema:\n${JSON.stringify(schemaJson)}`,
          },
        ],
      },
      headers,
      5 * 60_000,
    );
  }
  if (!res.ok) throw new Error(`${m.provider} HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  const body = JSON.parse(res.text) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const inTokens = body.usage?.prompt_tokens ?? 0;
  const outTokens = body.usage?.completion_tokens ?? 0;
  const v = validate(schema, body.choices?.[0]?.message?.content ?? "");
  return { ...v, inTokens, outTokens, usd: costUsd(m, inTokens, outTokens) };
}

export async function structuredChat<T>(
  m: ModelInfo,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  image?: ImageInput,
): Promise<StructuredResult<T>> {
  if (m.provider === "ollama") return ollamaChat(m, system, user, schema, image);
  if (m.provider === "openrouter" || m.provider === "xai") {
    return openAiCompatChat(m as ModelInfo & { provider: "openrouter" | "xai" }, system, user, schema, image);
  }
  throw new Error(`structuredChat does not handle ${m.provider}`);
}
