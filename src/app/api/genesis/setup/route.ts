import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { setupReadiness } from "@/lib/genesis/setup-check";

/** GET /api/genesis/setup — real readiness snapshot for the Setup Wizard. */
export async function GET() {
  return NextResponse.json(await setupReadiness());
}

/** POST /api/genesis/setup — { action: "init-db" } runs the real schema push. */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "ADMIN");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  if (b.action !== "init-db") return NextResponse.json({ error: "action must be init-db" }, { status: 400 });
  try {
    const proc = Bun.spawn(["bun", "x", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    await proc.exited;
    const ok = proc.exitCode === 0;
    return NextResponse.json({ ok, detail: ok ? "database initialized" : "init failed", log: out.slice(-600) }, { status: ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
