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

export async function initAppContext(): Promise<AppContext> {
  const pools = createDbPoolsFromEnv();
  const maxWaitMs = getDbConnectMaxWaitMs();

  try {
    await Promise.all([
      waitForDb(pools.partsPool, "PARTS", maxWaitMs),
      waitForDb(pools.inventoryPool, "INVENTORY", maxWaitMs),
    ]);

    await ensureInventorySchema(pools.inventoryPool);
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
