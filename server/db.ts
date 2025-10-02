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
    // Create SMART reference table (public schema)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.smart (
        smart VARCHAR PRIMARY KEY,
        articles JSONB NOT NULL,
        name TEXT,
        brand TEXT,
        description TEXT
      )
    `);
    
    // Insert mock SMART data for testing
    await pool.query(`
      INSERT INTO public.smart (smart, articles, name, brand, description) VALUES
        ('SMART-00001', '["ABC-123", "АБЦ-123", "abc.123"]', 'Brake Pad Set', 'AutoParts', 'Front brake pads for sedan'),
        ('SMART-00002', '["DEF-456", "ДЕФ-456", "def/456"]', 'Oil Filter', 'FilterCo', 'Engine oil filter'),
        ('SMART-00003', '["GHI-789", "ГХИ-789"]', 'Air Filter', 'FilterCo', 'Cabin air filter'),
        ('SMART-00004', '["JKL-012", "ЙКЛ-012", "jkl 012"]', 'Spark Plug', 'IgnitionPro', 'Iridium spark plug'),
        ('SMART-00005', '["MNO-345"]', 'Wiper Blade', 'ClearView', 'Front wiper blade 24 inch')
      ON CONFLICT (smart) DO NOTHING
    `);
    
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
        ('purchase', 'Purchase'),
        ('sale', 'Sale'),
        ('return', 'Return'),
        ('adjust', 'Adjustment'),
        ('writeoff', 'Write-off')
      ON CONFLICT (code) DO NOTHING
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
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        FOREIGN KEY (reason) REFERENCES inventory.reasons(code)
      )
    `);
    
    // Create stock VIEW
    await pool.query(`
      CREATE OR REPLACE VIEW inventory.stock AS
      SELECT 
        smart,
        article,
        SUM(qty_delta) as total_qty
      FROM inventory.movements
      GROUP BY smart, article
    `);
    
    console.log('Inventory database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize inventory database:', error);
    throw error;
  }
}
