import type { Pool, PoolClient } from "pg";
import { createDbPoolsFromEnv, type DbPools } from "./db";
import { ensureInventorySchema } from "./inventory-schema";
import { loadSmartCache, type SmartCache } from "./smart-cache";
import { DatabaseStorage } from "./storage";

export type AppContext = {
  pools: DbPools;
  smartCache: SmartCache;
  storage: DatabaseStorage;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDbConnectMaxWaitMs(): number {
  // In development DB containers can take a bit to come up; avoid immediate exit.
  const raw = process.env.DB_CONNECT_MAX_WAIT_MS;
  if (raw && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return process.env.NODE_ENV === "development" ? 60_000 : 10_000;
}

function parseBooleanEnv(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function isInventoryRequiredOnStartup(): boolean {
  const parsed = parseBooleanEnv(process.env.INVENTORY_DB_REQUIRED_ON_STARTUP);
  if (parsed !== undefined) return parsed;
  return process.env.NODE_ENV === "production";
}

function getInventoryBootstrapRetryMs(): number {
  const raw = process.env.INVENTORY_DB_BOOTSTRAP_RETRY_MS;
  if (raw && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1_000) return Math.trunc(n);
  }
  return 5_000;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function waitForDb(pool: Pool, label: string, maxWaitMs: number) {
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("SELECT 1");
      return;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);

      if (elapsedMs >= maxWaitMs) {
        throw new Error(`${label} DB is not reachable after ${elapsedMs}ms: ${message}`);
      }

      attempt += 1;
      const baseDelayMs = 250;
      const maxDelayMs = 5_000;
      const expDelayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const jitterMs = Math.floor(Math.random() * 200);
      const waitMs = Math.min(expDelayMs + jitterMs, Math.max(0, maxWaitMs - elapsedMs));

      console.warn(`${label} DB is not reachable yet (${message}). Retrying in ${waitMs}ms...`);
      await sleep(waitMs);
    } finally {
      client?.release();
    }
  }
}

function startInventoryBootstrapLoop(pools: DbPools, maxWaitMs: number) {
  const retryMs = getInventoryBootstrapRetryMs();

  void (async () => {
    while (true) {
      try {
        await waitForDb(pools.inventoryPool, "INVENTORY", maxWaitMs);
        await ensureInventorySchema(pools.inventoryPool);
        console.warn("INVENTORY DB became reachable. Schema is ensured.");
        return;
      } catch (err) {
        console.warn(
          `INVENTORY bootstrap retry failed (${errorMessage(err)}). Retrying in ${retryMs}ms...`
        );
        await sleep(retryMs);
      }
    }
  })();
}

export async function initAppContext(): Promise<AppContext> {
  const pools = createDbPoolsFromEnv();
  const maxWaitMs = getDbConnectMaxWaitMs();
  const inventoryRequired = isInventoryRequiredOnStartup();

  try {
    await waitForDb(pools.partsPool, "PARTS", maxWaitMs);

    try {
      await waitForDb(pools.inventoryPool, "INVENTORY", maxWaitMs);
      await ensureInventorySchema(pools.inventoryPool);
    } catch (err) {
      if (inventoryRequired) throw err;

      console.warn(
        `INVENTORY DB is unavailable on startup (${errorMessage(err)}). Starting in degraded mode; inventory-backed API routes may fail until DB is back.`
      );
      startInventoryBootstrapLoop(pools, maxWaitMs);
    }

    const smartCache = await loadSmartCache(pools.partsPool);
    const storage = new DatabaseStorage(pools.inventoryPool, smartCache);

    return { pools, smartCache, storage };
  } catch (err) {
    try {
      await pools.partsPool.end();
    } catch {
      // ignore
    }
    try {
      await pools.inventoryPool.end();
    } catch {
      // ignore
    }
    throw err;
  }
}
