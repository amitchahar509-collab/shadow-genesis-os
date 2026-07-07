/** Environment variable validation. */

export interface EnvCheck {
  name: string;
  required: boolean;
  set: boolean;
  value: string | null;
  message: string;
}

export function validateEnv(): EnvCheck[] {
  const checks: EnvCheck[] = [
    { name: "DATABASE_URL", required: true, set: Boolean(process.env.DATABASE_URL), value: process.env.DATABASE_URL ?? null, message: "Required for Prisma database connection" },
    { name: "ANTHROPIC_API_KEY", required: false, set: Boolean(process.env.ANTHROPIC_API_KEY), value: process.env.ANTHROPIC_API_KEY ? "[set]" : null, message: "Optional — preferred LLM provider (Claude). Without any LLM key, agents use rule-based fallbacks." },
    { name: "GENESIS_LLM_MODEL", required: false, set: Boolean(process.env.GENESIS_LLM_MODEL), value: process.env.GENESIS_LLM_MODEL ?? null, message: "Optional — Anthropic model id override (default claude-sonnet-5)" },
    { name: "ZAI_API_KEY", required: false, set: Boolean(process.env.ZAI_API_KEY), value: process.env.ZAI_API_KEY ? "[set]" : null, message: "Optional — fallback LLM provider (z-ai). Without any LLM key, agents use rule-based fallbacks." },
    { name: "NEXTAUTH_SECRET", required: false, set: Boolean(process.env.NEXTAUTH_SECRET), value: process.env.NEXTAUTH_SECRET ? "[set]" : null, message: "Optional — required for user authentication in production" },
    { name: "PORT", required: false, set: Boolean(process.env.PORT), value: process.env.PORT ?? null, message: "Optional — defaults to 3000" },
  ];
  return checks;
}

export function isHealthy(): { ok: boolean; missing: string[] } {
  const checks = validateEnv();
  const missing = checks.filter((c) => c.required && !c.set).map((c) => c.name);
  return { ok: missing.length === 0, missing };
}
