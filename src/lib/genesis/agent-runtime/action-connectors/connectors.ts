/** Real Action Connectors (V10 Module 10) — production connectors for external
 *  mutations. Every connector is KEY-GATED: with credentials it hits the real
 *  official API; without them it is honestly UNCONFIGURED. Genesis NEVER fakes a
 *  delivery or an API response.
 *
 * A connector exposes:
 *   - verify(fetch): a REAL read-only auth check (CONNECTED / AUTH_FAILED / ...)
 *   - ops[name].perform(payload, fetch): the REAL mutating call, run ONLY after
 *     the orchestrator has consumed a human approval.
 *
 * Credentials come from process.env and are placed ONLY in request headers — they
 * are never returned, logged, or persisted (the orchestrator redacts payloads).
 * Reuses the World Scanner FetchLike seam so tests inject a fake transport.
 */

import type { FetchLike } from "../world-scanner/connectors";

export type ActionCategory = "VCS" | "CHAT" | "DOCS" | "PM" | "CRM" | "EMAIL" | "CALENDAR" | "GENERIC" | "AUTOMATION";
export interface VerifyResult { ok: boolean; detail: string; account?: string }
export interface PerformResult { ok: boolean; externalId?: string; summary: string; deliveryVerified: boolean; error?: string }

export interface ConnectorOp {
  actionType: "EMAIL" | "POST" | "HTTP_WRITE" | "OTHER";
  describe(payload: Record<string, unknown>): string;
  required: string[]; // required payload fields
  perform(payload: Record<string, unknown>, fetchImpl: FetchLike): Promise<PerformResult>;
}

export interface ActionConnector {
  name: string;
  category: ActionCategory;
  credEnv: string[];       // env var(s) that must be set
  note: string;
  available(): boolean;
  verify?(fetchImpl: FetchLike): Promise<VerifyResult>;
  ops: Record<string, ConnectorOp>;
}

const UA = "ShadowGenesisOS/1.0 (action-connectors)";
const s = (v: unknown) => (typeof v === "string" ? v : "");
const jsonHeaders = (auth: string, extra: Record<string, string> = {}) => ({ "user-agent": UA, authorization: auth, "content-type": "application/json", accept: "application/json", ...extra });

/** POST/PATCH helper carrying the JSON body via the seam's x-body convention. */
async function send(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  const r = await fetchImpl(url, { headers: { ...headers, "x-body": JSON.stringify(body), "x-method": "POST" } });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}
async function get(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; json: unknown }> {
  const r = await fetchImpl(url, { headers });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

// ---------------- GitHub ----------------
export const github: ActionConnector = {
  name: "github", category: "VCS", credEnv: ["GITHUB_TOKEN"], note: "set GITHUB_TOKEN — create issues/comments",
  available: () => !!process.env.GITHUB_TOKEN,
  async verify(f) { const r = await get(f, "https://api.github.com/user", jsonHeaders(`Bearer ${process.env.GITHUB_TOKEN}`)); return { ok: r.ok, detail: r.ok ? "token valid" : `HTTP ${r.status}`, account: s((r.json as { login?: string }).login) }; },
  ops: {
    create_issue: {
      actionType: "POST", required: ["repo", "title"],
      describe: (p) => `open GitHub issue "${s(p.title)}" in ${s(p.repo)}`,
      async perform(p, f) {
        const r = await send(f, `https://api.github.com/repos/${s(p.repo)}/issues`, jsonHeaders(`Bearer ${process.env.GITHUB_TOKEN}`), { title: s(p.title), body: s(p.body) });
        const num = (r.json as { number?: number; html_url?: string }).number;
        return { ok: r.ok, externalId: num ? `#${num}` : undefined, summary: r.ok ? `issue ${s((r.json as { html_url?: string }).html_url)}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!num, error: r.ok ? undefined : `github HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- GitLab ----------------
export const gitlab: ActionConnector = {
  name: "gitlab", category: "VCS", credEnv: ["GITLAB_TOKEN"], note: "set GITLAB_TOKEN — create issues",
  available: () => !!process.env.GITLAB_TOKEN,
  async verify(f) { const r = await get(f, "https://gitlab.com/api/v4/user", jsonHeaders(`Bearer ${process.env.GITLAB_TOKEN}`)); return { ok: r.ok, detail: r.ok ? "token valid" : `HTTP ${r.status}`, account: s((r.json as { username?: string }).username) }; },
  ops: {
    create_issue: {
      actionType: "POST", required: ["projectId", "title"],
      describe: (p) => `open GitLab issue "${s(p.title)}" in project ${s(p.projectId)}`,
      async perform(p, f) {
        const r = await send(f, `https://gitlab.com/api/v4/projects/${encodeURIComponent(s(p.projectId))}/issues`, jsonHeaders(`Bearer ${process.env.GITLAB_TOKEN}`), { title: s(p.title), description: s(p.body) });
        const iid = (r.json as { iid?: number }).iid;
        return { ok: r.ok, externalId: iid ? `#${iid}` : undefined, summary: r.ok ? `issue #${iid}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!iid, error: r.ok ? undefined : `gitlab HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- Slack ----------------
export const slack: ActionConnector = {
  name: "slack", category: "CHAT", credEnv: ["SLACK_BOT_TOKEN"], note: "set SLACK_BOT_TOKEN — post messages",
  available: () => !!process.env.SLACK_BOT_TOKEN,
  async verify(f) { const r = await get(f, "https://slack.com/api/auth.test", jsonHeaders(`Bearer ${process.env.SLACK_BOT_TOKEN}`)); const ok = r.ok && (r.json as { ok?: boolean }).ok === true; return { ok, detail: ok ? "token valid" : `auth.test failed`, account: s((r.json as { team?: string }).team) }; },
  ops: {
    post_message: {
      actionType: "POST", required: ["channel", "text"],
      describe: (p) => `post Slack message to ${s(p.channel)}`,
      async perform(p, f) {
        const r = await send(f, "https://slack.com/api/chat.postMessage", jsonHeaders(`Bearer ${process.env.SLACK_BOT_TOKEN}`), { channel: s(p.channel), text: s(p.text) });
        const j = r.json as { ok?: boolean; ts?: string; error?: string };
        return { ok: r.ok && j.ok === true, externalId: j.ts, summary: j.ok ? `delivered ts ${j.ts}` : `slack error ${j.error}`, deliveryVerified: j.ok === true && !!j.ts, error: j.ok ? undefined : `slack ${j.error ?? r.status}` };
      },
    },
  },
};

// ---------------- Discord (webhook) ----------------
export const discord: ActionConnector = {
  name: "discord", category: "CHAT", credEnv: ["DISCORD_WEBHOOK_URL"], note: "set DISCORD_WEBHOOK_URL — send messages",
  available: () => !!process.env.DISCORD_WEBHOOK_URL,
  ops: {
    send_message: {
      actionType: "POST", required: ["content"],
      describe: (p) => `send Discord message (${s(p.content).length} chars)`,
      async perform(p, f) {
        const r = await send(f, `${process.env.DISCORD_WEBHOOK_URL}?wait=true`, { "user-agent": UA, "content-type": "application/json" }, { content: s(p.content).slice(0, 2000) });
        const id = (r.json as { id?: string }).id;
        return { ok: r.ok, externalId: id, summary: r.ok ? `delivered id ${id}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!id, error: r.ok ? undefined : `discord HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- Notion ----------------
export const notion: ActionConnector = {
  name: "notion", category: "DOCS", credEnv: ["NOTION_API_KEY"], note: "set NOTION_API_KEY — create pages",
  available: () => !!process.env.NOTION_API_KEY,
  async verify(f) { const r = await get(f, "https://api.notion.com/v1/users/me", jsonHeaders(`Bearer ${process.env.NOTION_API_KEY}`, { "notion-version": "2022-06-28" })); return { ok: r.ok, detail: r.ok ? "token valid" : `HTTP ${r.status}` }; },
  ops: {
    create_page: {
      actionType: "HTTP_WRITE", required: ["parentDatabaseId", "title"],
      describe: (p) => `create Notion page "${s(p.title)}"`,
      async perform(p, f) {
        const r = await send(f, "https://api.notion.com/v1/pages", jsonHeaders(`Bearer ${process.env.NOTION_API_KEY}`, { "notion-version": "2022-06-28" }), { parent: { database_id: s(p.parentDatabaseId) }, properties: { title: { title: [{ text: { content: s(p.title) } }] } } });
        const id = (r.json as { id?: string }).id;
        return { ok: r.ok, externalId: id, summary: r.ok ? `page ${id}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!id, error: r.ok ? undefined : `notion HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- Linear ----------------
export const linear: ActionConnector = {
  name: "linear", category: "PM", credEnv: ["LINEAR_API_KEY"], note: "set LINEAR_API_KEY — create issues",
  available: () => !!process.env.LINEAR_API_KEY,
  async verify(f) { const r = await send(f, "https://api.linear.app/graphql", jsonHeaders(process.env.LINEAR_API_KEY!), { query: "{ viewer { id name } }" }); const ok = r.ok && !!(r.json as { data?: { viewer?: unknown } }).data?.viewer; return { ok, detail: ok ? "key valid" : `HTTP ${r.status}` }; },
  ops: {
    create_issue: {
      actionType: "HTTP_WRITE", required: ["teamId", "title"],
      describe: (p) => `create Linear issue "${s(p.title)}"`,
      async perform(p, f) {
        const r = await send(f, "https://api.linear.app/graphql", jsonHeaders(process.env.LINEAR_API_KEY!), { query: `mutation { issueCreate(input: { teamId: "${s(p.teamId)}", title: ${JSON.stringify(s(p.title))} }) { success issue { identifier } } }` });
        const issue = (r.json as { data?: { issueCreate?: { success?: boolean; issue?: { identifier?: string } } } }).data?.issueCreate;
        return { ok: r.ok && !!issue?.success, externalId: issue?.issue?.identifier, summary: issue?.success ? `issue ${issue.issue?.identifier}` : `HTTP ${r.status}`, deliveryVerified: !!issue?.success && !!issue.issue?.identifier, error: issue?.success ? undefined : `linear HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- Jira ----------------
export const jira: ActionConnector = {
  name: "jira", category: "PM", credEnv: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"], note: "set JIRA_BASE_URL+JIRA_EMAIL+JIRA_API_TOKEN — create issues",
  available: () => !!(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
  async verify(f) { const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`; const r = await get(f, `${process.env.JIRA_BASE_URL}/rest/api/3/myself`, jsonHeaders(auth)); return { ok: r.ok, detail: r.ok ? "auth valid" : `HTTP ${r.status}`, account: s((r.json as { emailAddress?: string }).emailAddress) }; },
  ops: {
    create_issue: {
      actionType: "HTTP_WRITE", required: ["projectKey", "summary"],
      describe: (p) => `create Jira issue "${s(p.summary)}" in ${s(p.projectKey)}`,
      async perform(p, f) {
        const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`;
        const r = await send(f, `${process.env.JIRA_BASE_URL}/rest/api/3/issue`, jsonHeaders(auth), { fields: { project: { key: s(p.projectKey) }, summary: s(p.summary), issuetype: { name: s(p.issueType) || "Task" } } });
        const key = (r.json as { key?: string }).key;
        return { ok: r.ok, externalId: key, summary: r.ok ? `issue ${key}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!key, error: r.ok ? undefined : `jira HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- HubSpot ----------------
export const hubspot: ActionConnector = {
  name: "hubspot", category: "CRM", credEnv: ["HUBSPOT_ACCESS_TOKEN"], note: "set HUBSPOT_ACCESS_TOKEN — create contacts",
  available: () => !!process.env.HUBSPOT_ACCESS_TOKEN,
  async verify(f) { const r = await get(f, "https://api.hubapi.com/crm/v3/objects/contacts?limit=1", jsonHeaders(`Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`)); return { ok: r.ok, detail: r.ok ? "token valid" : `HTTP ${r.status}` }; },
  ops: {
    create_contact: {
      actionType: "HTTP_WRITE", required: ["email"],
      describe: (p) => `create HubSpot contact ${s(p.email)}`,
      async perform(p, f) {
        const r = await send(f, "https://api.hubapi.com/crm/v3/objects/contacts", jsonHeaders(`Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`), { properties: { email: s(p.email), firstname: s(p.firstName), lastname: s(p.lastName), company: s(p.company) } });
        const id = (r.json as { id?: string }).id;
        return { ok: r.ok, externalId: id, summary: r.ok ? `contact ${id}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!id, error: r.ok ? undefined : `hubspot HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- Google Workspace (Gmail / Calendar / Sheets / Docs / Drive) ----------------
// OAuth access token required (GOOGLE_ACCESS_TOKEN); without it → UNCONFIGURED.
const googleAvail = () => !!process.env.GOOGLE_ACCESS_TOKEN;
async function googleVerify(f: FetchLike): Promise<VerifyResult> { const r = await get(f, "https://www.googleapis.com/oauth2/v3/userinfo", jsonHeaders(`Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`)); return { ok: r.ok, detail: r.ok ? "token valid" : `HTTP ${r.status}`, account: s((r.json as { email?: string }).email) }; }

export const gmail: ActionConnector = {
  name: "gmail", category: "EMAIL", credEnv: ["GOOGLE_ACCESS_TOKEN"], note: "set GOOGLE_ACCESS_TOKEN (gmail.send scope) — send email",
  available: googleAvail, verify: googleVerify,
  ops: {
    send_email: {
      actionType: "EMAIL", required: ["to", "subject", "body"],
      describe: (p) => `send email to ${s(p.to)} — "${s(p.subject)}"`,
      async perform(p, f) {
        const raw = Buffer.from(`To: ${s(p.to)}\r\nSubject: ${s(p.subject)}\r\n\r\n${s(p.body)}`).toString("base64url");
        const r = await send(f, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", jsonHeaders(`Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`), { raw });
        const id = (r.json as { id?: string }).id;
        return { ok: r.ok, externalId: id, summary: r.ok ? `sent id ${id}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!id, error: r.ok ? undefined : `gmail HTTP ${r.status}` };
      },
    },
  },
};

export const googleCalendar: ActionConnector = {
  name: "google_calendar", category: "CALENDAR", credEnv: ["GOOGLE_ACCESS_TOKEN"], note: "set GOOGLE_ACCESS_TOKEN (calendar scope) — create events",
  available: googleAvail, verify: googleVerify,
  ops: {
    create_event: {
      actionType: "HTTP_WRITE", required: ["summary", "startIso", "endIso"],
      describe: (p) => `create calendar event "${s(p.summary)}"`,
      async perform(p, f) {
        const r = await send(f, "https://www.googleapis.com/calendar/v3/calendars/primary/events", jsonHeaders(`Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`), { summary: s(p.summary), start: { dateTime: s(p.startIso) }, end: { dateTime: s(p.endIso) } });
        const id = (r.json as { id?: string }).id;
        return { ok: r.ok, externalId: id, summary: r.ok ? `event ${id}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!id, error: r.ok ? undefined : `gcal HTTP ${r.status}` };
      },
    },
  },
};

export const googleSheets: ActionConnector = {
  name: "google_sheets", category: "DOCS", credEnv: ["GOOGLE_ACCESS_TOKEN"], note: "set GOOGLE_ACCESS_TOKEN (sheets scope) — append rows",
  available: googleAvail, verify: googleVerify,
  ops: {
    append_row: {
      actionType: "HTTP_WRITE", required: ["spreadsheetId", "range", "values"],
      describe: (p) => `append row to sheet ${s(p.spreadsheetId)}`,
      async perform(p, f) {
        const r = await send(f, `https://sheets.googleapis.com/v4/spreadsheets/${s(p.spreadsheetId)}/values/${encodeURIComponent(s(p.range))}:append?valueInputOption=RAW`, jsonHeaders(`Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`), { values: [p.values] });
        const updates = (r.json as { updates?: { updatedRange?: string } }).updates;
        return { ok: r.ok, externalId: updates?.updatedRange, summary: r.ok ? `appended ${updates?.updatedRange}` : `HTTP ${r.status}`, deliveryVerified: r.ok && !!updates?.updatedRange, error: r.ok ? undefined : `sheets HTTP ${r.status}` };
      },
    },
  },
};

// ---------------- Generic webhook / REST / automation bridges ----------------
export const webhook: ActionConnector = {
  name: "webhook", category: "GENERIC", credEnv: [], note: "generic outbound webhook — url provided per-action",
  available: () => true, // availability is per-action (url in payload); execution still requires approval
  ops: {
    post: {
      actionType: "HTTP_WRITE", required: ["url"],
      describe: (p) => `POST webhook ${s(p.url).slice(0, 60)}`,
      async perform(p, f) {
        const r = await send(f, s(p.url), { "user-agent": UA, "content-type": "application/json" }, (p.body as unknown) ?? {});
        return { ok: r.ok, externalId: r.ok ? String(r.status) : undefined, summary: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}`, deliveryVerified: r.ok, error: r.ok ? undefined : `webhook HTTP ${r.status}` };
      },
    },
  },
};

export const zapier: ActionConnector = {
  name: "zapier", category: "AUTOMATION", credEnv: ["ZAPIER_WEBHOOK_URL"], note: "set ZAPIER_WEBHOOK_URL — trigger a Zap",
  available: () => !!process.env.ZAPIER_WEBHOOK_URL,
  ops: {
    trigger: {
      actionType: "HTTP_WRITE", required: [],
      describe: () => `trigger Zapier zap`,
      async perform(p, f) { const r = await send(f, process.env.ZAPIER_WEBHOOK_URL!, { "user-agent": UA, "content-type": "application/json" }, (p.data as unknown) ?? p); return { ok: r.ok, externalId: r.ok ? "sent" : undefined, summary: `HTTP ${r.status}`, deliveryVerified: r.ok, error: r.ok ? undefined : `zapier HTTP ${r.status}` }; },
    },
  },
};

export const n8n: ActionConnector = {
  name: "n8n", category: "AUTOMATION", credEnv: ["N8N_WEBHOOK_URL"], note: "set N8N_WEBHOOK_URL — trigger an n8n workflow",
  available: () => !!process.env.N8N_WEBHOOK_URL,
  ops: {
    trigger: {
      actionType: "HTTP_WRITE", required: [],
      describe: () => `trigger n8n workflow`,
      async perform(p, f) { const r = await send(f, process.env.N8N_WEBHOOK_URL!, { "user-agent": UA, "content-type": "application/json" }, (p.data as unknown) ?? p); return { ok: r.ok, externalId: r.ok ? "sent" : undefined, summary: `HTTP ${r.status}`, deliveryVerified: r.ok, error: r.ok ? undefined : `n8n HTTP ${r.status}` }; },
    },
  },
};

export const CONNECTORS: ActionConnector[] = [github, gitlab, slack, discord, notion, linear, jira, hubspot, gmail, googleCalendar, googleSheets, webhook, zapier, n8n];

export function findConnector(name: string): ActionConnector | undefined { return CONNECTORS.find((c) => c.name === name); }

export function connectorCatalog(): { name: string; category: ActionCategory; available: boolean; operations: string[]; credEnv: string[]; note: string }[] {
  return CONNECTORS.map((c) => ({ name: c.name, category: c.category, available: c.available(), operations: Object.keys(c.ops), credEnv: c.credEnv, note: c.note }));
}
