import { z } from "zod";

export type PgSslConfig = { rejectUnauthorized: boolean } | undefined;

function getPgSslConfig(mode: unknown): PgSslConfig {
  if (!mode || typeof mode !== "string") return undefined;
  const normalized = mode.trim().toLowerCase();
  if (!normalized || normalized === "disable") return undefined;
  if (normalized === "verify-ca" || normalized === "verify-full") {
    return { rejectUnauthorized: true };
  }
  // prefer/require and any other truthy string: enable SSL, but allow self-signed by default
  return { rejectUnauthorized: false };
}

const dbEnvSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  ssl: z.string().optional().nullable(),
});

export type DbConfig = z.infer<typeof dbEnvSchema> & { sslConfig: PgSslConfig };

function readDbConfig(prefix: "PARTS_DB" | "INVENTORY_DB"): DbConfig {
  const raw = {
    host: process.env[`${prefix}_HOST`],
    port: process.env[`${prefix}_PORT`],
    database: process.env[`${prefix}_NAME`],
    user: process.env[`${prefix}_USER`],
    password: process.env[`${prefix}_PASSWORD`],
    ssl: process.env[`${prefix}_SSL`],
  };

  const parsed = dbEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const envNameByKey: Record<string, string> = {
      host: `${prefix}_HOST`,
      port: `${prefix}_PORT`,
      database: `${prefix}_NAME`,
      user: `${prefix}_USER`,
      password: `${prefix}_PASSWORD`,
      ssl: `${prefix}_SSL`,
    };

    const missing = Object.entries(raw)
      .filter(([k, v]) => (k === "ssl" ? false : !v))
      .map(([k]) => envNameByKey[k] || `${prefix}_${k.toUpperCase()}`);
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(
      `Missing/invalid DB env for ${prefix}. Missing: ${missing.join(", ") || "unknown"}. Details: ${details}. Tip: create a .env file based on .env.example or export env vars before starting the server.`
    );
  }

  return {
    ...parsed.data,
    ssl: parsed.data.ssl ?? null,
    sslConfig: getPgSslConfig(parsed.data.ssl),
  };
}

export type AppConfig = {
  partsDb: DbConfig;
  inventoryDb: DbConfig;
};

export function readAppConfigFromEnv(): AppConfig {
  return {
    partsDb: readDbConfig("PARTS_DB"),
    inventoryDb: readDbConfig("INVENTORY_DB"),
  };
}
