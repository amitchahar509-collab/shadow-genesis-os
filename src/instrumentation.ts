/** Next.js server startup hook — apply the operator's saved app config to the
 *  environment before any provider/connector check runs. Node runtime only. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { loadAppConfig } = await import("@/lib/genesis/app-config");
      const r = await loadAppConfig();
      if (r.loaded > 0) console.log(`[genesis] applied ${r.loaded} saved config key(s) from .genesis-config.json`);
    } catch (e) {
      console.error("[genesis] app-config load failed:", e instanceof Error ? e.message : e);
    }
  }
}
