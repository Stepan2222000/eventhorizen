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
