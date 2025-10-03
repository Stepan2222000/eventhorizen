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
  DbTablesResult,
  ConfigureConnectionPayload,
  ConnectionRole
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
  configureConnection(payload: ConfigureConnectionPayload): Promise<SafeDbConnection>;
  getActiveConnection(role: ConnectionRole): Promise<SafeDbConnection | null>;
  getTableColumns(connectionId: number, tableName: string): Promise<Array<{name: string, type: string}>>;
  createDefaultConnections(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async searchSmart(normalizedArticle: string): Promise<Smart[]> {
    try {
      // Get active SMART connection
      const activeConn = await this.getActiveConnection('smart');
      
      if (!activeConn) {
        console.log('No active SMART connection found');
        return [];
      }
      
      // Get full connection details (including password)
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return [];
      }
      
      const conn = fullConnections[0];
      const fieldMapping = (conn.fieldMapping as any) || {};
      
      // Build connection string
      const sslParam = conn.ssl ? `?sslmode=${conn.ssl}` : '';
      const connectionString = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}${sslParam}`;
      
      // Connect to external DB
      const externalDb = neon(connectionString);
      
      // Get field names from mapping or use defaults
      const smartField = fieldMapping.smart || 'smart';
      const articlesField = fieldMapping.articles || 'articles';
      const nameField = fieldMapping.name || 'name';
      const brandField = fieldMapping.brand || 'brand';
      const descField = fieldMapping.description || 'description';
      
      // Parse table name (schema.table or just table)
      const tableName = conn.tableName || 'public.smart';
      
      // Build and execute search query with normalization
      // Note: Using template literals for identifiers (validated from DB schema)
      const query = `
        SELECT 
          "${smartField}" as smart,
          "${articlesField}" as articles,
          "${nameField}" as name,
          "${brandField}" as brand,
          "${descField}" as description
        FROM ${tableName}
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements_text("${articlesField}") as article
          WHERE TRANSLATE(
            UPPER(REGEXP_REPLACE(article, '[\\s\\-_./]', '', 'g')),
            'АВЕКМНОРСТУХЁ',
            'ABEKMHOPCTYXE'
          ) = $1
        )
      `;
      
      const result = await externalDb(query, [normalizedArticle]);
      
      return result.map((row: any) => ({
        smart: row.smart,
        articles: row.articles,
        name: row.name,
        brand: row.brand,
        description: row.description,
      }));
    } catch (error) {
      console.error('Error searching SMART:', error);
      throw new Error('Failed to search SMART database');
    }
  }

  async getSmartByCode(smartCode: string): Promise<Smart | undefined> {
    try {
      // Get active SMART connection
      const activeConn = await this.getActiveConnection('smart');
      
      if (!activeConn) {
        console.log('No active SMART connection found');
        return undefined;
      }
      
      // Get full connection details (including password)
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return undefined;
      }
      
      const conn = fullConnections[0];
      const fieldMapping = (conn.fieldMapping as any) || {};
      
      // Build connection string
      const sslParam = conn.ssl ? `?sslmode=${conn.ssl}` : '';
      const connectionString = `postgresql://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${conn.database}${sslParam}`;
      
      // Connect to external DB
      const externalDb = neon(connectionString);
      
      // Get field names from mapping or use defaults
      const smartField = fieldMapping.smart || 'smart';
      const articlesField = fieldMapping.articles || 'articles';
      const nameField = fieldMapping.name || 'name';
      const brandField = fieldMapping.brand || 'brand';
      const descField = fieldMapping.description || 'description';
      
      // Parse table name (schema.table or just table)
      const tableName = conn.tableName || 'public.smart';
      
      // Build and execute query
      const query = `
        SELECT 
          "${smartField}" as smart,
          "${articlesField}" as articles,
          "${nameField}" as name,
          "${brandField}" as brand,
          "${descField}" as description
        FROM ${tableName}
        WHERE "${smartField}" = $1
        LIMIT 1
      `;
      
      const result = await externalDb(query, [smartCode]);
      
      if (result.length === 0) return undefined;
      
      return {
        smart: result[0].smart,
        articles: result[0].articles,
        name: result[0].name,
        brand: result[0].brand,
        description: result[0].description,
      };
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
      // Get stock aggregates from inventory
      const result = await inventoryDb.execute(sql`
        SELECT 
          s.smart,
          string_agg(DISTINCT s.article, ', ') as article,
          SUM(s.total_qty) as total_qty
        FROM inventory.stock s
        GROUP BY s.smart
        ORDER BY s.smart
        LIMIT ${limit} OFFSET ${offset}
      `);
      
      // Enrich with SMART reference data from active connection
      const enriched = await Promise.all(
        result.rows.map(async (row) => {
          const smartData = await this.getSmartByCode(row.smart as string);
          return {
            smart: row.smart as string,
            article: row.article as string,
            totalQty: row.total_qty as number,
            brand: smartData?.brand || undefined,
            description: smartData?.description || undefined,
            name: smartData?.name || undefined,
          };
        })
      );
      
      return enriched;
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
          s.total_qty
        FROM inventory.stock s
        WHERE s.smart = ${smartCode} AND s.article = ${article}
        LIMIT 1
      `);
      
      if (result.rows.length === 0) return undefined;
      
      const row = result.rows[0];
      
      // Enrich with SMART reference data from active connection
      const smartData = await this.getSmartByCode(smartCode);
      
      return {
        smart: row.smart as string,
        article: row.article as string,
        totalQty: row.total_qty as number,
        brand: smartData?.brand || undefined,
        description: smartData?.description || undefined,
        name: smartData?.name || undefined,
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

  async configureConnection(payload: ConfigureConnectionPayload): Promise<SafeDbConnection> {
    try {
      const { connectionId, role, tableName, fieldMapping } = payload;
      
      // Deactivate other connections with the same role
      if (role) {
        await inventoryDb
          .update(dbConnections)
          .set({ isActive: false })
          .where(and(
            eq(dbConnections.role, role),
            sql`${dbConnections.id} != ${connectionId}`
          ));
      }
      
      // Update connection configuration
      const result = await inventoryDb
        .update(dbConnections)
        .set({
          role,
          tableName,
          fieldMapping: fieldMapping as any,
          isActive: role ? true : false,
          updatedAt: new Date(),
        })
        .where(eq(dbConnections.id, connectionId))
        .returning();
      
      if (!result.length) {
        throw new Error('Connection not found');
      }
      
      const { password, ...safe } = result[0];
      return safe;
    } catch (error) {
      console.error('Error configuring connection:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to configure connection');
    }
  }

  async getActiveConnection(role: ConnectionRole): Promise<SafeDbConnection | null> {
    try {
      if (!role) return null;
      
      const result = await inventoryDb
        .select()
        .from(dbConnections)
        .where(and(
          eq(dbConnections.role, role),
          eq(dbConnections.isActive, true)
        ))
        .limit(1);
      
      if (!result.length) return null;
      
      const { password, ...safe } = result[0];
      return safe;
    } catch (error) {
      console.error('Error getting active connection:', error);
      throw new Error('Failed to get active connection');
    }
  }

  async getTableColumns(connectionId: number, tableName: string): Promise<Array<{name: string, type: string}>> {
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
      
      // Connect and get columns
      const testDb = neon(connectionString);
      
      // Parse schema and table name
      const [schema, table] = tableName.includes('.') 
        ? tableName.split('.') 
        : ['public', tableName];
      
      const result = await testDb`
        SELECT 
          column_name as name,
          data_type as type
        FROM information_schema.columns 
        WHERE table_schema = ${schema} AND table_name = ${table}
        ORDER BY ordinal_position
      `;
      
      return result.map((row: any) => ({
        name: row.name,
        type: row.type,
      }));
    } catch (error) {
      console.error('Error getting table columns:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to get columns');
    }
  }

  async createDefaultConnections(): Promise<void> {
    try {
      // Check if default connections already exist
      const existing = await inventoryDb
        .select()
        .from(dbConnections)
        .where(sql`${dbConnections.name} LIKE 'По умолчанию%'`);
      
      if (existing.length > 0) {
        console.log('Default connections already exist, skipping...');
        return;
      }

      // Get DATABASE_URL from environment
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        console.log('DATABASE_URL not found, skipping default connections');
        return;
      }

      // Parse DATABASE_URL (format: postgresql://user:password@host:port/database)
      const url = new URL(dbUrl);
      const host = url.hostname;
      const port = parseInt(url.port) || 5432;
      const database = url.pathname.slice(1);
      const username = url.username;
      const password = url.password;

      // NO longer creating default SMART connection - user must configure external DB
      // Create Inventory connection only
      await inventoryDb.insert(dbConnections).values({
        name: 'По умолчанию (Учёт)',
        host,
        port,
        database,
        username,
        password,
        role: 'inventory',
        tableName: 'inventory.movements',
        fieldMapping: {
          id: 'id',
          smart: 'smart',
          article: 'article',
          qtyDelta: 'qty_delta',
          reason: 'reason',
          note: 'note',
          createdAt: 'created_at',
        } as any,
        isActive: true,
        updatedAt: new Date(),
      });

      console.log('Default connections created successfully');
    } catch (error) {
      console.error('Error creating default connections:', error);
      // Don't throw, just log - this is optional
    }
  }
}

export const storage = new DatabaseStorage();
