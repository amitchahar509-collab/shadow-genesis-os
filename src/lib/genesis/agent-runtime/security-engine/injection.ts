/** Prompt-Injection Firewall (V10 Module 6).
 *
 * Screens UNTRUSTED text (web content, lead signals, tool output) for injection
 * attempts before it reaches an LLM or an agent's instruction context. Heuristic
 * (labeled HEURISTIC) but tuned to the real attack corpus. Returns SAFE /
 * WARNING / BLOCKED with the concrete matched evidence — never a vague verdict.
 */

export type InjectionVerdict = "SAFE" | "WARNING" | "BLOCKED";
export interface InjectionSignal { category: string; weight: number; evidence: string }
export interface InjectionResult { verdict: InjectionVerdict; score: number; signals: InjectionSignal[]; label: "HEURISTIC" }

interface Rule { category: string; weight: number; re: RegExp }

const RULES: Rule[] = [
  { category: "instruction_override", weight: 5, re: /\b(ignore|disregard|forget|override)\b[^.]{0,30}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instruction|prompt|rule|context|direction)/i },
  { category: "system_prompt_exfil", weight: 5, re: /\b(reveal|show|print|repeat|output|leak|tell me)\b[^.]{0,30}\b(system|initial|original|hidden)\b[^.]{0,20}\b(prompt|instruction|message|rules?)/i },
  { category: "role_escalation", weight: 4, re: /\b(you are now|from now on you are|act as|pretend to be|new persona|developer mode|dan mode|jailbreak)\b/i },
  { category: "tool_hijack", weight: 5, re: /\b(call|invoke|use|run|execute)\b[^.]{0,20}\b(tool|function|shell|terminal|api)\b[^.]{0,30}\b(to|and)\b[^.]{0,30}\b(delete|send|exfiltrate|post|transfer|email)/i },
  { category: "data_exfiltration", weight: 5, re: /\b(send|post|upload|exfiltrate|forward|leak|email)\b[^\n]{0,50}(\benv\b|secret|api[_\s-]?keys?|\btokens?\b|password|credential|\.env|database)/i },
  { category: "instruction_injection_marker", weight: 4, re: /\[?(system|assistant|user)\]?\s*:\s*(you must|always|never|ignore)/i },
  { category: "override_delimiter", weight: 3, re: /(-{3,}\s*(end|ignore|new instructions)|<\/?(system|instructions?)>|###\s*(system|override))/i },
  { category: "encoded_payload", weight: 2, re: /\b(base64|rot13|hex decode|fromCharCode|atob)\b[^.]{0,20}\b(then|and|execute|run|eval)/i },
  { category: "urgency_coercion", weight: 1, re: /\b(urgent|immediately|critical override|admin command|this is not a drill)\b[^.]{0,20}\b(you must|do this|comply)/i },
];

/** Screen text for prompt-injection. WARNING at ≥3, BLOCKED at ≥5 (a single
 *  high-weight attack, or a stacked set). */
export function screenPrompt(text: string): InjectionResult {
  const signals: InjectionSignal[] = [];
  let score = 0;
  if (text) {
    for (const r of RULES) {
      const m = r.re.exec(text);
      if (m) { score += r.weight; signals.push({ category: r.category, weight: r.weight, evidence: m[0].slice(0, 120) }); }
    }
  }
  const verdict: InjectionVerdict = score >= 5 ? "BLOCKED" : score >= 3 ? "WARNING" : "SAFE";
  return { verdict, score, signals, label: "HEURISTIC" };
}

/** Convenience: is this untrusted text safe to feed to an LLM/agent context? */
export function isPromptSafe(text: string): boolean {
  return screenPrompt(text).verdict !== "BLOCKED";
}
