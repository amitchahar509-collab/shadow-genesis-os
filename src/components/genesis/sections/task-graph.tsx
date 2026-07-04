"use client";

import { useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  Filter,
  GitBranch,
  Package,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  GenesisSummary,
  GenesisTask,
  DEPARTMENT_META,
  PRIORITY_COLOR,
  STATUS_COLOR,
  TaskPriority,
  TaskStatus,
  parseJson,
} from "@/lib/genesis/types";
import { Chip, GenesisProgress, HudPanel, timeAgo } from "../primitives";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: (TaskStatus | "ALL")[] = [
  "ALL",
  "PENDING",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "DONE",
  "FAILED",
];

const PRIORITY_OPTIONS: (TaskPriority | "ALL")[] = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function TaskGraph({ summary }: { summary: GenesisSummary }) {
  const { tasks, departments } = summary;
  const [status, setStatus] = useState<TaskStatus | "ALL">("ALL");
  const [priority, setPriority] = useState<TaskPriority | "ALL">("ALL");
  const [dept, setDept] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const taskMap = useMemo(() => {
    const m: Record<string, GenesisTask> = {};
    tasks.forEach((t) => (m[t.taskId] = t));
    return m;
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (status !== "ALL" && t.status !== status) return false;
      if (priority !== "ALL" && t.priority !== priority) return false;
      if (dept !== "ALL" && t.department !== dept) return false;
      if (q) {
        const ql = q.toLowerCase();
        if (
          !t.title.toLowerCase().includes(ql) &&
          !t.taskId.toLowerCase().includes(ql) &&
          !t.description.toLowerCase().includes(ql)
        )
          return false;
      }
      return true;
    });
  }, [tasks, status, priority, dept, q]);

  const selectedTask = selected ? tasks.find((t) => t.id === selected) ?? null : null;
  const dependents = useMemo(() => {
    if (!selectedTask) return [];
    return tasks.filter((t) => {
      const deps = parseJson<string[]>(t.dependencies, []);
      return deps.includes(selectedTask.taskId);
    });
  }, [selectedTask, tasks]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <HudPanel
        title="Task Graph · Execution Layer"
        subtitle={`${filtered.length} / ${tasks.length} tasks · dependency-aware`}
        icon={<Boxes className="w-3.5 h-3.5" />}
        accent="emerald"
        right={<Chip variant="emerald" dot>{filtered.length} shown</Chip>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-zinc-500 font-mono text-[10px] uppercase tracking-wider">
            <Filter className="w-3 h-3" /> filter
          </div>

          {/* status */}
          <FilterPills
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v) => setStatus(v as TaskStatus | "ALL")}
          />

          <span className="w-px h-4 bg-emerald-500/15 mx-1" />

          {/* priority */}
          <FilterPills
            options={PRIORITY_OPTIONS}
            value={priority}
            onChange={(v) => setPriority(v as TaskPriority | "ALL")}
          />

          <span className="w-px h-4 bg-emerald-500/15 mx-1" />

          {/* department */}
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="bg-black/40 border border-emerald-500/20 rounded px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none focus:border-emerald-500/50"
          >
            <option value="ALL">ALL DEPTS</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name.toUpperCase()}
              </option>
            ))}
          </select>

          {/* search */}
          <div className="relative flex-1 min-w-[140px] max-w-xs ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search tasks..."
              className="w-full bg-black/40 border border-emerald-500/20 rounded pl-7 pr-2 py-1 font-mono text-[10px] text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50"
            />
          </div>
        </div>
      </HudPanel>

      {/* Task list + detail */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Task list */}
        <div className="xl:col-span-2 space-y-2">
          {filtered.length === 0 && (
            <div className="genesis-panel rounded-md py-10 text-center font-mono text-xs text-zinc-600">
              no tasks match filters
            </div>
          )}
          {filtered.map((t) => {
            const meta = DEPARTMENT_META[t.department];
            const accent = meta?.accent ?? "emerald";
            const deps = parseJson<string[]>(t.dependencies, []);
            const isSel = selectedTask?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelected(isSel ? null : t.id)}
                className={cn(
                  "w-full text-left genesis-panel rounded-md p-3 transition-all",
                  isSel
                    ? "border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.3)]"
                    : "genesis-panel-hover"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                    <span
                      className={cn(
                        "w-8 h-8 rounded-sm border flex items-center justify-center font-mono text-[10px] font-bold",
                        accent === "emerald" && "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
                        accent === "cyan" && "border-cyan-500/40 text-cyan-400 bg-cyan-500/5",
                        accent === "amber" && "border-amber-500/40 text-amber-400 bg-amber-500/5",
                        accent === "rose" && "border-rose-500/40 text-rose-400 bg-rose-500/5",
                        accent === "violet" && "border-violet-500/40 text-violet-400 bg-violet-500/5"
                      )}
                    >
                      {t.taskId.replace("T-", "")}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-mono text-[12px] text-zinc-200 leading-tight">{t.title}</h4>
                      <ChevronRight
                        className={cn(
                          "w-3.5 h-3.5 text-zinc-600 shrink-0 transition-transform",
                          isSel && "rotate-90 text-emerald-400"
                        )}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <Chip variant={accent}>{meta?.label ?? t.department}</Chip>
                      <span className={cn("chip", PRIORITY_COLOR[t.priority])}>{t.priority}</span>
                      <span className={cn("chip", STATUS_COLOR[t.status])} dot={t.status === "IN_PROGRESS"}>
                        {t.status.replace("_", " ")}
                      </span>
                      {deps.length > 0 && (
                        <span className="chip chip-zinc">
                          <GitBranch className="w-2.5 h-2.5" /> {deps.length} dep
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[9px] text-zinc-600">
                        {t.actualHours}h / {t.estimatedHours}h
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <GenesisProgress value={t.progress} accent={accent} showShimmer={t.status === "IN_PROGRESS"} className="flex-1" />
                      <span className="font-mono text-[10px] text-zinc-400 w-8 text-right">{t.progress}%</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        <HudPanel
          title="Task Detail"
          subtitle={selectedTask ? selectedTask.taskId : "select a task"}
          icon={<Package className="w-3.5 h-3.5" />}
          accent="cyan"
          bodyClassName="p-4"
        >
          {!selectedTask ? (
            <div className="py-10 text-center font-mono text-xs text-zinc-600">
              click a task to inspect
              <br />
              dependencies, artifacts & validation
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">title</div>
                <div className="font-mono text-[12px] text-zinc-200">{selectedTask.title}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">description</div>
                <div className="font-mono text-[11px] text-zinc-400 leading-relaxed">
                  {selectedTask.description}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DetailField label="owner" value={selectedTask.ownerAgent} />
                <DetailField label="department" value={selectedTask.department} />
                <DetailField label="priority" value={selectedTask.priority} />
                <DetailField label="status" value={selectedTask.status.replace("_", " ")} />
              </div>

              <div>
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">progress</div>
                <div className="flex items-center gap-2">
                  <GenesisProgress value={selectedTask.progress} accent="cyan" showShimmer={selectedTask.status === "IN_PROGRESS"} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan-400">{selectedTask.progress}%</span>
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">expected artifact</div>
                <div className="font-mono text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/15 rounded px-2 py-1.5">
                  <Package className="w-3 h-3 inline mr-1.5 -mt-0.5" />
                  {selectedTask.expectedArtifact || "—"}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">validation criteria</div>
                <div className="flex items-start gap-1.5 font-mono text-[11px] text-zinc-400">
                  <ShieldCheck className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                  <span>{selectedTask.validation || "—"}</span>
                </div>
              </div>

              {/* dependencies */}
              <div>
                <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                  depends on · {parseJson<string[]>(selectedTask.dependencies, []).length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {parseJson<string[]>(selectedTask.dependencies, []).length === 0 && (
                    <span className="font-mono text-[11px] text-zinc-600">no dependencies · entry task</span>
                  )}
                  {parseJson<string[]>(selectedTask.dependencies, []).map((depId) => {
                    const dep = taskMap[depId];
                    return (
                      <span
                        key={depId}
                        className={cn(
                          "chip",
                          dep?.status === "DONE" ? "chip-emerald" : dep ? "chip-amber" : "chip-zinc"
                        )}
                      >
                        <GitBranch className="w-2.5 h-2.5" /> {depId}
                        {dep ? ` · ${dep.status.replace("_", " ")}` : " · missing"}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* dependents */}
              {dependents.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                    blocks · {dependents.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dependents.map((d) => (
                      <span key={d.id} className="chip chip-cyan">
                        {d.taskId} · {d.title.slice(0, 24)}
                        {d.title.length > 24 ? "…" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-emerald-500/10">
                <DetailField label="est. hrs" value={String(selectedTask.estimatedHours)} />
                <DetailField label="actual hrs" value={String(selectedTask.actualHours)} />
                <DetailField
                  label="updated"
                  value={timeAgo(selectedTask.updatedAt)}
                />
              </div>
            </div>
          )}
        </HudPanel>
      </div>
    </div>
  );
}

function FilterPills({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded border transition-colors",
            value === opt
              ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
              : "border-emerald-500/15 text-zinc-500 hover:text-zinc-300 hover:border-emerald-500/30"
          )}
        >
          {opt.replace("_", " ")}
        </button>
      ))}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{label}</div>
      <div className="font-mono text-[11px] text-zinc-300">{value}</div>
    </div>
  );
}
