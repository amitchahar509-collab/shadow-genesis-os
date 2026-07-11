/** Lead Discovery connectors (V10 Module 2) — find REAL potential-customer
 *  entities from public sources. Every candidate carries a real evidence URL to
 *  a public page; PEOPLE AND EMAILS ARE NEVER FABRICATED. When no public contact
 *  exists, contactType is NONE/UNKNOWN — the lead is still real, just not yet
 *  reachable, and that is stated honestly rather than invented.
 *
 * Reuses the World Scanner's FetchLike seam so tests inject a fake fetch and no
 * network is touched under `bun test`.
 */

import type { FetchLike } from "../world-scanner/connectors";

export interface LeadCandidate {
  name: string;
  source: string;            // connector name
  evidenceUrl: string;       // REAL public URL — required
  description: string;
  signalText: string;        // the real text that surfaced this entity
  contactType: "PUBLIC_URL" | "NONE" | "UNKNOWN";
  contactRef?: string;       // a REAL public handle/page, never an invented email
  engagement: number;        // real stars/points/votes
}

export interface LeadConnector {
  name: string;
  kind: "FREE" | "KEY_REQUIRED" | "UNAVAILABLE";
  note: string;
  available(): boolean;
  find?(query: string, fetchImpl: FetchLike): Promise<LeadCandidate[]>;
}

const UA = { "user-agent": "ShadowGenesisOS/1.0 (lead-discovery; research)" };
const enc = encodeURIComponent;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await fetchImpl(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`HTTP_${r.status} ${url.split("?")[0]}`);
  return r.json();
}

/** GitHub organizations/repos building in the problem space — each is a real org
 *  with a public page. The org URL is a REAL public contact channel (issues, etc.). */
export const githubOrgs: LeadConnector = {
  name: "github-orgs", kind: "FREE", note: "GitHub repo search — real orgs building in the space (GITHUB_TOKEN raises rate limit)",
  available: () => true,
  async find(query, fetchImpl) {
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const d = await getJson(fetchImpl, `https://api.github.com/search/repositories?q=${enc(query)}&sort=stars&order=desc&per_page=20`, headers) as { items?: { name?: string; full_name?: string; html_url?: string; description?: string; stargazers_count?: number; owner?: { login?: string; html_url?: string; type?: string } }[] };
    const seenOrg = new Set<string>();
    const out: LeadCandidate[] = [];
    for (const r of d.items ?? []) {
      const login = s(r.owner?.login);
      if (!login || seenOrg.has(login)) continue; // one lead per org, not per repo
      seenOrg.add(login);
      out.push({
        name: login, source: "github-orgs",
        evidenceUrl: s(r.owner?.html_url) || s(r.html_url),
        description: s(r.description).slice(0, 300),
        signalText: `${s(r.full_name)}: ${s(r.description)}`.slice(0, 400),
        contactType: "PUBLIC_URL", contactRef: s(r.owner?.html_url), // real public org page — never an email
        engagement: n(r.stargazers_count),
      });
    }
    return out;
  },
};

/** Hacker News launches / Show HN — real products with a real submitter and, when
 *  present, a real product URL. These are companies actively shipping. */
export const hnLaunches: LeadConnector = {
  name: "hackernews", kind: "FREE", note: "Show HN / launches — real products shipping now",
  available: () => true,
  async find(query, fetchImpl) {
    const d = await getJson(fetchImpl, `https://hn.algolia.com/api/v1/search?query=${enc(query)}&tags=show_hn&hitsPerPage=20`) as { hits?: { title?: string; url?: string; objectID?: string; author?: string; points?: number; num_comments?: number }[] };
    return (d.hits ?? []).filter((h) => h.title).map((h) => {
      const hnUrl = `https://news.ycombinator.com/item?id=${s(h.objectID)}`;
      const hasProduct = !!s(h.url);
      return {
        name: s(h.title).replace(/^show hn:\s*/i, "").split(/[–—-]/)[0].trim().slice(0, 80),
        source: "hackernews",
        evidenceUrl: s(h.url) || hnUrl,
        description: s(h.title).slice(0, 300),
        signalText: s(h.title),
        contactType: hasProduct ? "PUBLIC_URL" as const : "NONE" as const,
        contactRef: hasProduct ? s(h.url) : hnUrl, // product site or the public thread — never invented
        engagement: n(h.points) + n(h.num_comments),
      };
    });
  },
};

/** Product Hunt — real launched products. Key-gated: only runs with a token,
 *  never faked when absent. */
export const productHuntLeads: LeadConnector = {
  name: "producthunt", kind: "KEY_REQUIRED", note: "set PRODUCTHUNT_API_TOKEN to discover launched products as leads",
  available: () => !!process.env.PRODUCTHUNT_API_TOKEN,
  async find(query, fetchImpl) {
    const token = process.env.PRODUCTHUNT_API_TOKEN;
    if (!token) return [];
    const body = JSON.stringify({ query: `{ posts(order: VOTES, first: 20) { edges { node { name tagline url votesCount } } } }` });
    const r = await fetchImpl(`https://api.producthunt.com/v2/api/graphql`, { headers: { ...UA, authorization: `Bearer ${token}`, "content-type": "application/json", "x-body": body } });
    if (!r.ok) throw new Error(`HTTP_${r.status} producthunt`);
    const d = await r.json() as { data?: { posts?: { edges?: { node?: { name?: string; tagline?: string; url?: string; votesCount?: number } }[] } } };
    const q = query.toLowerCase();
    return (d.data?.posts?.edges ?? []).map((e) => e.node ?? {}).filter((p) => p.name && `${p.name} ${p.tagline}`.toLowerCase().includes(q.split(" ")[0] ?? "")).map((p) => ({
      name: s(p.name).slice(0, 80), source: "producthunt",
      evidenceUrl: s(p.url), description: s(p.tagline).slice(0, 300), signalText: `${s(p.name)}: ${s(p.tagline)}`,
      contactType: "PUBLIC_URL" as const, contactRef: s(p.url), engagement: n(p.votesCount),
    }));
  },
};

/** Sources with no free public discovery API — listed honestly, never scraped/faked. */
function unavailableLead(name: string, note: string): LeadConnector {
  return { name, kind: "UNAVAILABLE", note, available: () => false };
}
export const crunchbaseLeads = unavailableLead("crunchbase", "no free API — paid Crunchbase Data license required; never scraped");
export const linkedinLeads = unavailableLead("linkedin", "no public lead API — ToS prohibits scraping; contacts must come from real inbound/consented sources");

export const LEAD_CONNECTORS: LeadConnector[] = [githubOrgs, hnLaunches, productHuntLeads, crunchbaseLeads, linkedinLeads];

export function leadConnectorHealth(): { name: string; kind: string; available: boolean; note: string }[] {
  return LEAD_CONNECTORS.map((c) => ({ name: c.name, kind: c.kind, available: c.available(), note: c.note }));
}
