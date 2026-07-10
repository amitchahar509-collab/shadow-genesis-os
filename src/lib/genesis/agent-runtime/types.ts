/** Shared types for agent runtime. */

export interface ToolContext {
  executionId: string;
  agent: string;
  sandboxRoot: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
}

export interface LlmResult {
  ok: boolean;
  text: string;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
}

/** Raw provider call result — token split so the router can estimate cost. */
export interface RawLlmResult { text: string; promptTokens: number; completionTokens: number }

export type LlmProvider = "anthropic" | "openrouter" | "gemini" | "ollama" | "zai" | "none";

/** Which single provider the legacy callLlm() uses (Anthropic-first). The multi-
 *  provider router (agent-runtime/router) considers all configured providers. */
export function pickProvider(): LlmProvider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OLLAMA_HOST) return "ollama";
  if (process.env.ZAI_API_KEY) return "zai";
  return "none";
}

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";
const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";

/** Anthropic Messages API (unchanged behaviour — the original adapter, now exported + token-split). */
export async function callAnthropic(opts: LlmOptions, timeoutMs: number): Promise<RawLlmResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? process.env.GENESIS_LLM_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ANTHROPIC_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  return { text, promptTokens: data.usage?.input_tokens ?? 0, completionTokens: data.usage?.output_tokens ?? 0 };
}

/** OpenRouter (OpenAI-compatible) — a second provider. Model id is provider-scoped, e.g. "anthropic/claude-opus-4". */
export async function callOpenRouter(opts: LlmOptions, timeoutMs: number): Promise<RawLlmResult> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!}`,
      "content-type": "application/json",
      "X-Title": "Shadow Genesis OS",
    },
    body: JSON.stringify({
      model: opts.model ?? OPENROUTER_DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.4,
      messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OPENROUTER_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 };
}

/** Google Gemini API (direct, generativelanguage.googleapis.com) — has a genuine
 *  FREE tier (AI Studio key, no card). Model names are the direct-API ids
 *  (e.g. "gemini-3.5-flash"), not OpenRouter slugs. */
export async function callGemini(opts: LlmOptions, timeoutMs: number): Promise<RawLlmResult> {
  const model = opts.model ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${process.env.GEMINI_API_KEY!}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 1500, temperature: opts.temperature ?? 0.4 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GEMINI_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return { text, promptTokens: data.usageMetadata?.promptTokenCount ?? 0, completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
}

/** Local Ollama (optional) — enabled by setting OLLAMA_HOST (e.g. http://127.0.0.1:11434).
 *  Fully offline, $0. Model comes from the hop / OLLAMA_MODEL (default llama3.2). */
export async function callOllama(opts: LlmOptions, timeoutMs: number): Promise<RawLlmResult> {
  const host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = (opts.model ?? process.env.OLLAMA_MODEL ?? "llama3.2").replace(/^ollama:/, "");
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false,
      messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
      options: { num_predict: opts.maxTokens ?? 1500, temperature: opts.temperature ?? 0.4 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OLLAMA_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  return { text: data.message?.content ?? "", promptTokens: data.prompt_eval_count ?? 0, completionTokens: data.eval_count ?? 0 };
}

export async function callZai(opts: LlmOptions, timeoutMs: number): Promise<RawLlmResult> {
  const ZAI = await import("z-ai-web-dev-sdk").catch(() => null);
  if (!ZAI || !ZAI.default) throw new Error("SDK_UNAVAILABLE");
  const sdk = await ZAI.default.create();
  const messages: ChatMessage[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.user }];
  const result = await Promise.race([
    sdk.chat.completions.create({ messages, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 1500, ...(opts.model ? { model: opts.model } : {}) }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM_TIMEOUT")), timeoutMs)),
  ]);
  const text = (result as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
  return { text, promptTokens: 0, completionTokens: 0 };
}

/** Safe LLM helper — provider-agnostic (Anthropic first, then z-ai), hard timeout, fail-fast.
 *  Preserved for backward compatibility; agents route through agent-runtime/router. */
export async function callLlm(opts: LlmOptions): Promise<LlmResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const provider = pickProvider();
  try {
    if (provider === "none") {
      try {
        const r = await callZai(opts, timeoutMs);
        if (r.text) return { ok: true, text: r.text, durationMs: Date.now() - start };
      } catch {}
      return { ok: false, text: "", error: "NO_LLM_PROVIDER: set ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OLLAMA_HOST or ZAI_API_KEY", durationMs: Date.now() - start };
    }
    const r = provider === "anthropic" ? await callAnthropic(opts, timeoutMs)
      : provider === "openrouter" ? await callOpenRouter(opts, timeoutMs)
      : provider === "gemini" ? await callGemini(opts, timeoutMs)
      : provider === "ollama" ? await callOllama(opts, timeoutMs)
      : await callZai(opts, timeoutMs);
    if (!r.text) return { ok: false, text: "", error: "EMPTY_RESPONSE", durationMs: Date.now() - start };
    const tokensUsed = r.promptTokens + r.completionTokens;
    return { ok: true, text: r.text, tokensUsed: tokensUsed || undefined, durationMs: Date.now() - start };
  } catch (e) {
    return { ok: false, text: "", error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
  }
}

export function parseJsonResponse(text: string): unknown | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}
