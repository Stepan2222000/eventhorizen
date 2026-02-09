import type { Pool } from "pg";

const DEFAULT_SHIPPING_METHODS = ["Почта России", "Яндекс", "СДЭК", "Авито доставка"] as const;

export async function ensureInventorySchema(inventoryPool: Pool): Promise<void> {
  const client = await inventoryPool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`CREATE SCHEMA IF NOT EXISTS inventory`);

    // Reasons are now a constant in shared/schema.ts (REASONS), no DB table needed.
    await client.query(`DROP TABLE IF EXISTS inventory.reasons`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory.shipping_methods (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    const shippingCountRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM inventory.shipping_methods`
    );
    if (Number(shippingCountRes.rows[0]?.count || 0) === 0) {
      await client.query(
        `INSERT INTO inventory.shipping_methods (name) SELECT unnest($1::text[])`,
        [DEFAULT_SHIPPING_METHODS]
      );
    }

    // Base table (older installations may already have it with different columns).
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory.movements (
        id SERIAL PRIMARY KEY,
        smart VARCHAR NOT NULL,
        qty_delta INTEGER NOT NULL,
        reason VARCHAR NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Hard requirement from specification: no `article` column in movements.
    await client.query(`ALTER TABLE inventory.movements DROP COLUMN IF EXISTS article`);

    // Ensure extended columns exist (idempotent).
    const columns: Array<{ name: string; type: string }> = [
      { name: "purchase_price", type: "NUMERIC(10, 2)" },
      { name: "sale_price", type: "NUMERIC(10, 2)" },
      { name: "delivery_price", type: "NUMERIC(10, 2)" },
      { name: "box_number", type: "VARCHAR(50)" },
      { name: "track_number", type: "TEXT" },
      { name: "shipping_method_id", type: "INTEGER" },
      { name: "sale_status", type: "VARCHAR(50)" },
    ];

    for (const col of columns) {
      await client.query(`
        ALTER TABLE inventory.movements
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
      `);
    }

    // VIEW that hides zero stock by design.
    await client.query(`
      CREATE OR REPLACE VIEW inventory.stock AS
      SELECT
        smart,
        SUM(qty_delta) as total_qty
      FROM inventory.movements
      GROUP BY smart
      HAVING SUM(qty_delta) > 0
    `);

    // Helpful indexes for common filters.
    await client.query(`CREATE INDEX IF NOT EXISTS movements_smart_idx ON inventory.movements (smart)`);
    await client.query(`CREATE INDEX IF NOT EXISTS movements_reason_idx ON inventory.movements (reason)`);
    await client.query(`CREATE INDEX IF NOT EXISTS movements_created_at_idx ON inventory.movements (created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS movements_sale_status_idx ON inventory.movements (sale_status)`);

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}
