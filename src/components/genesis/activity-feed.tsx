"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ActivityLog, LEVEL_COLOR } from "@/lib/genesis/types";
import { timeAgo } from "./primitives";
import { cn } from "@/lib/utils";

const AGENT_COLORS: Record<string, string> = {
  CEO: "text-amber-400",
  RESEARCH: "text-cyan-400",
  PRODUCT: "text-violet-400",
  ENGINEERING: "text-emerald-400",
  AI_SYSTEMS: "text-emerald-300",
  DESIGN: "text-rose-400",
  GROWTH: "text-cyan-300",
  QUALITY: "text-amber-300",
  SELF_CORRECTION: "text-emerald-400",
  SECURITY: "text-rose-300",
  FEEDBACK: "text-violet-300",
};

const LEVEL_DOT: Record<string, string> = {
  INFO: "bg-cyan-400",
  SUCCESS: "bg-emerald-400",
  WARNING: "bg-amber-400",
  ERROR: "bg-rose-400",
  CRITICAL: "bg-rose-500",
};

export function ActivityFeed({
  initial,
  maxHeight = "max-h-[420px]",
}: {
  initial: ActivityLog[];
  maxHeight?: string;
}) {
  const [items, setItems] = useState<ActivityLog[]>(initial);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const seenRef = useRef<Set<string>>(new Set(initial.map((i) => i.id)));
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // WebSocket live push (instant). Falls back to polling if it fails.
  useEffect(() => {
    let cancelled = false;
    try {
      const socket = io("/?XTransformPort=3030", {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        timeout: 4000,
      });
      socketRef.current = socket;
      socket.on("connect", () => !cancelled && setConnected(true));
      socket.on("disconnect", () => !cancelled && setConnected(false));
      socket.on("activity", (log: ActivityLog) => {
        if (cancelled) return;
        if (seenRef.current.has(log.id)) return;
        seenRef.current.add(log.id);
        setItems((prev) => [log, ...prev].slice(0, 60));
      });
      // ask the server for a snapshot
      socket.on("connect", () => socket.emit("request-snapshot"));
      socket.on("snapshot", (logs: ActivityLog[]) => {
        if (cancelled) return;
        const fresh = logs.filter((l) => !seenRef.current.has(l.id));
        fresh.forEach((l) => seenRef.current.add(l.id));
        if (fresh.length) setItems((prev) => [...fresh, ...prev].slice(0, 60));
      });
    } catch {
      // socket.io-client may throw in unsupported envs; polling covers us
    }
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Polling fallback — syncs with DB every 6s
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/genesis/activity?limit=40");
        const data = await res.json();
        const fresh: ActivityLog[] = (data.activity ?? []).filter(
          (l: ActivityLog) => !seenRef.current.has(l.id)
        );
        if (fresh.length) {
          fresh.forEach((l) => seenRef.current.add(l.id));
          setItems((prev) => [...fresh, ...prev].slice(0, 60));
        }
      } catch {
        /* ignore */
      }
    }, 6000);
    return () => clearInterval(t);
  }, []);

  // auto-scroll handling
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [items, autoScroll]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              connected ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)]" : "bg-amber-400"
            )}
          />
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            {connected ? "live · ws" : "polling"}
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-600">{items.length} events</span>
      </div>
      <div
        ref={containerRef}
        className={cn("overflow-y-auto scroll-genesis space-y-1.5 pr-1", maxHeight)}
        onMouseEnter={() => setAutoScroll(false)}
        onMouseLeave={() => setAutoScroll(true)}
      >
        {items.length === 0 && (
          <div className="text-zinc-600 font-mono text-xs py-6 text-center">
            no activity yet · awaiting agent events
          </div>
        )}
        {items.map((log) => (
          <div
            key={log.id}
            className="group flex gap-2 px-2 py-1.5 rounded border border-transparent hover:border-emerald-500/15 hover:bg-emerald-500/5 transition-colors"
          >
            <span
              className={cn(
                "mt-1 w-1.5 h-1.5 rounded-full shrink-0",
                LEVEL_DOT[log.level] ?? "bg-zinc-400"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={cn(
                    "font-mono text-[10px] font-semibold tracking-wide",
                    AGENT_COLORS[log.agent] ?? "text-zinc-300"
                  )}
                >
                  {log.agent}
                </span>
                <span className="font-mono text-[10px] text-zinc-600">·</span>
                <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-wide">
                  {log.action}
                </span>
                {log.taskId && (
                  <>
                    <span className="font-mono text-[10px] text-zinc-600">·</span>
                    <span className="font-mono text-[10px] text-emerald-400/70">{log.taskId}</span>
                  </>
                )}
                <span className="ml-auto font-mono text-[9px] text-zinc-600">
                  {timeAgo(log.createdAt)}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 font-mono leading-relaxed mt-0.5 break-words">
                {log.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
