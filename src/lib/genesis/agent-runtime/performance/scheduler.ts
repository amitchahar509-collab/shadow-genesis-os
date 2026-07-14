/** Dependency-Aware Parallel Scheduler (V10 Module 12).
 *
 * Plans and runs a task graph: independent tasks execute in PARALLEL, dependents
 * WAIT for their prerequisites. Uses Kahn's algorithm for topological layering
 * (with real cycle detection). runScheduled measures REAL wall time and compares
 * it to the measured serial sum — the speedup is observed, never fabricated.
 *
 * Never violates approval gates: the runner is the caller's function; gating
 * (approvals/security) lives inside it, unchanged.
 */

export interface PlanTask { id: string; dependsOn?: string[] }

export interface Plan { layers: string[][]; parallelizable: number; maxWidth: number; critical: number }

/** Topologically layer a task graph. Each layer's tasks have no unmet deps and
 *  can run in parallel. Throws on a dependency cycle (real detection). */
export function planParallel(tasks: PlanTask[]): Plan {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  const deps = new Map<string, string[]>();
  for (const t of tasks) {
    const d = (t.dependsOn ?? []).filter((x) => ids.has(x));
    deps.set(t.id, d);
    indeg.set(t.id, d.length);
  }
  const layers: string[][] = [];
  let frontier = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const done = new Set<string>();
  while (frontier.length) {
    layers.push([...frontier].sort());
    for (const id of frontier) done.add(id);
    const next: string[] = [];
    for (const t of tasks) {
      if (done.has(t.id)) continue;
      const d = deps.get(t.id) ?? [];
      if (d.every((x) => done.has(x)) && !next.includes(t.id)) next.push(t.id);
    }
    frontier = next;
  }
  if (done.size !== tasks.length) throw new Error(`dependency cycle detected: ${tasks.filter((t) => !done.has(t.id)).map((t) => t.id).join(", ")}`);
  const maxWidth = layers.reduce((m, l) => Math.max(m, l.length), 0);
  return { layers, parallelizable: tasks.length - layers.length + (layers.length ? 0 : 0), maxWidth, critical: layers.length };
}

export interface RunResult<T> {
  results: Map<string, { ok: boolean; value?: T; error?: string; ms: number }>;
  wallMs: number;            // measured real wall time (parallel)
  serialMs: number;          // measured sum of per-task times (what serial would cost)
  speedup: number;           // serialMs / wallMs (observed)
  layers: number;
  cancelled: string[];
}

/** Run a task graph layer-by-layer, tasks WITHIN a layer in parallel (bounded by
 *  `concurrency`). Measures real wall time vs the measured serial sum. A signal
 *  can cancel remaining layers (automatic cancellation). */
export async function runScheduled<T>(
  tasks: PlanTask[],
  runner: (id: string) => Promise<T>,
  opts?: { concurrency?: number; signal?: { cancelled: boolean } },
): Promise<RunResult<T>> {
  const plan = planParallel(tasks);
  const concurrency = Math.max(1, opts?.concurrency ?? 8);
  const results = new Map<string, { ok: boolean; value?: T; error?: string; ms: number }>();
  const cancelled: string[] = [];
  const wallStart = performance.now();
  let serialMs = 0;

  for (const layer of plan.layers) {
    if (opts?.signal?.cancelled) { cancelled.push(...layer); continue; }
    // bounded parallelism within the layer
    for (let i = 0; i < layer.length; i += concurrency) {
      const slice = layer.slice(i, i + concurrency);
      await Promise.all(slice.map(async (id) => {
        if (opts?.signal?.cancelled) { cancelled.push(id); return; }
        const t0 = performance.now();
        try { const value = await runner(id); const ms = performance.now() - t0; serialMs += ms; results.set(id, { ok: true, value, ms: Math.round(ms) }); }
        catch (e) { const ms = performance.now() - t0; serialMs += ms; results.set(id, { ok: false, error: e instanceof Error ? e.message : String(e), ms: Math.round(ms) }); }
      }));
    }
  }
  const wallMs = performance.now() - wallStart;
  return { results, wallMs: Math.round(wallMs), serialMs: Math.round(serialMs), speedup: wallMs > 0 ? Math.round((serialMs / wallMs) * 100) / 100 : 1, layers: plan.layers.length, cancelled };
}
