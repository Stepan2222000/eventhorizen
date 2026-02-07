import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

function getPgSslConfig(mode: unknown) {
  if (!mode || typeof mode !== 'string') return undefined;
  const normalized = mode.trim().toLowerCase();
  if (!normalized || normalized === 'disable') return undefined;
  if (normalized === 'verify-ca' || normalized === 'verify-full') {
    return { rejectUnauthorized: true };
  }
  // prefer/require and any other truthy string: enable SSL, but allow self-signed by default
  return { rejectUnauthorized: false };
}

// DATABASE_URL is now optional - connections are stored in JSON file
// These DB instances are only used for backwards compatibility if needed
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
}) : null;

export const partsDb = pool ? drizzle(pool, { schema }) : null as any;
export const inventoryDb = pool ? drizzle(pool, { schema }) : null as any;

// Initialize or update schema on external database
export async function ensureExternalDbSchema(connectionDetails: any) {
  const externalPool = new Pool({
    host: connectionDetails.host,
    port: connectionDetails.port,
    database: connectionDetails.database,
    user: connectionDetails.username,
    password: connectionDetails.password,
    ssl: getPgSslConfig(connectionDetails.ssl),
  });

  try {
    // Create inventory schema
    await externalPool.query(`CREATE SCHEMA IF NOT EXISTS inventory`);
    
    // Create reasons table with fixed data
    await externalPool.query(`
      CREATE TABLE IF NOT EXISTS inventory.reasons (
        code VARCHAR PRIMARY KEY,
        title TEXT NOT NULL
      )
    `);
    
    // Insert fixed reasons
    await externalPool.query(`
      INSERT INTO inventory.reasons (code, title) VALUES
        ('purchase', 'Добавление нового товара'),
        ('sale', 'Продажа'),
        ('return', 'Возврат'),
        ('writeoff', 'Списание')
      ON CONFLICT (code) DO NOTHING
    `);
    
    // Create shipping_methods table
    await externalPool.query(`
      CREATE TABLE IF NOT EXISTS inventory.shipping_methods (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
	      )
	    `);
	    
	    // Insert default shipping methods only if table is empty
	    const result = await externalPool.query(`SELECT COUNT(*) FROM inventory.shipping_methods`);
    if (parseInt(result.rows[0].count) === 0) {
      await externalPool.query(`
        INSERT INTO inventory.shipping_methods (name) VALUES
          ('Почта России'),
          ('Яндекс'),
          ('СДЭК'),
          ('Авито доставка')
      `);
    }
    
	    // Create movements table
	    await externalPool.query(`
	      CREATE TABLE IF NOT EXISTS inventory.movements (
	        id SERIAL PRIMARY KEY,
	        smart VARCHAR NOT NULL,
	        article TEXT NOT NULL,
	        qty_delta INTEGER NOT NULL,
	        reason VARCHAR NOT NULL,
	        note TEXT,
	        created_at TIMESTAMP DEFAULT NOW() NOT NULL
	      )
	    `);

	    // Migrate legacy reason code "adjust" to "purchase" (table now exists).
	    await externalPool.query(`
	      UPDATE inventory.movements
	      SET reason = 'purchase'
	      WHERE reason = 'adjust'
	    `);

	    // Remove old 'adjust' reason if exists
	    await externalPool.query(`DELETE FROM inventory.reasons WHERE code = 'adjust'`);
	    
	    // Add new columns to movements table if they don't exist
	    const columns = [
	      { name: 'purchase_price', type: 'NUMERIC(10, 2)' },
	      { name: 'sale_price', type: 'NUMERIC(10, 2)' },
      { name: 'delivery_price', type: 'NUMERIC(10, 2)' },
      { name: 'box_number', type: 'VARCHAR(50)' },
      { name: 'track_number', type: 'TEXT' },
      { name: 'shipping_method_id', type: 'INTEGER' },
      { name: 'sale_status', type: 'VARCHAR(50)' }
    ];
    
    for (const column of columns) {
      await externalPool.query(`
        ALTER TABLE inventory.movements 
        ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}
      `);
    }
    
    // Create stock VIEW (grouped by SMART code only to aggregate across all articles)
    await externalPool.query(`
      CREATE OR REPLACE VIEW inventory.stock AS
      SELECT 
        smart,
        SUM(qty_delta) as total_qty
      FROM inventory.movements
      GROUP BY smart
      HAVING SUM(qty_delta) > 0
    `);
    
    console.log('External database schema updated successfully');
  } catch (error) {
    console.error('Failed to update external database schema:', error);
    throw error;
  } finally {
    await externalPool.end();
  }
}
