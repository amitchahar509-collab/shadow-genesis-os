"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Brain,
  Database,
  Plus,
  Search,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { MemoryEntry } from "@/lib/genesis/types";
import { Chip, GenesisProgress, HudPanel } from "../primitives";
import { cn } from "@/lib/utils";

const TYPES = [
  {
    key: "EPISODIC" as const,
    label: "Episodic Memory",
    icon: <BookOpen className="w-3.5 h-3.5" />,
    accent: "cyan" as const,
    desc: "what happened · what failed · what succeeded",
  },
  {
    key: "SEMANTIC" as const,
    label: "Semantic Memory",
    icon: <Brain className="w-3.5 h-3.5" />,
    accent: "emerald" as const,
    desc: "knowledge · rules · facts · architecture",
  },
  {
    key: "PROCEDURAL" as const,
    label: "Procedural Memory",
    icon: <Workflow className="w-3.5 h-3.5" />,
    accent: "violet" as const,
    desc: "best workflows · execution patterns · SOPs",
  },
];

export function MemoryBanks({ initial }: { initial: MemoryEntry[] }) {
  const [memory, setMemory] = useState<MemoryEntry[]>(initial);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [activeType, setActiveType] = useState<MemoryEntry["type"] | "ALL">("ALL");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/genesis/memory");
        const data = await res.json();
        if (mounted && Array.isArray(data.memory)) setMemory(data.memory);
      } catch {
        /* ignore */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    return memory.filter((m) => {
      if (activeType !== "ALL" && m.type !== activeType) return false;
      if (q) {
        const ql = q.toLowerCase();
        if (
          !m.title.toLowerCase().includes(ql) &&
          !m.content.toLowerCase().includes(ql)
        )
          return false;
      }
      return true;
    });
  }, [memory, q, activeType]);

  const byType = useMemo(() => {
    const m: Record<string, MemoryEntry[]> = { EPISODIC: [], SEMANTIC: [], PROCEDURAL: [] };
    filtered.forEach((e) => {
      (m[e.type] ??= []).push(e);
    });
    return m;
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* header + search */}
      <HudPanel
        title="Memory Architecture"
        subtitle={`${memory.length} entries · episodic → semantic → procedural consolidation`}
        icon={<Database className="w-3.5 h-3.5" />}
        accent="emerald"
        right={
          <button
            onClick={() => setShowAdd(true)}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" /> new entry
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveType("ALL")}
              className={cn(
                "font-mono text-[9px] uppercase tracking-wider px-2.5 py-1 rounded border transition-colors",
                activeType === "ALL"
                  ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                  : "border-emerald-500/15 text-zinc-500 hover:text-zinc-300"
              )}
            >
              ALL · {memory.length}
            </button>
            {TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveType(t.key)}
                className={cn(
                  "font-mono text-[9px] uppercase tracking-wider px-2.5 py-1 rounded border transition-colors",
                  activeType === t.key
                    ? `border-${t.accent}-500/50 text-${t.accent}-400 bg-${t.accent}-500/10`
                    : "border-emerald-500/15 text-zinc-500 hover:text-zinc-300"
                )}
                style={
                  activeType === t.key
                    ? {
                        borderColor:
                          t.accent === "cyan"
                            ? "rgba(34,211,238,0.5)"
                            : t.accent === "emerald"
                            ? "rgba(16,185,129,0.5)"
                            : "rgba(168,85,247,0.5)",
                        color:
                          t.accent === "cyan"
                            ? "#22d3ee"
                            : t.accent === "emerald"
                            ? "#10b981"
                            : "#a855f7",
                        backgroundColor:
                          t.accent === "cyan"
                            ? "rgba(34,211,238,0.1)"
                            : t.accent === "emerald"
                            ? "rgba(16,185,129,0.1)"
                            : "rgba(168,85,247,0.1)",
                      }
                    : undefined
                }
              >
                {t.label.split(" ")[0]} · {memory.filter((m) => m.type === t.key).length}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[140px] max-w-xs ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search memory..."
              className="w-full bg-black/40 border border-emerald-500/20 rounded pl-7 pr-2 py-1.5 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50"
            />
          </div>
        </div>
      </HudPanel>

      {/* Three columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {TYPES.map((t) => (
          <HudPanel
            key={t.key}
            title={t.label}
            subtitle={t.desc}
            icon={t.icon}
            accent={t.accent}
            bodyClassName="p-3"
          >
            {loading ? (
              <div className="py-8 text-center font-mono text-xs text-zinc-600">loading…</div>
            ) : byType[t.key].length === 0 ? (
              <div className="py-8 text-center font-mono text-xs text-zinc-600">no entries</div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto scroll-genesis pr-1">
                {byType[t.key].map((entry) => {
                  const tags = safeParse<string[]>(entry.tags, []);
                  return (
                    <div
                      key={entry.id}
                      className="rounded border border-emerald-500/10 bg-black/30 p-2.5 hover:border-emerald-500/25 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-mono text-[11px] text-zinc-200 leading-tight">
                          {entry.title}
                        </h4>
                        <span className="font-mono text-[9px] text-zinc-600 shrink-0">
                          {entry.importance}/10
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-zinc-400 leading-relaxed">
                        {entry.content}
                      </p>
                      <div className="flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-emerald-500/10">
                        {entry.source && (
                          <span className="chip chip-zinc">{entry.source}</span>
                        )}
                        {tags.map((tag) => (
                          <span key={tag} className="chip chip-cyan">
                            #{tag}
                          </span>
                        ))}
                        <span className="ml-auto font-mono text-[9px] text-zinc-600">
                          importance
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <GenesisProgress value={entry.importance * 10} accent={t.accent} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </HudPanel>
        ))}
      </div>

      {showAdd && (
        <AddMemoryModal
          onClose={() => setShowAdd(false)}
          onCreated={(entry) => {
            setMemory((p) => [entry, ...p]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddMemoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (entry: MemoryEntry) => void;
}) {
  const [type, setType] = useState<MemoryEntry["type"]>("SEMANTIC");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [importance, setImportance] = useState(7);
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !content.trim()) {
      setErr("title and content required");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/genesis/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: title.trim(),
          content: content.trim(),
          tags: JSON.stringify(
            tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          ),
          importance,
          source: source.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const data = await res.json();
      onCreated(data.memory as MemoryEntry);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="genesis-panel rounded-md w-full max-w-lg">
        <header className="flex items-center justify-between px-4 py-3 border-b border-emerald-500/15">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h3 className="font-mono text-[12px] tracking-[0.15em] uppercase text-zinc-200">
              Write to Memory
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto scroll-genesis">
          <div>
            <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">type</label>
            <div className="flex gap-1.5 mt-1">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setType(t.key)}
                  className={cn(
                    "flex-1 font-mono text-[10px] uppercase tracking-wider px-2 py-1.5 rounded border transition-colors",
                    type === t.key
                      ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                      : "border-emerald-500/15 text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {t.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-emerald-500/20 rounded px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-emerald-500/50"
              placeholder="concise memory title…"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="mt-1 w-full bg-black/40 border border-emerald-500/20 rounded px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-emerald-500/50 resize-none"
              placeholder="full memory content…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">tags (comma)</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="mt-1 w-full bg-black/40 border border-emerald-500/20 rounded px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-emerald-500/50"
                placeholder="ai, cost, sop"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">source</label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 w-full bg-black/40 border border-emerald-500/20 rounded px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-emerald-500/50"
                placeholder="ENGINEERING"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">importance</label>
              <span className="font-mono text-[11px] text-emerald-400">{importance}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className="mt-2 w-full accent-emerald-500"
            />
          </div>
          {err && (
            <div className="font-mono text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1.5">
              {err}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-emerald-500/15">
          <button
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800/50"
          >
            cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border border-emerald-500/50 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {saving ? "writing…" : "commit memory"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
