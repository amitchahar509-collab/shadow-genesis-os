/** Test preload — COMPLETE isolation from production state.
 *
 * This file is preloaded (bunfig.toml [test].preload) before ANY test — and
 * critically before `@/lib/db` or any agent module is imported — so the env it
 * sets is the env those modules see at construction time.
 *
 * Two jobs:
 *  1. Deterministic, offline, token-free runs — clear ambient LLM provider keys.
 *  2. Total state isolation — the suite must NEVER touch the production database,
 *     deployment records, generated workspaces, or running apps. Every stateful
 *     path is redirected into a dedicated, disposable test environment:
 *       - database   → <root>/.genesis-test-env/test.db  (fresh schema each run)
 *       - workspace  → <root>/.genesis-test-env/workspace (agent sandboxes/repos)
 *       - deploys    → hard-disabled (no real process/port is ever spawned)
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ── 1. Offline, key-free reasoning ──────────────────────────────────────────
// Set to "" rather than delete: Prisma Client re-loads .env on init (for
// DATABASE_URL), and dotenv re-adds any DELETED var — but never OVERRIDES an
// already-set one. "" is falsy (pickProvider/availableProviders treat it as
// no-key) yet counts as set, so Prisma's reload leaves it empty.
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENROUTER_API_KEY = "";
process.env.ZAI_API_KEY = "";
process.env.GENESIS_LLM_MODEL = "";

// ── 2. State isolation ──────────────────────────────────────────────────────
const TEST_ENV = path.resolve(process.cwd(), ".genesis-test-env");
const TEST_DB = path.join(TEST_ENV, "test.db");
const TEST_DB_URL = "file:" + TEST_DB.replace(/\\/g, "/"); // absolute → db.ts passes it through unchanged
fs.mkdirSync(TEST_ENV, { recursive: true });

// Redirect the database. dotenv won't override an already-set var, so this wins
// over .env's production `file:../db/custom.db`.
process.env.DATABASE_URL = TEST_DB_URL;
// Redirect every agent sandbox/repo away from the production .genesis-workspace.
process.env.GENESIS_WORKSPACE_ROOT = path.join(TEST_ENV, "workspace");
// Never run the deploy supervisor loop, and never spawn a real local deploy
// (startLocalDetached honours this flag) — no test may bind a real port or
// touch a running application.
process.env.GENESIS_DEPLOY_SUPERVISOR_MS = "0";
process.env.GENESIS_TEST_ISOLATION = "1";

// Fresh schema each run → deterministic, and structurally identical to prod
// without ever opening the prod file. `prisma db push` reads DATABASE_URL from
// the env we pass (dotenv can't override it), so it targets the test DB only.
try { fs.rmSync(TEST_DB, { force: true }); } catch { /* not present */ }
try { fs.rmSync(TEST_DB + "-journal", { force: true }); } catch { /* wal/journal */ }
execSync("bun x prisma db push --skip-generate --accept-data-loss", {
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  stdio: "ignore",
});
