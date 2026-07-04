"use client";

import { cn } from "@/lib/utils";
import { useSyncExternalStore } from "react";

// ---------- Singleton "now" store ----------
// useSyncExternalStore requires getSnapshot to return a STABLE reference between
// renders (until the store notifies). `new Date()` returns a new object every
// call → infinite loop. We cache the Date in a module-level slot and only
// reassign it when the shared interval fires. Returns null on the server.
let _now: Date | null = null;
let _nowInterval: ReturnType<typeof setInterval> | null = null;
const _nowListeners = new Set<() => void>();

function subscribeNow(cb: () => void): () => void {
  _nowListeners.add(cb);
  if (!_nowInterval) {
    _now = new Date();
    _nowInterval = setInterval(() => {
      _now = new Date();
      _nowListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    _nowListeners.delete(cb);
    if (_nowListeners.size === 0 && _nowInterval) {
      clearInterval(_nowInterval);
      _nowInterval = null;
      _now = null;
    }
  };
}

function getNowSnapshot(): Date | null {
  return _now;
}

// ---------- HUD Panel ----------
export function HudPanel({
  title,
  subtitle,
  icon,
  accent = "emerald",
  className,
  bodyClassName,
  children,
  right,
}: {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent?: "emerald" | "cyan" | "amber" | "rose" | "violet";
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const accentText: Record<string, string> = {
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
    violet: "text-violet-400",
  };
  const accentBorder: Record<string, string> = {
    emerald: "before:border-emerald-500/40 after:border-emerald-500/40",
    cyan: "before:border-cyan-500/40 after:border-cyan-500/40",
    amber: "before:border-amber-500/40 after:border-amber-500/40",
    rose: "before:border-rose-500/40 after:border-rose-500/40",
    violet: "before:border-violet-500/40 after:border-violet-500/40",
  };
  return (
    <section
      className={cn(
        "genesis-panel genesis-panel-hover hud-corners rounded-md relative",
        accentBorder[accent],
        className
      )}
    >
      {(title || right) && (
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-500/10">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className={cn("shrink-0", accentText[accent])}>{icon}</span>}
            <div className="min-w-0">
              {title && (
                <h3 className="font-mono text-[11px] tracking-[0.18em] uppercase text-zinc-200 truncate">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-[10px] text-zinc-500 font-mono truncate">{subtitle}</p>
              )}
            </div>
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---------- Status Chip ----------
export function Chip({
  variant = "zinc",
  children,
  className,
  dot,
}: {
  variant?: "emerald" | "cyan" | "amber" | "rose" | "violet" | "zinc";
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const dotColor: Record<string, string> = {
    emerald: "bg-emerald-400",
    cyan: "bg-cyan-400",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
    violet: "bg-violet-400",
    zinc: "bg-zinc-400",
  };
  return (
    <span className={cn("chip", `chip-${variant}`, className)}>
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", dotColor[variant])} />}
      {children}
    </span>
  );
}

// ---------- Live Clock ----------
export function LiveClock({ className }: { className?: string }) {
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, () => null);
  if (!now) return <span className={cn("font-mono tabular-nums", className)}>--:--:--</span>;
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {now.toLocaleTimeString("en-GB", { hour12: false })}
    </span>
  );
}

// ---------- Uptime counter ----------
export function UptimeCounter({ startIso, className }: { startIso: string; className?: string }) {
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, () => null);
  const startMs = new Date(startIso).getTime();
  if (!now) return <span className={cn("font-mono tabular-nums", className)}>00:00:00</span>;
  const secs = Math.max(0, Math.floor((now.getTime() - startMs) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

// ---------- Progress Bar ----------
export function GenesisProgress({
  value,
  accent = "emerald",
  className,
  showShimmer = false,
}: {
  value: number;
  accent?: "emerald" | "cyan" | "amber" | "rose" | "violet";
  className?: string;
  showShimmer?: boolean;
}) {
  const barColor: Record<string, string> = {
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  };
  const glowColor: Record<string, string> = {
    emerald: "shadow-[0_0_10px_rgba(16,185,129,0.6)]",
    cyan: "shadow-[0_0_10px_rgba(34,211,238,0.6)]",
    amber: "shadow-[0_0_10px_rgba(245,158,11,0.6)]",
    rose: "shadow-[0_0_10px_rgba(244,63,94,0.6)]",
    violet: "shadow-[0_0_10px_rgba(168,85,247,0.6)]",
  };
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-zinc-800/80 overflow-hidden relative", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", barColor[accent], glowColor[accent])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      >
        {showShimmer && value > 0 && value < 100 && (
          <div className="absolute inset-0 shimmer" />
        )}
      </div>
    </div>
  );
}

// ---------- KPI Stat ----------
export function KpiStat({
  label,
  value,
  unit,
  accent = "emerald",
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: "emerald" | "cyan" | "amber" | "rose" | "violet";
  sub?: string;
  icon?: React.ReactNode;
}) {
  const text: Record<string, string> = {
    emerald: "text-emerald-400 glow-emerald",
    cyan: "text-cyan-400 glow-cyan",
    amber: "text-amber-400 glow-amber",
    rose: "text-rose-400 glow-rose",
    violet: "text-violet-400",
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn("text-2xl font-mono font-semibold tabular-nums", text[accent])}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-zinc-500 font-mono">{unit}</span>}
      </div>
      {sub && <span className="text-[10px] text-zinc-600 font-mono">{sub}</span>}
    </div>
  );
}

// ---------- Empty State ----------
export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-zinc-600 font-mono text-xs">
      {label}
    </div>
  );
}

// ---------- Relative time ----------
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
