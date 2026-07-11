/** Real Internet Intelligence (V10 Module 1) — live web connectors for the
 *  World Scanner.
 *
 * Every signal returned here is REAL: fetched from a public API/feed with its
 * source URL and real engagement numbers attached. Pain extraction and
 * clustering are HEURISTIC (regex + term grouping) and labeled as such in the
 * evidence trail; the underlying signals are never fabricated.
 *
 * Connector honesty:
 *  - FREE connectors (HN, Reddit, GitHub Issues, StackOverflow, Google News
 *    RSS, generic RSS, App Store reviews) hit real public endpoints, no key.
 *  - KEY_REQUIRED connectors (Product Hunt) activate only when their env key
 *    exists.
 *  - UNAVAILABLE connectors (Play Store, Trustpilot, G2, Capterra) have no
 *    free public API — they are listed with that status and are NEVER faked
 *    or scraped.
 */

export interface WebSignal {
  source: string;      // connector name
  sourceType: "REAL";  // every signal here was actually fetched
  url: string;
  title: string;
  text: string;
  engagement: number;  // real points/comments/votes/answers
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface Connector {
  name: string;
  kind: "FREE" | "KEY_REQUIRED" | "UNAVAILABLE";
  note: string;
  available(): boolean;
  search?(query: string, fetchImpl: FetchLike): Promise<WebSignal[]>;
}

const UA = { "user-agent": "ShadowGenesisOS/1.0 (world-scanner; research)" };
const enc = encodeURIComponent;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await fetchImpl(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`HTTP_${r.status} ${url.split("?")[0]}`);
  return r.json();
}

// ---------------- FREE connectors (real public endpoints, no key) ----------------

export const hackernews: Connector = {
  name: "hackernews", kind: "FREE", note: "Algolia HN search API",
  available: () => true,
  async search(query, fetchImpl) {
    const d = await getJson(fetchImpl, `https://hn.algolia.com/api/v1/search?query=${enc(query)}&tags=story&hitsPerPage=20`) as { hits?: { title?: string; story_text?: string; url?: string; objectID?: string; points?: number; num_comments?: number }[] };
    return (d.hits ?? []).filter((h) => h.title).map((h) => ({
      source: "hackernews", sourceType: "REAL" as const,
      url: s(h.url) || `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: s(h.title), text: s(h.story_text).slice(0, 500),
      engagement: n(h.points) + n(h.num_comments),
    }));
  },
};

export const reddit: Connector = {
  name: "reddit", kind: "FREE", note: "public search JSON",
  available: () => true,
  async search(query, fetchImpl) {
    // api.reddit.com serves the same listing JSON without www's bot-wall
    const d = await getJson(fetchImpl, `https://api.reddit.com/search?q=${enc(query)}&sort=relevance&t=year&limit=20`) as { data?: { children?: { data?: { title?: string; selftext?: string; permalink?: string; score?: number; num_comments?: number } }[] } };
    return (d.data?.children ?? []).map((c) => c.data ?? {}).filter((p) => p.title).map((p) => ({
      source: "reddit", sourceType: "REAL" as const,
      url: `https://www.reddit.com${s(p.permalink)}`,
      title: s(p.title), text: s(p.selftext).slice(0, 500),
      engagement: n(p.score) + n(p.num_comments),
    }));
  },
};

export const githubIssues: Connector = {
  name: "github-issues", kind: "FREE", note: "issue search API (GITHUB_TOKEN raises the rate limit)",
  available: () => true,
  async search(query, fetchImpl) {
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const d = await getJson(fetchImpl, `https://api.github.com/search/issues?q=${enc(query)}+in:title&per_page=20`, headers) as { items?: { title?: string; body?: string; html_url?: string; comments?: number; reactions?: { total_count?: number } }[] };
    return (d.items ?? []).filter((i) => i.title).map((i) => ({
      source: "github-issues", sourceType: "REAL" as const,
      url: s(i.html_url), title: s(i.title), text: s(i.body).slice(0, 500),
      engagement: n(i.comments) + n(i.reactions?.total_count),
    }));
  },
};

export const stackoverflow: Connector = {
  name: "stackoverflow", kind: "FREE", note: "Stack Exchange search API",
  available: () => true,
  async search(query, fetchImpl) {
    const d = await getJson(fetchImpl, `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${enc(query)}&site=stackoverflow&pagesize=20`) as { items?: { title?: string; link?: string; score?: number; answer_count?: number; view_count?: number }[] };
    return (d.items ?? []).filter((i) => i.title).map((i) => ({
      source: "stackoverflow", sourceType: "REAL" as const,
      url: s(i.link), title: decodeEntities(s(i.title)), text: "",
      engagement: n(i.score) + n(i.answer_count) + Math.min(20, Math.floor(n(i.view_count) / 500)),
    }));
  },
};

/** Minimal RSS/Atom item parser — regex-based, dependency-free. */
export function parseRssItems(xml: string, sourceName: string, max = 20): WebSignal[] {
  const items: WebSignal[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks.slice(0, max)) {
    const title = decodeEntities((b.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] ?? "").trim());
    const link = (b.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1] ?? b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "").trim();
    const desc = decodeEntities((b.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").trim());
    if (title) items.push({ source: sourceName, sourceType: "REAL", url: link, title, text: desc.slice(0, 500), engagement: 0 });
  }
  return items;
}

export const googleNews: Connector = {
  name: "googlenews", kind: "FREE", note: "Google News RSS search",
  available: () => true,
  async search(query, fetchImpl) {
    const r = await fetchImpl(`https://news.google.com/rss/search?q=${enc(query)}&hl=en-US&gl=US&ceid=US:en`, { headers: UA });
    if (!r.ok) throw new Error(`HTTP_${r.status} news.google.com`);
    return parseRssItems(await r.text(), "googlenews");
  },
};

export const rssFeeds: Connector = {
  name: "rss", kind: "FREE", note: "generic feeds from GENESIS_RSS_FEEDS (comma-separated URLs)",
  available: () => !!process.env.GENESIS_RSS_FEEDS,
  async search(_query, fetchImpl) {
    const feeds = (process.env.GENESIS_RSS_FEEDS ?? "").split(",").map((f) => f.trim()).filter(Boolean).slice(0, 5);
    const out: WebSignal[] = [];
    for (const f of feeds) {
      try { const r = await fetchImpl(f, { headers: UA }); if (r.ok) out.push(...parseRssItems(await r.text(), "rss", 10)); } catch { /* feed down — skip, never fake */ }
    }
    return out;
  },
};

export const appStoreReviews: Connector = {
  name: "appstore-reviews", kind: "FREE", note: "iTunes customer-review RSS; app ids from GENESIS_APPSTORE_IDS",
  available: () => !!process.env.GENESIS_APPSTORE_IDS,
  async search(_query, fetchImpl) {
    const ids = (process.env.GENESIS_APPSTORE_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3);
    const out: WebSignal[] = [];
    for (const id of ids) {
      try {
        const d = await getJson(fetchImpl, `https://itunes.apple.com/us/rss/customerreviews/id=${enc(id)}/sortby=mostrecent/json`) as { feed?: { entry?: { title?: { label?: string }; content?: { label?: string }; "im:rating"?: { label?: string }; author?: { uri?: { label?: string } } }[] } };
        for (const e of (d.feed?.entry ?? []).slice(0, 15)) {
          const rating = parseInt(e["im:rating"]?.label ?? "5", 10);
          if (rating <= 3) out.push({ source: "appstore-reviews", sourceType: "REAL", url: `https://apps.apple.com/us/app/id${id}`, title: s(e.title?.label), text: s(e.content?.label).slice(0, 500), engagement: 5 - rating });
        }
      } catch { /* app id invalid or feed down — skip */ }
    }
    return out;
  },
};

// ---------------- KEY_REQUIRED / UNAVAILABLE (honest, never faked) ----------------

export const productHunt: Connector = {
  name: "producthunt", kind: "KEY_REQUIRED", note: "GraphQL API — set PRODUCTHUNT_API_TOKEN",
  available: () => !!process.env.PRODUCTHUNT_API_TOKEN,
  async search(query, fetchImpl) {
    const r = await fetchImpl("https://api.producthunt.com/v2/api/graphql", { headers: { ...UA, authorization: `Bearer ${process.env.PRODUCTHUNT_API_TOKEN}`, "content-type": "application/json" } as Record<string, string> });
    if (!r.ok) throw new Error(`HTTP_${r.status} producthunt`);
    void query; return []; // listing search requires a paid plan; token presence only proves reachability
  },
};

const unavailable = (name: string, note: string): Connector => ({ name, kind: "UNAVAILABLE", note, available: () => false });
export const playStoreReviews = unavailable("playstore-reviews", "no free public API — requires Google Play Developer access to YOUR OWN apps");
export const trustpilot = unavailable("trustpilot", "partner API only — never scraped");
export const g2 = unavailable("g2", "partner API only — never scraped");
export const capterra = unavailable("capterra", "partner API only — never scraped");

export const CONNECTORS: Connector[] = [hackernews, reddit, githubIssues, stackoverflow, googleNews, rssFeeds, appStoreReviews, productHunt, playStoreReviews, trustpilot, g2, capterra];

export function connectorHealth(): { name: string; kind: string; available: boolean; note: string }[] {
  return CONNECTORS.map((c) => ({ name: c.name, kind: c.kind, available: c.available(), note: c.note }));
}

// ---------------- Pain extraction + clustering (HEURISTIC, labeled) ----------------

const PAIN_PATTERNS = /\b(frustrat\w*|annoy\w*|pain(ful|point)?s?\b|hate (that|how|when)|wish (there was|i could|it)|why is there no|no (good|easy|simple) way|struggl\w*|nightmare|tedious|broken|unreliable|waste[sd]? (of )?(time|hours)|manually|can'?t (figure|find|get)|doesn'?t work|so (slow|hard|complicated)|alternative to|tired of|fed up|workaround)\b/i;

/** HEURISTIC pain score: pattern density + log-scaled REAL engagement. */
export function painScore(sig: WebSignal): number {
  const text = `${sig.title} ${sig.text}`;
  const hits = text.match(new RegExp(PAIN_PATTERNS.source, "gi"))?.length ?? 0;
  if (hits === 0) return 0;
  return hits * 2 + Math.min(6, Math.log2(1 + sig.engagement));
}

const STOPWORDS = new Set("a an the and or but for nor so yet of in on at to from by with about as is are was were be been being have has had do does did will would can could should shall may might must it its this that these those i you he she we they them my your our their what which who whom how when where why not no any all every each there here out up down over under again then once more most other some such only own same than too very just don didn t s ve re ll d m".split(" "));
// forum-idiom noise that would otherwise dominate cluster keys ("Show HN", "Ask HN", …)
const DOMAIN_NOISE = new Set(["show", "ask", "tell", "need", "want", "best", "launch", "launched", "using", "made", "built", "make", "help", "anyone", "still", "really", "year", "week", "today", "2024", "2025", "2026"]);

function keyTerms(title: string): string[] {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !DOMAIN_NOISE.has(w) && !PAIN_PATTERNS.test(w)).slice(0, 8);
}

export interface PainCluster {
  key: string;               // dominant shared term
  signals: WebSignal[];      // REAL signals in the cluster
  frequency: number;         // cluster size (real count of independent signals)
  engagement: number;        // summed real engagement
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  alternatives: string[];    // competitor mentions captured from "alternative to X"
  sources: string[];         // distinct connector names
}

/** Cluster painful signals by dominant SHARED term (two-pass: global term
 *  frequency first, then each signal joins its most-shared term's cluster);
 *  frequency/urgency from REAL counts. */
export function clusterPains(signals: WebSignal[]): PainCluster[] {
  const scored = signals.map((sig) => ({ sig, score: painScore(sig) })).filter((x) => x.score > 0);
  const globalFreq = new Map<string, number>();
  const termsOf = new Map<WebSignal, string[]>();
  for (const { sig } of scored) {
    const terms = keyTerms(sig.title);
    termsOf.set(sig, terms);
    for (const t of new Set(terms)) globalFreq.set(t, (globalFreq.get(t) ?? 0) + 1);
  }
  const byTerm = new Map<string, WebSignal[]>();
  for (const { sig } of scored) {
    const terms = termsOf.get(sig) ?? [];
    if (terms.length === 0) continue;
    const term = [...terms].sort((a, b) => (globalFreq.get(b) ?? 0) - (globalFreq.get(a) ?? 0))[0];
    byTerm.set(term, [...(byTerm.get(term) ?? []), sig]);
  }
  const clusters: PainCluster[] = [];
  for (const [key, sigs] of byTerm) {
    const engagement = sigs.reduce((a, x) => a + x.engagement, 0);
    const alternatives = [...new Set(sigs.flatMap((x) => [...`${x.title} ${x.text}`.matchAll(/alternative to ([A-Z][\w.-]{2,30})/gi)].map((m) => m[1])))];
    clusters.push({
      key, signals: sigs, frequency: sigs.length, engagement,
      urgency: engagement >= 300 || sigs.length >= 6 ? "CRITICAL" : engagement >= 100 || sigs.length >= 4 ? "HIGH" : sigs.length >= 2 ? "MEDIUM" : "LOW",
      alternatives, sources: [...new Set(sigs.map((x) => x.source))],
    });
  }
  return clusters.sort((a, b) => (b.frequency * 10 + b.engagement) - (a.frequency * 10 + a.engagement));
}

// ---------------- scanWeb: query the live internet for pains ----------------

const DEFAULT_QUERY_SUFFIXES = ["frustrating", "no good tool", "wish there was"];

export interface WebScanResult { connectorsUsed: string[]; connectorErrors: Record<string, string>; signals: number; clusters: PainCluster[] }

/** Query every AVAILABLE searchable connector for real pain signals. Per-connector
 *  failures are recorded, never papered over. */
export async function scanWeb(opts?: { focus?: string; fetchImpl?: FetchLike; maxQueries?: number }): Promise<WebScanResult> {
  const fetchImpl: FetchLike = opts?.fetchImpl ?? (fetch as unknown as FetchLike);
  const queries = opts?.focus
    ? DEFAULT_QUERY_SUFFIXES.slice(0, opts?.maxQueries ?? 2).map((sfx) => `${opts.focus} ${sfx}`)
    : ["saas billing frustrating", "automation no good tool"].slice(0, opts?.maxQueries ?? 2);
  const usable = CONNECTORS.filter((c) => c.available() && c.search);
  const connectorErrors: Record<string, string> = {};
  const all: WebSignal[] = [];
  await Promise.all(usable.map(async (c) => {
    try {
      // env-gated feed connectors take no query; search connectors get each query
      const qs = c.name === "rss" || c.name === "appstore-reviews" ? [""] : queries;
      for (const q of qs) {
        const sigs = await withTimeout(c.search!(q, fetchImpl), 10_000, c.name);
        all.push(...sigs);
      }
    } catch (e) { connectorErrors[c.name] = e instanceof Error ? e.message.slice(0, 120) : String(e); }
  }));
  const seen = new Set<string>();
  let unique = all.filter((x) => { const k = x.url || x.title; if (seen.has(k)) return false; seen.add(k); return true; });
  // focused scans require topical relevance: at least one focus token must appear
  // in the signal (search engines match "frustrating" alone otherwise — sports
  // articles are real pain, just not THIS pain)
  const focusTokens = (opts?.focus ?? "").toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  if (focusTokens.length) unique = unique.filter((x) => { const hay = `${x.title} ${x.text}`.toLowerCase(); return focusTokens.some((t) => hay.includes(t)); });
  return { connectorsUsed: usable.map((c) => c.name), connectorErrors, signals: unique.length, clusters: clusterPains(unique) };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms))]);
}

function decodeEntities(t: string): string {
  return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
}
