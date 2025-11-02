import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// For demo purposes, use the same database for both parts and inventory
// In production, these would be separate databases
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const partsDb = drizzle(pool, { schema });
export const inventoryDb = drizzle(pool, { schema });

// Initialize inventory database schema
export async function initializeInventoryDb() {
  try {
    // SMART reference table will be accessed from configured database connection
    // No longer creating or inserting mock data - all data must come from connected DB
    
    // Create inventory schema
    await pool.query(`CREATE SCHEMA IF NOT EXISTS inventory`);
    
    // Create reasons table with fixed data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory.reasons (
        code VARCHAR PRIMARY KEY,
        title TEXT NOT NULL
      )
    `);
    
    // Insert fixed reasons
    await pool.query(`
      INSERT INTO inventory.reasons (code, title) VALUES
        ('purchase', 'Добавление нового товара'),
        ('sale', 'Продажа'),
        ('return', 'Возврат'),
        ('writeoff', 'Списание')
      ON CONFLICT (code) DO NOTHING
    `);
    
    // Remove old 'adjust' reason if exists
    await pool.query(`DELETE FROM inventory.reasons WHERE code = 'adjust'`);
    
    // Create shipping_methods table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory.shipping_methods (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Insert default shipping methods
    await pool.query(`
      INSERT INTO inventory.shipping_methods (name) VALUES
        ('Почта России'),
        ('Яндекс'),
        ('СДЭК'),
        ('Авито доставка')
      ON CONFLICT DO NOTHING
    `);
    
    // Create movements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory.movements (
        id SERIAL PRIMARY KEY,
        smart VARCHAR NOT NULL,
        article TEXT NOT NULL,
        qty_delta INTEGER NOT NULL,
        reason VARCHAR NOT NULL,
        note TEXT,
        purchase_price NUMERIC(10, 2),
        sale_price NUMERIC(10, 2),
        delivery_price NUMERIC(10, 2),
        box_number VARCHAR(50),
        track_number TEXT,
        shipping_method_id INTEGER,
        sale_status VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        FOREIGN KEY (reason) REFERENCES inventory.reasons(code),
        FOREIGN KEY (shipping_method_id) REFERENCES inventory.shipping_methods(id)
      )
    `);
    
    // Create stock VIEW (grouped by SMART code only to aggregate across all articles)
    await pool.query(`
      CREATE OR REPLACE VIEW inventory.stock AS
      SELECT 
        smart,
        SUM(qty_delta) as total_qty
      FROM inventory.movements
      GROUP BY smart
      HAVING SUM(qty_delta) > 0
    `);
    
    console.log('Inventory database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize inventory database:', error);
    throw error;
  }
}

// Initialize or update schema on external database
export async function ensureExternalDbSchema(connectionDetails: any) {
  const externalPool = new Pool({
    host: connectionDetails.host,
    port: connectionDetails.port,
    database: connectionDetails.database,
    user: connectionDetails.username,
    password: connectionDetails.password,
    ssl: connectionDetails.ssl ? { rejectUnauthorized: false } : undefined,
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
    
    // Update any movements using old 'adjust' reason to 'purchase'
    await externalPool.query(`
      UPDATE inventory.movements 
      SET reason = 'purchase' 
      WHERE reason = 'adjust'
    `);
    
    // Remove old 'adjust' reason if exists
    await externalPool.query(`DELETE FROM inventory.reasons WHERE code = 'adjust'`);
    
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
