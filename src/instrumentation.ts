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
    // Reflect which local deploys survived this restart (detached apps keep
    // serving) vs. which stopped — so the UI shows the real state, not stale
    // "HEALTHY" — then keep them alive continuously. Both fire-and-forget: they
    // must never delay the server becoming ready.
    void import("@/lib/genesis/agent-runtime/deployment/local-runtime")
      .then(async ({ reconcileLocalDeploys, startDeploySupervisor }) => {
        const rc = await reconcileLocalDeploys();
        if (rc.checked > 0) console.log(`[genesis] local deploys: ${rc.alive}/${rc.checked} serving after restart (${rc.revived} revived)`);
        const sup = startDeploySupervisor();
        if (sup.started) console.log(`[genesis] deploy supervisor active (every ${sup.intervalMs}ms)`);
      })
      .catch((e) => console.error("[genesis] local-deploy reconcile/supervisor failed:", e instanceof Error ? e.message : e));
  }
}
