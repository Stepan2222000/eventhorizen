import { eq, sql, and, ilike } from "drizzle-orm";
import { partsDb, inventoryDb } from "./db";
import { smart, reasons, movements, dbConnections } from "@shared/schema";
import type { 
  Smart, 
  Reason, 
  Movement, 
  InsertMovement, 
  StockLevel, 
  ArticleSearchResult,
  BulkImportRow,
  BulkImportResult,
  SafeDbConnection,
  InsertDbConnection,
  DbConnectionTest,
  DbTablesResult
} from "@shared/schema";
import { normalizeArticle } from "@shared/normalization";
import { neon } from "@neondatabase/serverless";

export interface IStorage {
  // SMART reference operations
  searchSmart(normalizedArticle: string): Promise<Smart[]>;
  getSmartByCode(smart: string): Promise<Smart | undefined>;
  
  // Movement operations
  createMovement(movement: InsertMovement): Promise<Movement>;
  getMovements(limit?: number, offset?: number): Promise<Movement[]>;
  getMovementsBySmartAndArticle(smart: string, article: string): Promise<Movement[]>;
  
  // Stock operations
  getStockLevels(limit?: number, offset?: number): Promise<StockLevel[]>;
  getStockBySmartAndArticle(smart: string, article: string): Promise<StockLevel | undefined>;
  getTotalStockBySmart(smart: string): Promise<number>;
  
  // Reasons
  getReasons(): Promise<Reason[]>;
  
  // Bulk import
  processBulkImport(rows: BulkImportRow[]): Promise<BulkImportResult>;
  
  // Database connections (password never returned)
  getDbConnections(): Promise<SafeDbConnection[]>;
  createDbConnection(connection: InsertDbConnection): Promise<SafeDbConnection>;
  deleteDbConnection(id: number): Promise<void>;
  testDbConnection(connection: InsertDbConnection): Promise<DbConnectionTest>;
  getDbTables(connectionId: number): Promise<DbTablesResult>;
}

export class DatabaseStorage implements IStorage {
  async searchSmart(normalizedArticle: string): Promise<Smart[]> {
    try {
      const result = await partsDb
        .select()
        .from(smart)
        .where(
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${smart.articles}) as article
            WHERE TRANSLATE(
              UPPER(REGEXP_REPLACE(article, '[\\s\\-_./]', '', 'g')),
              'АВЕКМНОРСТУХЁ',
              'ABEKMHOPCTYXE'
            ) = ${normalizedArticle}
          )`
        );
      
      return result;
    } catch (error) {
      console.error('Error searching SMART:', error);
      throw new Error('Failed to search SMART database');
    }
  }

  async getSmartByCode(smartCode: string): Promise<Smart | undefined> {
    try {
      const result = await partsDb
        .select()
        .from(smart)
        .where(eq(smart.smart, smartCode))
        .limit(1);
      
      return result[0];
    } catch (error) {
      console.error('Error getting SMART by code:', error);
      throw new Error('Failed to get SMART code');
    }
  }

  async createMovement(movement: InsertMovement): Promise<Movement> {
    try {
      // Verify SMART code exists
      const smartRecord = await this.getSmartByCode(movement.smart);
      if (!smartRecord) {
        throw new Error(`SMART code ${movement.smart} not found in reference database`);
      }

      const result = await inventoryDb
        .insert(movements)
        .values(movement)
        .returning();
      
      return result[0];
    } catch (error) {
      console.error('Error creating movement:', error);
      throw error;
    }
  }

  async getMovements(limit = 50, offset = 0): Promise<Movement[]> {
    try {
      const result = await inventoryDb
        .select()
        .from(movements)
        .orderBy(sql`created_at DESC`)
        .limit(limit)
        .offset(offset);
      
      return result;
    } catch (error) {
      console.error('Error getting movements:', error);
      throw new Error('Failed to get movements');
    }
  }

  async getMovementsBySmartAndArticle(smartCode: string, article: string): Promise<Movement[]> {
    try {
      const result = await inventoryDb
        .select()
        .from(movements)
        .where(and(
          eq(movements.smart, smartCode),
          eq(movements.article, article)
        ))
        .orderBy(sql`created_at DESC`);
      
      return result;
    } catch (error) {
      console.error('Error getting movements by SMART and article:', error);
      throw new Error('Failed to get movements');
    }
  }

  async getStockLevels(limit = 50, offset = 0): Promise<StockLevel[]> {
    try {
      const result = await inventoryDb.execute(sql`
        SELECT 
          s.smart,
          string_agg(DISTINCT s.article, ', ') as article,
          SUM(s.total_qty) as total_qty,
          sm.brand,
          sm.description,
          sm.name
        FROM inventory.stock s
        LEFT JOIN public.smart sm ON s.smart = sm.smart
        GROUP BY s.smart, sm.brand, sm.description, sm.name
        ORDER BY s.smart
        LIMIT ${limit} OFFSET ${offset}
      `);
      
      return result.rows.map(row => ({
        smart: row.smart as string,
        article: row.article as string,
        totalQty: row.total_qty as number,
        brand: row.brand as string | undefined,
        description: row.description as string | undefined,
        name: row.name as string | undefined,
      }));
    } catch (error) {
      console.error('Error getting stock levels:', error);
      throw new Error('Failed to get stock levels');
    }
  }

  async getStockBySmartAndArticle(smartCode: string, article: string): Promise<StockLevel | undefined> {
    try {
      const result = await inventoryDb.execute(sql`
        SELECT 
          s.smart,
          s.article,
          s.total_qty,
          sm.brand,
          sm.description,
          sm.name
        FROM inventory.stock s
        LEFT JOIN public.smart sm ON s.smart = sm.smart
        WHERE s.smart = ${smartCode} AND s.article = ${article}
        LIMIT 1
      `);
      
      if (result.rows.length === 0) return undefined;
      
      const row = result.rows[0];
      return {
        smart: row.smart as string,
        article: row.article as string,
        totalQty: row.total_qty as number,
        brand: row.brand as string | undefined,
        description: row.description as string | undefined,
        name: row.name as string | undefined,
      };
    } catch (error) {
      console.error('Error getting stock by SMART and article:', error);
      throw new Error('Failed to get stock');
    }
  }

  async getTotalStockBySmart(smartCode: string): Promise<number> {
    try {
      const result = await inventoryDb.execute(sql`
        SELECT SUM(total_qty) as total
        FROM inventory.stock
        WHERE smart = ${smartCode}
      `);
      
      return (result.rows[0]?.total as number) || 0;
    } catch (error) {
      console.error('Error getting total stock by SMART:', error);
      throw new Error('Failed to get total stock');
    }
  }

  async getReasons(): Promise<Reason[]> {
    try {
      const result = await inventoryDb
        .select()
        .from(reasons)
        .orderBy(reasons.code);
      
      return result;
    } catch (error) {
      console.error('Error getting reasons:', error);
      throw new Error('Failed to get reasons');
    }
  }

  async processBulkImport(rows: BulkImportRow[]): Promise<BulkImportResult> {
    const result: BulkImportResult = {
      totalRows: rows.length,
      imported: 0,
      errors: []
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        let smartCode = row.smart;
        
        // If no SMART provided, try to find it
        if (!smartCode) {
          const normalized = normalizeArticle(row.article);
          const matches = await this.searchSmart(normalized);
          
          if (matches.length === 0) {
            result.errors.push({
              row: i + 1,
              error: `No SMART code found for article: ${row.article}`,
              data: row
            });
            continue;
          } else if (matches.length > 1) {
            result.errors.push({
              row: i + 1,
              error: `Multiple SMART codes found for article: ${row.article}. Please specify SMART code.`,
              data: row
            });
            continue;
          }
          
          smartCode = matches[0].smart;
        }

        // Validate reason
        const validReasons = await this.getReasons();
        if (!validReasons.find(r => r.code === row.reason)) {
          result.errors.push({
            row: i + 1,
            error: `Invalid reason code: ${row.reason}`,
            data: row
          });
          continue;
        }

        // Create movement
        await this.createMovement({
          smart: smartCode!,
          article: row.article,
          qtyDelta: row.qtyDelta,
          reason: row.reason,
          note: row.note || null,
        });
        
        result.imported++;
      } catch (error) {
        result.errors.push({
          row: i + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: row
        });
      }
    }

    return result;
  }

  async getDbConnections(): Promise<SafeDbConnection[]> {
    try {
      const result = await inventoryDb
        .select()
        .from(dbConnections)
        .orderBy(sql`created_at DESC`);
      
      // Remove password from all results
      return result.map(({ password, ...safe }) => safe);
    } catch (error) {
      console.error('Error getting DB connections:', error);
      throw new Error('Failed to get database connections');
    }
  }

  async createDbConnection(connection: InsertDbConnection): Promise<SafeDbConnection> {
    try {
      const result = await inventoryDb
        .insert(dbConnections)
        .values({
          ...connection,
          updatedAt: new Date(),
        })
        .returning();
      
      // Remove password from response
      const { password, ...safe } = result[0];
      return safe;
    } catch (error) {
      console.error('Error creating DB connection:', error);
      throw error;
    }
  }

  async deleteDbConnection(id: number): Promise<void> {
    try {
      await inventoryDb
        .delete(dbConnections)
        .where(eq(dbConnections.id, id));
    } catch (error) {
      console.error('Error deleting DB connection:', error);
      throw new Error('Failed to delete database connection');
    }
  }

  async testDbConnection(connection: InsertDbConnection): Promise<DbConnectionTest> {
    try {
      // Build connection string
      const sslParam = connection.ssl ? `?sslmode=${connection.ssl}` : '';
      const connectionString = `postgresql://${connection.username}:${connection.password}@${connection.host}:${connection.port}/${connection.database}${sslParam}`;
      
      // Try to connect
      const testDb = neon(connectionString);
      const result = await testDb`SELECT version()`;
      
      return {
        success: true,
        message: 'Соединение успешно',
        version: result[0]?.version || 'Unknown',
      };
    } catch (error) {
      console.error('DB connection test error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Не удалось подключиться',
      };
    }
  }

  async getDbTables(connectionId: number): Promise<DbTablesResult> {
    try {
      // Get connection details
      const connections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, connectionId))
        .limit(1);
      
      if (!connections.length) {
        throw new Error('Connection not found');
      }
      
      const connection = connections[0];
      
      // Build connection string
      const sslParam = connection.ssl ? `?sslmode=${connection.ssl}` : '';
      const connectionString = `postgresql://${connection.username}:${connection.password}@${connection.host}:${connection.port}/${connection.database}${sslParam}`;
      
      // Connect and get tables
      const testDb = neon(connectionString);
      const result = await testDb`
        SELECT 
          table_schema as schema,
          table_name as name,
          table_type as type
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `;
      
      return {
        connectionName: connection.name,
        tables: result.map((row: any) => ({
          schema: row.schema,
          name: row.name,
          type: row.type,
        })),
      };
    } catch (error) {
      console.error('Error getting DB tables:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to get tables');
    }
  }
}

export const storage = new DatabaseStorage();
