/** Test preload — force deterministic, key-free runs.
 *
 * The dev .env may contain real ANTHROPIC_API_KEY / OPENROUTER_API_KEY values so
 * the app runs on real reasoning locally. Tests must NOT: they assert the
 * heuristic/procedural behaviour, must be deterministic + offline, and must
 * never spend tokens. Clear all LLM provider keys before any test loads.
 * (Router/provider tests that exercise the multi-provider logic set their own
 * keys explicitly and restore afterward — this only removes ambient ones.)
 */
// Set to "" rather than delete: Prisma Client re-loads .env on init (for
// DATABASE_URL), and dotenv re-adds any DELETED var — but never OVERRIDES an
// already-set one. "" is falsy (pickProvider/availableProviders treat it as
// no-key) yet counts as set, so Prisma's reload leaves it empty.
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENROUTER_API_KEY = "";
process.env.ZAI_API_KEY = "";
process.env.GENESIS_LLM_MODEL = "";
