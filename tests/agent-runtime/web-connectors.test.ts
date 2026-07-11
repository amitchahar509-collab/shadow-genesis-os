/** V10 Module 1 — Real Internet Intelligence. Network-free: every connector runs
 *  through a fetch seam with realistic fixture payloads. The invariants: signals
 *  carry REAL source URLs + engagement, pain grouping is HEURISTIC, unavailable
 *  connectors say so and are never faked, and scanWorld never fetches in tests
 *  unless a seam is injected. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { hackernews, reddit, githubIssues, stackoverflow, googleNews, parseRssItems, painScore, clusterPains, scanWeb, connectorHealth, CONNECTORS, type FetchLike, type WebSignal } from "@/lib/genesis/agent-runtime/world-scanner/connectors";
import { scanWorld } from "@/lib/genesis/agent-runtime/world-scanner";

const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

async function wipe() {
  await db.worldProblem.deleteMany({ where: { statement: { contains: "WEBTEST" } } });
}
beforeEach(wipe);
afterAll(wipe);

test("hackernews connector parses hits into REAL signals (url + engagement)", async () => {
  const fetchImpl: FetchLike = async (url) => {
    expect(url).toContain("hn.algolia.com");
    return resp({ hits: [{ title: "Ask HN: frustrated with invoice tools", objectID: "41", points: 120, num_comments: 45, story_text: "manual entry is a nightmare" }, { title: "no title url", url: "https://ex.com/x", points: 3, num_comments: 1 }] });
  };
  const sigs = await hackernews.search!("invoice", fetchImpl);
  expect(sigs.length).toBe(2);
  expect(sigs[0].url).toBe("https://news.ycombinator.com/item?id=41");
  expect(sigs[0].engagement).toBe(165); // real points + comments
  expect(sigs[0].sourceType).toBe("REAL");
});

test("reddit + github + stackoverflow connectors parse their payload shapes", async () => {
  const r = await reddit.search!("q", (async () => resp({ data: { children: [{ data: { title: "I hate that our CRM breaks", selftext: "so slow", permalink: "/r/sales/1", score: 88, num_comments: 12 } }] } })) as FetchLike);
  expect(r[0].url).toBe("https://www.reddit.com/r/sales/1");
  expect(r[0].engagement).toBe(100);

  const g = await githubIssues.search!("q", (async () => resp({ items: [{ title: "bug: export is broken", body: "fails every time", html_url: "https://github.com/x/y/issues/9", comments: 30, reactions: { total_count: 14 } }] })) as FetchLike);
  expect(g[0].url).toContain("github.com");
  expect(g[0].engagement).toBe(44);

  const so = await stackoverflow.search!("q", (async () => resp({ items: [{ title: "Why is there no easy way to parse X?", link: "https://stackoverflow.com/q/1", score: 55, answer_count: 4, view_count: 10_000 }] })) as FetchLike);
  expect(so[0].url).toContain("stackoverflow.com");
  expect(so[0].engagement).toBe(79); // 55 + 4 + min(20, 10000/500)
});

test("RSS parser handles item + CDATA + entities; google news uses it", async () => {
  const xml = `<rss><channel><item><title><![CDATA[Startups struggle with billing &amp; tax]]></title><link>https://news.example.com/a</link><description>painful workaround</description></item></channel></rss>`;
  const items = parseRssItems(xml, "googlenews");
  expect(items.length).toBe(1);
  expect(items[0].title).toBe("Startups struggle with billing & tax");
  expect(items[0].url).toBe("https://news.example.com/a");
  const viaConnector = await googleNews.search!("billing", (async () => resp(xml)) as FetchLike);
  expect(viaConnector[0].title).toContain("billing & tax");
});

test("pain extraction is HEURISTIC and selective: painful text scores, neutral text is 0", () => {
  const painful: WebSignal = { source: "hackernews", sourceType: "REAL", url: "u", title: "Frustrated: no good way to reconcile invoices, wish there was a tool", text: "we do it manually, it is tedious", engagement: 100 };
  const neutral: WebSignal = { source: "hackernews", sourceType: "REAL", url: "u2", title: "Show HN: my new landing page", text: "launched today", engagement: 500 };
  expect(painScore(painful)).toBeGreaterThan(4);
  expect(painScore(neutral)).toBe(0); // engagement alone never makes pain
});

test("clustering groups by dominant term; frequency/urgency from REAL counts; competitors captured", () => {
  const mk = (t: string, e: number): WebSignal => ({ source: "reddit", sourceType: "REAL", url: `https://r/${t}${e}`, title: t, text: "", engagement: e });
  const clusters = clusterPains([
    mk("invoice reconciliation is frustrating", 80),
    mk("invoice tools broken again, tired of this", 60),
    mk("wish there was an alternative to InvoiceBot for invoice teams", 40),
    mk("kubernetes upgrade nightmare", 10),
  ]);
  const inv = clusters.find((c) => c.key === "invoice")!;
  expect(inv.frequency).toBe(3); // three independent real signals
  expect(inv.urgency).toBe("HIGH"); // engagement 180 >= 100
  expect(inv.alternatives).toContain("InvoiceBot");
  expect(clusters.find((c) => c.key === "kubernetes")!.frequency).toBe(1);
});

test("unavailable connectors are honest: listed with status, never searched, never faked", async () => {
  const health = connectorHealth();
  for (const name of ["playstore-reviews", "trustpilot", "g2", "capterra"]) {
    const c = health.find((h) => h.name === name)!;
    expect(c.available).toBe(false);
    expect(c.kind).toBe("UNAVAILABLE");
  }
  const searchable = CONNECTORS.filter((c) => c.available() && c.search).map((c) => c.name);
  expect(searchable).not.toContain("trustpilot");
  // scanWeb with a seam: only available connectors are hit, per-connector errors recorded
  const hit: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    hit.push(new URL(url).hostname);
    if (url.includes("reddit")) throw new Error("reddit down");
    return resp({ hits: [], items: [], data: { children: [] } });
  };
  const r = await scanWeb({ focus: "WEBTEST topic", fetchImpl, maxQueries: 1 });
  expect(r.connectorsUsed).toContain("hackernews");
  expect(r.connectorErrors.reddit).toContain("reddit down"); // failure recorded, not papered over
  expect(hit.some((h) => h.includes("trustpilot"))).toBe(false);
});

test("scanWorld integrates WEB clusters: problems persist with REAL urls; mode is honest", async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.includes("hn.algolia.com")) return resp({ hits: [
      { title: "WEBTEST churnalarm setup is frustrating and broken", objectID: "1", points: 150, num_comments: 60 },
      { title: "WEBTEST churnalarm alternative to ChurnCo, tired of manual exports", objectID: "2", points: 90, num_comments: 30 },
    ] });
    return resp({ items: [], data: { children: [] } });
  };
  const r = await scanWorld({ focus: "WEBTEST churnalarm", fetchImpl, limit: 20 });
  expect(r.mode).toBe("WEB_LIVE");
  expect(r.sourcesScanned).toContain("hackernews");
  const webProblems = r.problems.filter((p) => p.dataSource === "WEB");
  expect(webProblems.length).toBeGreaterThan(0);
  const row = await db.worldProblem.findUnique({ where: { problemId: webProblems[0].problemId } });
  const evidence = JSON.parse(row!.evidence) as { source: string; type: string }[];
  expect(evidence[0].source).toContain("news.ycombinator.com"); // REAL url in the evidence trail
  expect(evidence[0].type).toBe("WEB");
});

test("scanWorld under bun test WITHOUT a seam never touches the network (mode INTERNAL_ONLY)", async () => {
  const r = await scanWorld({ limit: 3 });
  expect(r.mode).toBe("INTERNAL_ONLY"); // web skipped: test env, no seam — same discipline as llmDisabled
});
