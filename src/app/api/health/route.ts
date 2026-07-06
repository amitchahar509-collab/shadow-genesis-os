import { NextResponse } from "next/server";
import { validateEnv } from "@/lib/env";
import { db } from "@/lib/db";

/** GET /api/health — system health check */
export async function GET() {
  const envChecks = validateEnv();
  const missingRequired = envChecks.filter((c) => c.required && !c.set).map((c) => c.name);
  
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await db.activityLog.count({ take: 1 });
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const status = missingRequired.length === 0 && dbOk ? "ok" : "degraded";
  return NextResponse.json({
    status,
    checks: {
      database: { ok: dbOk, error: dbError },
      env: envChecks,
    },
    missing: missingRequired,
    timestamp: new Date().toISOString(),
  });
}
