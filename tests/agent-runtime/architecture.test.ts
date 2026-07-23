/** V11 Phase 2 — Architecture Engine tests.
 *  Deterministic + offline via the router's `_invoke` seam. Proves: reasoned
 *  per-component choices, goal-specific divergence (CLI vs multi-role data app),
 *  honest HEURISTIC fallback that READS the requirements, and persistence. */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { deriveArchitecture, heuristicArchitecture, runArchitecture, type ArchitectureDoc } from "@/lib/genesis/agent-runtime/architecture";
import type { RequirementsDoc } from "@/lib/genesis/agent-runtime/requirements";
import { db } from "@/lib/db";

// The seam is only reached when a provider chain exists — set a dummy key (the
// seam handles the call, so no real network request). Restore after.
const savedGemini = process.env.GEMINI_API_KEY;
beforeAll(() => { process.env.GEMINI_API_KEY = "test-only-seamed-no-real-call"; });
afterAll(() => { if (savedGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGemini; });

function req(partial: Partial<RequirementsDoc>): RequirementsDoc {
  return {
    goal: "x", purpose: "", targetUsers: [], coreFeatures: [], optionalFeatures: [], dataEntities: [],
    businessRules: [], userJourneys: [], nonFunctional: [], constraints: [], successCriteria: [], mode: "LLM", ...partial,
  };
}
function invoke(json: object) { return async () => ({ text: JSON.stringify(json), promptTokens: 10, completionTokens: 80 }); }

const HOSPITAL_ARCH = {
  summary: "Multi-role clinical web app.",
  frontend: { choice: "Next.js (React)", rationale: "Staff need dashboards." },
  backend: { choice: "Node API", rationale: "Serves clinical data." },
  database: { choice: "PostgreSQL", rationale: "Compliance + relational patient data." },
  authentication: { choice: "RBAC session auth", rationale: "Doctor/nurse/admin roles." },
  storage: { choice: "Object storage", rationale: "Scans/documents." },
  queue: { choice: "none", rationale: "No async workload yet." },
  caching: { choice: "Redis", rationale: "Fast record lookups." },
  externalApis: [{ choice: "Lab results API", rationale: "External labs." }],
  deployment: { choice: "Cloud", rationale: "24/7 availability." },
  projectStructure: [{ path: "src/app", purpose: "frontend" }, { path: "prisma", purpose: "schema" }],
  modules: [{ name: "Patient", responsibility: "records" }, { name: "Appointment", responsibility: "scheduling" }],
};

test("deriveArchitecture (LLM): full, reasoned per-component doc", async () => {
  const doc = await deriveArchitecture(req({ goal: "hospital system", targetUsers: ["Doctor", "Nurse"], dataEntities: [{ name: "Patient", fields: ["id"] }] }), { invoke: invoke(HOSPITAL_ARCH) });
  expect(doc.mode).toBe("LLM");
  expect(doc.database.choice).toBe("PostgreSQL");
  expect(doc.authentication.choice).toContain("RBAC");
  expect(doc.database.rationale.length).toBeGreaterThan(0); // every choice is justified
  expect(doc.modules.map((m) => m.name)).toContain("Patient");
});

test("architecture DIFFERS by requirements (not a fixed stack)", async () => {
  const cliArch = {
    summary: "CLI tool.", frontend: { choice: "none", rationale: "CLI." }, backend: { choice: "Node CLI", rationale: "Runs in terminal." },
    database: { choice: "none", rationale: "No persistence." }, authentication: { choice: "none", rationale: "Single user." },
    storage: { choice: "none", rationale: "" }, queue: { choice: "none", rationale: "" }, caching: { choice: "none", rationale: "" },
    externalApis: [], deployment: { choice: "npm package", rationale: "CLI distribution." },
    projectStructure: [{ path: "src", purpose: "cli" }], modules: [{ name: "core", responsibility: "logic" }],
  };
  const hospital = await deriveArchitecture(req({ goal: "hospital" }), { invoke: invoke(HOSPITAL_ARCH) });
  const cli = await deriveArchitecture(req({ goal: "word count cli" }), { invoke: invoke(cliArch) });
  expect(hospital.database.choice).not.toBe(cli.database.choice); // Postgres vs none
  expect(hospital.frontend.choice).not.toBe(cli.frontend.choice); // React vs none
  expect(cli.database.choice).toBe("none");
  expect(cli.frontend.choice).toBe("none");
});

test("heuristic READS the requirements: CLI → no db/frontend/auth", () => {
  const doc = heuristicArchitecture(req({ goal: "build a word count cli tool", coreFeatures: ["count words"], targetUsers: ["Developer"] }));
  expect(doc.mode).toBe("HEURISTIC");
  expect(doc.frontend.choice).toBe("none");
  expect(doc.database.choice).toBe("none");
  expect(doc.authentication.choice).toBe("none");
});

test("heuristic READS the requirements: multi-role data app → db + auth", () => {
  const doc = heuristicArchitecture(req({
    goal: "build a hospital management web system", targetUsers: ["Doctor", "Nurse", "Admin"],
    dataEntities: [{ name: "Patient", fields: ["id", "name"] }, { name: "Appointment", fields: ["id"] }],
    nonFunctional: ["HIPAA compliance"], coreFeatures: ["login", "manage patients"],
  }));
  expect(doc.database.choice).not.toBe("none");
  expect(doc.authentication.choice).not.toBe("none");
  expect(doc.database.choice).toBe("PostgreSQL"); // compliance/scale → server DB
  expect(doc.modules.map((m) => m.name)).toContain("Patient module");
});

test("malformed model output → honest HEURISTIC fallback", async () => {
  const doc = await deriveArchitecture(req({ goal: "build a CRM", dataEntities: [{ name: "Contact", fields: ["id"] }], targetUsers: ["Sales", "Admin"] }), { invoke: async () => ({ text: "garbage", promptTokens: 1, completionTokens: 1 }) });
  expect(doc.mode).toBe("HEURISTIC");
  expect(doc.goal).toBe("build a CRM");
});

test("runArchitecture persists an ArchitectureSpec linked to its spec", async () => {
  const { archId, doc } = await runArchitecture(req({ goal: "build an inventory system", dataEntities: [{ name: "Product", fields: ["id", "sku"] }] }), { invoke: invoke(HOSPITAL_ARCH), specId: "REQ-000001" });
  expect(archId).toMatch(/^ARCH-\d{6}$/);
  const row = await db.architectureSpec.findUnique({ where: { archId } });
  expect(row).not.toBeNull();
  expect(row!.specId).toBe("REQ-000001");
  expect(doc.mode).toBe("LLM");
});
