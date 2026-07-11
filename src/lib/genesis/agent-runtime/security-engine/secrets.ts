/** Secret Detection Engine (V10 Module 6).
 *
 * Detects real credential formats in text and REDACTS them before anything is
 * logged/persisted. Detection is pattern-based (labeled HEURISTIC) but the
 * patterns match the real shapes of production secrets. The raw secret is NEVER
 * returned or stored — only its kind and a redacted fingerprint.
 */

export interface SecretHit { kind: string; severity: "CRITICAL" | "HIGH" | "MEDIUM"; redacted: string; index: number }

interface Pattern { kind: string; severity: "CRITICAL" | "HIGH" | "MEDIUM"; re: RegExp }

// Ordered most-specific first so a token is classified by its real prefix.
const PATTERNS: Pattern[] = [
  { kind: "anthropic_api_key", severity: "CRITICAL", re: /\bsk-ant-[a-zA-Z0-9_-]{20,}/g },
  { kind: "openai_api_key", severity: "CRITICAL", re: /\bsk-(?:proj-)?[a-zA-Z0-9]{20,}/g },
  { kind: "openrouter_api_key", severity: "CRITICAL", re: /\bsk-or-v1-[a-f0-9]{32,}/g },
  { kind: "google_api_key", severity: "CRITICAL", re: /\bAIza[a-zA-Z0-9_-]{35}/g },
  { kind: "aws_access_key_id", severity: "CRITICAL", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}/g },
  { kind: "github_token", severity: "CRITICAL", re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{22,}/g },
  { kind: "slack_token", severity: "HIGH", re: /\bxox[baprs]-[a-zA-Z0-9-]{10,}/g },
  { kind: "stripe_secret_key", severity: "CRITICAL", re: /\b(?:sk|rk)_live_[a-zA-Z0-9]{20,}/g },
  { kind: "private_key", severity: "CRITICAL", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { kind: "jwt", severity: "MEDIUM", re: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { kind: "connection_string", severity: "HIGH", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@]+:[^\s:@]+@[^\s/]+/g },
  { kind: "bearer_secret", severity: "MEDIUM", re: /\bBearer\s+[a-zA-Z0-9._-]{20,}/g },
];

/** Redact a matched secret to a safe fingerprint: keep the identifying prefix,
 *  mask the body, keep the last 2 chars for correlation. Never reveals the key. */
export function redactValue(kind: string, match: string): string {
  const head = match.slice(0, Math.min(match.startsWith("-----BEGIN") ? match.length : 6, match.length));
  if (match.startsWith("-----BEGIN")) return "[REDACTED_PRIVATE_KEY]";
  const tail = match.length > 10 ? match.slice(-2) : "";
  return `${head}…${tail}[REDACTED:${kind}]`;
}

/** Scan text for secrets. Returns hits with REDACTED fingerprints only. */
export function scanForSecrets(text: string): SecretHit[] {
  if (!text) return [];
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const raw = m[0];
      // avoid double-counting a substring already matched by a more specific pattern
      const key = `${m.index}:${raw.length}`;
      if (seen.has(key)) continue; seen.add(key);
      hits.push({ kind: p.kind, severity: p.severity, redacted: redactValue(p.kind, raw), index: m.index ?? 0 });
    }
  }
  return hits;
}

/** Replace every detected secret in text with its redaction. Safe to log. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const p of PATTERNS) out = out.replace(p.re, (m) => redactValue(p.kind, m));
  return out;
}

/** True if the text contains any detectable secret. */
export function containsSecret(text: string): boolean {
  return scanForSecrets(text).length > 0;
}
