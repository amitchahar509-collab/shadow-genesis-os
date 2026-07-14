/** V10.1 app layer — operator config + setup readiness. Keys are allowlisted,
 *  masked (never leaked raw), take effect in-process, and persist. Setup readiness
 *  reflects REAL state. Network-free. */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { isConfigurableKey, getConfigStatus, setConfigKeys, loadAppConfig, CONFIG_GROUPS } from "@/lib/genesis/app-config";
import { setupReadiness } from "@/lib/genesis/setup-check";

const CONFIG_PATH = path.resolve(process.cwd(), ".genesis-config.json");
let original: string | null = null;
const TESTKEY = "OPENROUTER_API_KEY"; // an allowlisted secret key used for the round-trip
const savedEnv = process.env[TESTKEY];

beforeAll(async () => { try { original = await fs.readFile(CONFIG_PATH, "utf8"); } catch { original = null; } });
afterAll(async () => {
  if (original === null) await fs.rm(CONFIG_PATH, { force: true }).catch(() => {});
  else await fs.writeFile(CONFIG_PATH, original, "utf8").catch(() => {});
  if (savedEnv === undefined) delete process.env[TESTKEY]; else process.env[TESTKEY] = savedEnv;
});

test("allowlist: only known config keys are writable (no arbitrary env injection)", () => {
  expect(isConfigurableKey("OPENROUTER_API_KEY")).toBe(true);
  expect(isConfigurableKey("GEMINI_API_KEY")).toBe(true);
  expect(isConfigurableKey("PATH")).toBe(false);
  expect(isConfigurableKey("NODE_OPTIONS")).toBe(false);
  expect(isConfigurableKey("__proto__")).toBe(false);
});

test("setConfigKeys applies to process.env immediately AND persists; unknown keys rejected", async () => {
  const r = await setConfigKeys({ [TESTKEY]: "sk-or-v1-APPTESTsecret1234567890abcdef", PATH: "/evil" });
  expect(r.applied).toContain(TESTKEY);
  expect(r.rejected).toContain("PATH");           // arbitrary env rejected
  expect(process.env[TESTKEY]).toBe("sk-or-v1-APPTESTsecret1234567890abcdef"); // in effect now
  const onDisk = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  expect(onDisk[TESTKEY]).toBeDefined();          // persisted
  expect(onDisk.PATH).toBeUndefined();            // never persisted
});

test("getConfigStatus MASKS secrets and never returns the raw value", async () => {
  await setConfigKeys({ [TESTKEY]: "sk-or-v1-SUPERSECRETvalue000111222333" });
  const groups = await getConfigStatus();
  const row = groups.flatMap((g) => g.keys).find((k) => k.key === TESTKEY)!;
  expect(row.configured).toBe(true);
  expect(row.masked).not.toBeNull();
  expect(row.masked).not.toBe("sk-or-v1-SUPERSECRETvalue000111222333"); // never raw
  expect(row.masked).toContain("••••");
  // the full secret must not appear anywhere in the serialized status
  expect(JSON.stringify(groups)).not.toContain("SUPERSECRETvalue");
});

test("empty value clears a key from env and disk", async () => {
  await setConfigKeys({ [TESTKEY]: "sk-or-v1-temp000111222333444555" });
  expect(process.env[TESTKEY]).toBeDefined();
  await setConfigKeys({ [TESTKEY]: "" });
  expect(process.env[TESTKEY]).toBeUndefined();
  const onDisk = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  expect(onDisk[TESTKEY]).toBeUndefined();
});

test("loadAppConfig applies saved keys but never overrides an already-set env var", async () => {
  await setConfigKeys({ [TESTKEY]: "sk-or-v1-fromfile00011122233344455" });
  delete process.env[TESTKEY];
  const r = await loadAppConfig();
  expect(r.loaded).toBeGreaterThanOrEqual(1);
  expect(process.env[TESTKEY]).toBe("sk-or-v1-fromfile00011122233344455");
  // env-wins: a pre-set env value is not clobbered
  process.env[TESTKEY] = "sk-or-v1-envwins0001112223334445";
  await loadAppConfig();
  expect(process.env[TESTKEY]).toBe("sk-or-v1-envwins0001112223334445");
  await setConfigKeys({ [TESTKEY]: "" });
});

test("config groups cover the documented provider/connector surface", () => {
  const keys = CONFIG_GROUPS.flatMap((g) => g.keys.map((k) => k.key));
  for (const expected of ["OPENROUTER_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN", "STRIPE_API_KEY", "VERCEL_TOKEN", "GENESIS_AUTH_REQUIRED"]) {
    expect(keys).toContain(expected);
  }
});

test("setup readiness reflects REAL state (database reachable in tests → ready)", async () => {
  const rd = await setupReadiness();
  expect(rd.runtime.status).toBe("ok");
  expect(rd.database.status).toBe("ok");     // tests run against a real db
  expect(rd.ready).toBe(true);               // db is the only hard requirement
  expect(["ok", "warn"]).toContain(rd.llm.status);   // llm optional
  expect(["ok", "warn"]).toContain(rd.docker.status); // docker optional, never blocks
  expect(rd.config.length).toBeGreaterThan(0);
  // readiness must not leak raw secrets either
  expect(JSON.stringify(rd)).not.toContain("SUPERSECRETvalue");
});
