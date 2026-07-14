/** Operator App Config (V10.1 app layer).
 *
 * Lets a non-technical operator configure Genesis from the UI instead of editing
 * .env by hand. Saved keys persist to a GITIGNORED local file and are also applied
 * to process.env immediately, so provider/connector checks (which read
 * process.env at call time) pick them up without a restart.
 *
 * Security: only an ALLOWLISTED set of keys can be written (no arbitrary env
 * injection). Raw values are NEVER returned — status is masked. The config file
 * is git-ignored and never committed.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

const CONFIG_PATH = path.resolve(process.cwd(), ".genesis-config.json");

/** The only keys the operator UI may set — grouped for the Settings panel. */
export const CONFIG_GROUPS: { group: string; keys: { key: string; label: string; secret: boolean; hint: string }[] }[] = [
  { group: "AI Providers", keys: [
    { key: "OPENROUTER_API_KEY", label: "OpenRouter", secret: true, hint: "Multi-provider router (qwen/deepseek/llama, premium models)" },
    { key: "GEMINI_API_KEY", label: "Google Gemini", secret: true, hint: "Free tier — works without a card" },
    { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", secret: true, hint: "Direct Claude access" },
    { key: "OPENAI_API_KEY", label: "OpenAI", secret: true, hint: "Direct OpenAI access" },
    { key: "ZAI_API_KEY", label: "Z.ai", secret: true, hint: "Fallback provider" },
    { key: "PREMIUM_MODE", label: "Premium mode", secret: false, hint: "'true' to allow paid models (default: free-only)" },
    { key: "GENESIS_LLM_MODEL", label: "Default model id", secret: false, hint: "Optional override" },
  ] },
  { group: "Deployment", keys: [
    { key: "VERCEL_TOKEN", label: "Vercel", secret: true, hint: "Next.js / static host" },
    { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare", secret: true, hint: "Pages / Workers" },
    { key: "RAILWAY_TOKEN", label: "Railway", secret: true, hint: "Container host" },
    { key: "RENDER_API_KEY", label: "Render", secret: true, hint: "Web-service host" },
  ] },
  { group: "Action Connectors", keys: [
    { key: "GITHUB_TOKEN", label: "GitHub", secret: true, hint: "Issues, deploys, source" },
    { key: "SLACK_BOT_TOKEN", label: "Slack", secret: true, hint: "Post messages" },
    { key: "DISCORD_WEBHOOK_URL", label: "Discord", secret: true, hint: "Send messages" },
    { key: "NOTION_API_KEY", label: "Notion", secret: true, hint: "Create pages" },
    { key: "LINEAR_API_KEY", label: "Linear", secret: true, hint: "Create issues" },
    { key: "HUBSPOT_ACCESS_TOKEN", label: "HubSpot", secret: true, hint: "Create contacts" },
    { key: "GOOGLE_ACCESS_TOKEN", label: "Google Workspace", secret: true, hint: "Gmail / Calendar / Sheets" },
  ] },
  { group: "Revenue", keys: [
    { key: "STRIPE_API_KEY", label: "Stripe", secret: true, hint: "Subscription + charge sync" },
    { key: "LEMONSQUEEZY_API_KEY", label: "Lemon Squeezy", secret: true, hint: "Subscription sync" },
    { key: "POLAR_API_KEY", label: "Polar", secret: true, hint: "Subscription sync" },
    { key: "PADDLE_API_KEY", label: "Paddle", secret: true, hint: "Subscription sync" },
  ] },
  { group: "Enterprise", keys: [
    { key: "GENESIS_AUTH_REQUIRED", label: "Require auth", secret: false, hint: "'1' to enforce API auth (production)" },
    { key: "GENESIS_BACKUP_TARGET", label: "Backup storage", secret: false, hint: "e.g. s3://bucket — enables backups" },
    { key: "GENESIS_DB_ENCRYPTION_KEY", label: "DB encryption key", secret: true, hint: "Enables encryption-at-rest readiness" },
    { key: "SENTRY_DSN", label: "Sentry DSN", secret: true, hint: "Error forwarding" },
    { key: "OTEL_EXPORTER_OTLP_ENDPOINT", label: "OTLP endpoint", secret: false, hint: "Trace export" },
  ] },
];

const ALLOWED = new Set(CONFIG_GROUPS.flatMap((g) => g.keys.map((k) => k.key)));
const SECRET_KEYS = new Set(CONFIG_GROUPS.flatMap((g) => g.keys.filter((k) => k.secret).map((k) => k.key)));

export function isConfigurableKey(key: string): boolean { return ALLOWED.has(key); }

function mask(key: string, value: string): string {
  if (!SECRET_KEYS.has(key)) return value;
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

async function readFile(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as Record<string, string>; }
  catch { return {}; }
}

/** Apply the saved config file to process.env (env already set wins). Idempotent —
 *  call once at startup (instrumentation) and safe to call again. */
export async function loadAppConfig(): Promise<{ loaded: number }> {
  const saved = await readFile();
  let loaded = 0;
  for (const [k, v] of Object.entries(saved)) {
    if (!ALLOWED.has(k)) continue;
    if (!process.env[k] && v) { process.env[k] = v; loaded++; }
  }
  return { loaded };
}

/** Masked status of every configurable key — REAL detection, never raw values. */
export async function getConfigStatus(): Promise<{ group: string; keys: { key: string; label: string; secret: boolean; hint: string; configured: boolean; masked: string | null }[] }[]> {
  return CONFIG_GROUPS.map((g) => ({
    group: g.group,
    keys: g.keys.map((k) => {
      const v = process.env[k.key];
      return { ...k, configured: !!v, masked: v ? mask(k.key, v) : null };
    }),
  }));
}

/** Set config keys: validate against the allowlist, apply to process.env now, and
 *  persist to the gitignored file. Returns a masked echo — never the raw value. */
export async function setConfigKeys(entries: Record<string, string>): Promise<{ applied: string[]; rejected: string[] }> {
  const saved = await readFile();
  const applied: string[] = [], rejected: string[] = [];
  for (const [k, v] of Object.entries(entries)) {
    if (!ALLOWED.has(k)) { rejected.push(k); continue; }
    const val = String(v ?? "");
    if (val === "") { delete saved[k]; delete process.env[k]; }        // empty clears
    else { saved[k] = val; process.env[k] = val; }                     // set + take effect now
    applied.push(k);
  }
  await fs.writeFile(CONFIG_PATH, JSON.stringify(saved, null, 2), "utf8");
  return { applied, rejected };
}
