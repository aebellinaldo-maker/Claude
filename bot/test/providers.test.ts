import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

// --- Mock AI servers (Ollama native API + an OpenAI-compatible API) -------------------
const seen: { path: string; body: Record<string, unknown> }[] = [];
let ollamaReply = "";
let compatCalls = 0;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    seen.push({ path: req.url ?? "", body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/chat") {
      res.end(JSON.stringify({ message: { role: "assistant", content: ollamaReply }, prompt_eval_count: 1200, eval_count: 300 }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      compatCalls++;
      // Pretend this model doesn't support structured outputs: reject the first request.
      if (body.response_format) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "response_format not supported" } }));
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'Sure! Here is my answer:\n```json\n{"verdict":"avoid","risk":"extreme","summary":"Looks like a pump.","points":["a","b","c"]}\n```' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

// Config is read from the environment at import time, so set it before importing.
process.env.DATA_DIR = "./.test-data";
process.env.ANTHROPIC_API_KEY = "";
process.env.OLLAMA_URL = base;
process.env.OLLAMA_MODELS = "qwen-test:9b";
process.env.XAI_API_KEY = "test-key";
process.env.XAI_MODELS = "grok-test";
process.env.XAI_BASE_URL = `${base}/v1`;
process.env.XAI_PRICE_IN_USD = "2";
process.env.XAI_PRICE_OUT_USD = "6";

const { availableModels, resolveModel } = await import("../src/ai/models.ts");
const { extractJson, jsonSchemaFor, structuredChat } = await import("../src/ai/providers.ts");
const { aiDecide } = await import("../src/ai/claude.ts");
const { DEFAULT_SETTINGS } = await import("../src/store.ts");

const Opinion = z.object({
  verdict: z.enum(["bullish", "neutral", "bearish", "avoid"]),
  risk: z.enum(["low", "medium", "high", "extreme"]),
  summary: z.string(),
  points: z.array(z.string()),
});

test("extractJson copes with thinking tags, code fences and chatter", () => {
  assert.deepEqual(extractJson('<think>let me think {not json}</think>\n{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":2}\n```\nBye'), { a: 2 });
  assert.deepEqual(extractJson('Answer: {"a":{"b":3}} hope that helps'), { a: { b: 3 } });
  assert.throws(() => extractJson("no json here"));
});

test("jsonSchemaFor makes every object strict", () => {
  const js = jsonSchemaFor(z.object({ a: z.string(), b: z.array(z.object({ c: z.number() })) })) as any;
  assert.equal(js.additionalProperties, false);
  assert.deepEqual(js.required, ["a", "b"]);
  assert.equal(js.properties.b.items.additionalProperties, false);
  assert.equal(js.$schema, undefined);
});

test("models from the environment show up, free ones marked free", () => {
  const ids = availableModels().map((m) => m.id);
  assert.deepEqual(ids, ["ollama/qwen-test:9b", "xai/grok-test"]);
  assert.equal(availableModels()[0].free, true);
  assert.equal(availableModels()[1].free, false);
  // Settings still say claude-opus-5-5 (no key here) → falls back to the first available model.
  assert.equal(resolveModel({ ...DEFAULT_SETTINGS })?.id, "ollama/qwen-test:9b");
});

test("Ollama: sends schema + bigger context window, parses reply after <think>", async () => {
  ollamaReply = '<think>hmm</think>{"verdict":"bullish","risk":"high","summary":"Strong volume.","points":["x"]}';
  const m = availableModels().find((x) => x.provider === "ollama")!;
  const r = await structuredChat(m, "sys", "user", Opinion);
  assert.equal(r.data?.verdict, "bullish");
  assert.equal(r.usd, 0);
  const req = seen.find((s) => s.path === "/api/chat")!.body as any;
  assert.equal(req.model, "qwen-test:9b");
  assert.equal(req.stream, false);
  assert.equal("think" in req, false); // only sent when OLLAMA_THINK is set
  assert.equal(req.options.num_ctx, 16384);
  assert.equal(req.format.type, "object");
});

test("OpenAI-compatible (Grok): falls back to prompt-JSON when structured output is rejected, and prices tokens", async () => {
  const m = availableModels().find((x) => x.provider === "xai")!;
  const r = await structuredChat(m, "sys", "user", Opinion);
  assert.equal(compatCalls, 2);
  assert.equal(r.data?.verdict, "avoid");
  assert.equal(r.usd, (1000 * 2 + 200 * 6) / 1_000_000);
});

test("Ollama: a malformed answer gives null data instead of a crash", async () => {
  ollamaReply = '{"verdict":"to the moon"}';
  const m = availableModels().find((x) => x.provider === "ollama")!;
  const r = await structuredChat(m, "sys", "user", Opinion);
  assert.equal(r.data, null);
  assert.ok(r.error);
});

test("full trading decision through a local Ollama model", async () => {
  ollamaReply = JSON.stringify({
    market_view: "Mixed market.",
    buys: [{ mint: "MINT1", action: "buy", confidence: 1.7, size_pct: 10, reason: "Strong buyers." }],
    exits: [{ mint: "MINT2", action: "sell", sell_pct: 150, reason: "Momentum gone." }],
  });
  const d = await aiDecide(
    {
      candidates: [],
      positions: [],
      freeSlots: 2,
      cashEur: 10,
      equityEur: 10,
      dailyPnlPct: 0,
      recentTrades: [],
    },
    { ...DEFAULT_SETTINGS },
  );
  assert.ok(d);
  // Out-of-range numbers from a small model are clamped to safe values.
  assert.equal(d!.buys[0].confidence, 1);
  assert.equal(d!.buys[0].sizePct, 25);
  assert.equal(d!.exits[0].sellPct, 100);
});
