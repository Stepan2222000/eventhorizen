import { Pool } from "pg";
import { readAppConfigFromEnv } from "./config";

export type DbPools = {
  partsPool: Pool;
  inventoryPool: Pool;
};

export function createDbPoolsFromEnv(): DbPools {
  const config = readAppConfigFromEnv();

  const partsPool = new Pool({
    host: config.partsDb.host,
    port: config.partsDb.port,
    database: config.partsDb.database,
    user: config.partsDb.user,
    password: config.partsDb.password,
    ssl: config.partsDb.sslConfig,
    // Keep startup fail-fast, but avoid flaky remote connections.
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  const inventoryPool = new Pool({
    host: config.inventoryDb.host,
    port: config.inventoryDb.port,
    database: config.inventoryDb.database,
    user: config.inventoryDb.user,
    password: config.inventoryDb.password,
    ssl: config.inventoryDb.sslConfig,
    // Keep startup fail-fast, but avoid flaky remote connections.
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return { partsPool, inventoryPool };
}
