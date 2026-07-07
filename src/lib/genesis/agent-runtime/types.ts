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

export type LlmProvider = "anthropic" | "zai" | "none";

/** Which LLM provider is usable with the current environment. */
export function pickProvider(): LlmProvider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.ZAI_API_KEY) return "zai";
  return "none";
}

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

async function callAnthropic(opts: LlmOptions, timeoutMs: number): Promise<{ text: string; tokensUsed?: number }> {
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
  const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
  return { text, tokensUsed: tokensUsed || undefined };
}

async function callZai(opts: LlmOptions, timeoutMs: number): Promise<{ text: string; tokensUsed?: number }> {
  const ZAI = await import("z-ai-web-dev-sdk").catch(() => null);
  if (!ZAI || !ZAI.default) throw new Error("SDK_UNAVAILABLE");
  const sdk = await ZAI.default.create();
  const messages: ChatMessage[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.user }];
  const result = await Promise.race([
    sdk.chat.completions.create({ messages, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 1500, ...(opts.model ? { model: opts.model } : {}) }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM_TIMEOUT")), timeoutMs)),
  ]);
  const text = (result as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
  return { text };
}

/** Safe LLM helper — provider-agnostic (Anthropic first, then z-ai), hard timeout, fail-fast. */
export async function callLlm(opts: LlmOptions): Promise<LlmResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const provider = pickProvider();
  try {
    if (provider === "none") {
      // Try the z-ai SDK anyway — in its original hosted environment it works without an env key.
      try {
        const r = await callZai(opts, timeoutMs);
        if (r.text) return { ok: true, text: r.text, durationMs: Date.now() - start };
      } catch {}
      return { ok: false, text: "", error: "NO_LLM_PROVIDER: set ANTHROPIC_API_KEY or ZAI_API_KEY", durationMs: Date.now() - start };
    }
    const r = provider === "anthropic" ? await callAnthropic(opts, timeoutMs) : await callZai(opts, timeoutMs);
    if (!r.text) return { ok: false, text: "", error: "EMPTY_RESPONSE", durationMs: Date.now() - start };
    return { ok: true, text: r.text, tokensUsed: r.tokensUsed, durationMs: Date.now() - start };
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
