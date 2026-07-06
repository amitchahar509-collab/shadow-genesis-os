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

/** Safe LLM helper — hard timeout, fail-fast fallback. */
export async function callLlm(opts: LlmOptions): Promise<LlmResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8_000;
  try {
    const ZAI = await import("z-ai-web-dev-sdk").catch(() => null);
    if (!ZAI || !ZAI.default) return { ok: false, text: "", error: "SDK_UNAVAILABLE", durationMs: Date.now() - start };
    const sdk = await ZAI.default.create();
    const messages: ChatMessage[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.user }];
    const result = await Promise.race([
      sdk.chat.completions.create({ messages, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 1500, ...(opts.model ? { model: opts.model } : {}) }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("LLM_TIMEOUT")), timeoutMs)),
    ]);
    const text = (result as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
    if (!text) return { ok: false, text: "", error: "EMPTY_RESPONSE", durationMs: Date.now() - start };
    return { ok: true, text, durationMs: Date.now() - start };
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
