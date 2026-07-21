/** V11 Phase 1 — Requirements Engine tests.
 *  Deterministic + offline: the LLM is injected via the router's `_invoke` seam,
 *  so no real provider is called. Proves: full doc shape, goal-specific output,
 *  honest HEURISTIC fallback, and persistence. */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { deriveRequirements, heuristicRequirements, runRequirements, type RequirementsDoc } from "@/lib/genesis/agent-runtime/requirements";
import { db } from "@/lib/db";

// The injected `_invoke` seam is only reached when the router has at least one
// provider in the chain (an empty chain returns NO_PROVIDER before invoking).
// Set a DUMMY key so a provider exists — the seam handles the "call", so no real
// network request is ever made. Restore afterward to avoid cross-file leakage.
const savedGemini = process.env.GEMINI_API_KEY;
beforeAll(() => { process.env.GEMINI_API_KEY = "test-only-seamed-no-real-call"; });
afterAll(() => { if (savedGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGemini; });

// A fake model that returns a domain-specific doc keyed off the goal — mimics a
// real LLM reasoning differently per goal.
function fakeInvoke(json: object) {
  return async () => ({ text: JSON.stringify(json), promptTokens: 10, completionTokens: 50 });
}

const HOSPITAL = {
  purpose: "Manage hospital patients, doctors, and appointments.",
  targetUsers: ["Receptionist", "Doctor", "Patient"],
  coreFeatures: ["Register patients", "Book appointments", "Write prescriptions"],
  optionalFeatures: ["Billing"],
  dataEntities: [
    { name: "Patient", fields: ["id", "name", "dob", "mrn"], description: "A hospital patient" },
    { name: "Doctor", fields: ["id", "name", "specialty"] },
    { name: "Appointment", fields: ["id", "patientId", "doctorId", "time"] },
  ],
  businessRules: ["An appointment requires an available doctor"],
  userJourneys: [{ actor: "Receptionist", steps: ["Find patient", "Book appointment"] }],
  nonFunctional: ["HIPAA-style access control"],
  constraints: ["Web app"],
  successCriteria: ["Can book an appointment end to end"],
};

test("deriveRequirements (LLM): full, goal-specific document", async () => {
  const doc = await deriveRequirements("build a hospital management system", { invoke: fakeInvoke(HOSPITAL) });
  expect(doc.mode).toBe("LLM");
  // every dimension present
  for (const k of ["purpose", "targetUsers", "coreFeatures", "dataEntities", "businessRules", "userJourneys", "nonFunctional", "constraints", "successCriteria"] as (keyof RequirementsDoc)[]) {
    expect(doc[k]).toBeDefined();
  }
  // goal-specific domain content survived parsing
  expect(doc.dataEntities.map((e) => e.name)).toEqual(["Patient", "Doctor", "Appointment"]);
  expect(doc.coreFeatures).toContain("Book appointments");
});

test("deriveRequirements produces DIFFERENT docs for DIFFERENT goals (not a template)", async () => {
  const pos = {
    purpose: "Restaurant point of sale.",
    targetUsers: ["Waiter", "Cashier"],
    coreFeatures: ["Take orders", "Process payments"],
    optionalFeatures: [],
    dataEntities: [{ name: "Order", fields: ["id", "table", "items"] }, { name: "MenuItem", fields: ["id", "name", "price"] }, { name: "Payment", fields: ["id", "orderId", "amount"] }],
    businessRules: ["An order must have at least one item"],
    userJourneys: [{ actor: "Waiter", steps: ["Open table", "Add items", "Send to kitchen"] }],
    nonFunctional: ["Fast at the counter"],
    constraints: [],
    successCriteria: ["Can complete a sale"],
  };
  const a = await deriveRequirements("build a hospital management system", { invoke: fakeInvoke(HOSPITAL) });
  const b = await deriveRequirements("build a restaurant POS", { invoke: fakeInvoke(pos) });
  const aEntities = a.dataEntities.map((e) => e.name).sort();
  const bEntities = b.dataEntities.map((e) => e.name).sort();
  expect(aEntities).not.toEqual(bEntities); // different data models
  expect(a.coreFeatures).not.toEqual(b.coreFeatures); // different features
  expect(a.purpose).not.toEqual(b.purpose);
});

test("heuristic fallback is goal-derived and honestly labelled", () => {
  const doc = heuristicRequirements("build an expense tracker");
  expect(doc.mode).toBe("HEURISTIC");
  // derived from the goal's own keywords, not a fixed template
  const blob = JSON.stringify(doc).toLowerCase();
  expect(blob).toContain("expense");
  expect(doc.dataEntities.length).toBeGreaterThan(0);
});

test("malformed model output → honest HEURISTIC fallback (never fabricated)", async () => {
  const doc = await deriveRequirements("build a CRM", { invoke: async () => ({ text: "not json at all", promptTokens: 1, completionTokens: 1 }) });
  expect(doc.mode).toBe("HEURISTIC");
  expect(doc.goal).toBe("build a CRM");
});

test("runRequirements persists a RequirementSpec row", async () => {
  const { specId, doc } = await runRequirements("build an inventory management system", { invoke: fakeInvoke({ ...HOSPITAL, purpose: "Inventory", dataEntities: [{ name: "Product", fields: ["id", "sku", "qty"] }] }) });
  expect(specId).toMatch(/^REQ-\d{6}$/);
  const row = await db.requirementSpec.findUnique({ where: { specId } });
  expect(row).not.toBeNull();
  expect(row!.goal).toBe("build an inventory management system");
  expect(JSON.parse(row!.doc).dataEntities[0].name).toBe("Product");
  expect(doc.mode).toBe("LLM");
});
