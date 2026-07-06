/** Memory Engine V4 — episodic / semantic / procedural with semantic similarity + similar-mission recall. */

import { db } from "@/lib/db";

export type MemoryType = "EPISODIC" | "SEMANTIC" | "PROCEDURAL";

export interface MemoryRecord {
  id: string; type: MemoryType; title: string; content: string;
  tags: string[]; importance: number; source: string | null;
  decayable: boolean; createdAt: Date; updatedAt: Date;
}

export interface RecallResult extends MemoryRecord { score: number; matchedTags: string[]; similarity?: number; }

function parseTags(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }

export class MemoryEngine {
  async record(params: { type: MemoryType; title: string; content: string; tags?: string[]; importance?: number; source?: string; decayable?: boolean; }): Promise<MemoryRecord> {
    const created = await db.memoryEntry.create({ data: { type: params.type, title: params.title, content: params.content, tags: JSON.stringify(params.tags ?? []), importance: Math.min(Math.max(params.importance ?? 5, 1), 10), source: params.source ?? null } });
    return this.rowToRecord(created);
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const row = await db.memoryEntry.findUnique({ where: { id } });
    return row ? this.rowToRecord(row) : null;
  }

  async recall(params: { query?: string; tags?: string[]; type?: MemoryType; limit?: number; }): Promise<RecallResult[]> {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
    const where: Record<string, unknown> = {};
    if (params.type) where.type = params.type;
    const rows = await db.memoryEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    const q = (params.query ?? "").toLowerCase().trim();
    const qTokens = new Set(q.split(/\s+/).filter((t) => t.length > 2));
    const tags = params.tags ?? [];
    const scored: RecallResult[] = rows.map((r) => {
      const rec = this.rowToRecord(r);
      const titleLc = rec.title.toLowerCase();
      const contentLc = rec.content.toLowerCase();
      let score = 0;
      const matchedTags: string[] = [];
      for (const t of tags) { if (rec.tags.includes(t)) { score += 5; matchedTags.push(t); } }
      // Token overlap (Jaccard-like)
      const titleTokens = new Set(titleLc.split(/\s+/).filter((t) => t.length > 2));
      const contentTokens = new Set(contentLc.split(/\s+/).filter((t) => t.length > 2));
      let overlap = 0;
      for (const t of qTokens) { if (titleTokens.has(t)) { score += 3; overlap++; } if (contentTokens.has(t)) { score += 1; overlap++; } }
      const union = new Set([...qTokens, ...titleTokens]);
      const similarity = union.size > 0 ? overlap / union.size : 0;
      score += rec.importance * 0.5;
      const ageH = (Date.now() - rec.createdAt.getTime()) / 3_600_000;
      if (ageH < 24) score += 2;
      return { ...rec, score, matchedTags, similarity };
    });
    return scored.filter((r) => r.score > 0 || qTokens.size === 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async relevant(params: { agent: string; goal: string; limit?: number; }): Promise<RecallResult[]> {
    const tokens = params.goal.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t && t.length > 2);
    const proc = await this.recall({ tags: [params.agent.toLowerCase()], type: "PROCEDURAL", limit: 5 });
    const sem = await this.recall({ query: tokens.slice(0, 6).join(" "), type: "SEMANTIC", limit: 5 });
    const epi = await this.recall({ type: "EPISODIC", limit: 5 });
    const map = new Map<string, RecallResult>();
    for (const r of [...proc, ...sem, ...epi]) { const prev = map.get(r.id); if (!prev || prev.score < r.score) map.set(r.id, r); }
    return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, params.limit ?? 8);
  }

  /** Find past executions with goals similar to the given one. Uses token overlap. */
  async similarMissions(goal: string, limit = 5): Promise<RecallResult[]> {
    return this.recall({ query: goal, type: "EPISODIC", limit });
  }

  /** Recall past failures to prevent repeating them. */
  async failurePrevention(tool: string, operation: string): Promise<RecallResult[]> {
    return this.recall({ query: `${tool} ${operation} failed error`, tags: ["failure", "error"], limit: 3 });
  }

  async consolidate(params: { sinceHours?: number; minCount?: number; } = {}): Promise<{ groupsProcessed: number; proceduresCreated: number; }> {
    const since = new Date(Date.now() - (params.sinceHours ?? 24) * 3_600_000);
    const recent = await db.memoryEntry.findMany({ where: { type: "EPISODIC", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 });
    const minCount = params.minCount ?? 3;
    const groups = new Map<string, typeof recent>();
    for (const r of recent) {
      const tags = parseTags(r.tags);
      const key = tags[0] ?? "untagged";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    let proceduresCreated = 0;
    for (const [tag, entries] of groups) {
      if (entries.length < minCount) continue;
      const titles = entries.slice(0, 8).map((e) => `- ${e.title}`).join("\n");
      const content = `Consolidated from ${entries.length} episodic memories (tag: ${tag}):\n${titles}\n\nPattern: recurring events suggest a stable procedure.`;
      await this.record({ type: "PROCEDURAL", title: `SOP · ${tag} · ${new Date().toISOString().slice(0, 10)}`, content, tags: [tag, "consolidated", "sop"], importance: 7, source: "memory_engine:consolidate" });
      proceduresCreated++;
    }
    return { groupsProcessed: groups.size, proceduresCreated };
  }

  asTool() {
    const record = (p: Parameters<MemoryEngine["record"]>[0]) => this.record(p);
    const recall = (p: Parameters<MemoryEngine["recall"]>[0]) => this.recall(p);
    const relevant = (p: Parameters<MemoryEngine["relevant"]>[0]) => this.relevant(p);
    const consolidate = (p: Parameters<MemoryEngine["consolidate"]>[0]) => this.consolidate(p);
    const similarMissions = (g: string, l?: number) => this.similarMissions(g, l);
    const failurePrevention = (t: string, o: string) => this.failurePrevention(t, o);
    return {
      name: "memory" as const,
      description: "Memory engine. Operations: record, recall, relevant, consolidate, similarMissions, failurePrevention",
      operations: ["record", "recall", "relevant", "consolidate", "similarMissions", "failurePrevention"],
      async execute(operation: string, input: Record<string, unknown>) {
        try {
          if (operation === "record") {
            const r = await record({ type: (input.type as MemoryType) ?? "EPISODIC", title: String(input.title ?? ""), content: String(input.content ?? ""), tags: Array.isArray(input.tags) ? (input.tags as string[]).map(String) : [], importance: typeof input.importance === "number" ? input.importance : 5, source: input.source ? String(input.source) : undefined });
            return { ok: true, summary: `recorded ${r.type}: ${r.title}`, result: { id: r.id, type: r.type, title: r.title } };
          }
          if (operation === "recall") {
            const results = await recall({ query: input.query ? String(input.query) : undefined, tags: Array.isArray(input.tags) ? (input.tags as string[]).map(String) : undefined, type: input.type as MemoryType | undefined, limit: typeof input.limit === "number" ? input.limit : 10 });
            return { ok: true, summary: `recall → ${results.length} memories`, result: { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, score: r.score, type: r.type, tags: r.tags, similarity: r.similarity })) }, raw: JSON.stringify(results, null, 2) };
          }
          if (operation === "relevant") {
            const results = await relevant({ agent: String(input.agent ?? "AGENT"), goal: String(input.goal ?? ""), limit: typeof input.limit === "number" ? input.limit : 8 });
            return { ok: true, summary: `relevant for "${input.agent}" → ${results.length}`, result: { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, score: r.score, type: r.type })) } };
          }
          if (operation === "consolidate") {
            const r = await consolidate({ sinceHours: typeof input.sinceHours === "number" ? input.sinceHours : 24, minCount: typeof input.minCount === "number" ? input.minCount : 3 });
            return { ok: true, summary: `consolidated → ${r.proceduresCreated} SOPs`, result: r };
          }
          if (operation === "similarMissions") {
            const results = await similarMissions(String(input.goal ?? ""), typeof input.limit === "number" ? input.limit : 5);
            return { ok: true, summary: `similar missions → ${results.length}`, result: { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, score: r.score, similarity: r.similarity })) } };
          }
          if (operation === "failurePrevention") {
            const results = await failurePrevention(String(input.tool ?? ""), String(input.operation ?? ""));
            return { ok: true, summary: `failure prevention → ${results.length} past failures`, result: { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, content: r.content.slice(0, 200) })) } };
          }
          return { ok: false, summary: `unknown memory op: ${operation}`, error: "UNKNOWN_OP" };
        } catch (e) { return { ok: false, summary: `memory ${operation} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
      },
    };
  }

  private rowToRecord(row: { id: string; type: string; title: string; content: string; tags: string; importance: number; source: string | null; createdAt: Date; updatedAt: Date; }): MemoryRecord {
    return { id: row.id, type: row.type as MemoryType, title: row.title, content: row.content, tags: parseTags(row.tags), importance: row.importance, source: row.source, decayable: false, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
}

let _engine: MemoryEngine | null = null;
export function getMemoryEngine(): MemoryEngine { if (!_engine) _engine = new MemoryEngine(); return _engine; }
