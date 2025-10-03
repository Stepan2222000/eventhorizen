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
import { Pool } from "pg";

export class InsufficientStockError extends Error {
  constructor(
    public article: string,
    public smart: string,
    public currentStock: number,
    public requestedQty: number
  ) {
    super(`Недостаточно товара на складе. Артикул: ${article}, SMART: ${smart}. Текущий остаток: ${currentStock}, запрошено: ${requestedQty}`);
    this.name = 'InsufficientStockError';
  }
}

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
  // Helper method to create external DB pool
  private createExternalPool(conn: any): Pool {
    return new Pool({
      host: conn.host,
      port: conn.port,
      database: conn.database,
      user: conn.username,
      password: conn.password,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  async searchSmart(normalizedArticle: string): Promise<Smart[]> {
    let pool: Pool | null = null;
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
      
      // Connect to external DB
      pool = this.createExternalPool(conn);
      
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
      // Using LIKE for partial matching (user can search "5VX" to find "5VX-25806-00-00")
      const query = `
        SELECT 
          "${smartField}" as smart,
          "${articlesField}" as articles,
          "${nameField}" as name,
          "${brandField}" as brand,
          "${descField}" as description
        FROM ${tableName}
        WHERE EXISTS (
          SELECT 1 FROM unnest("${articlesField}") as article
          WHERE TRANSLATE(
            UPPER(REGEXP_REPLACE(article, '[\\s\\-_./]', '', 'g')),
            'АВЕКМНОРСТУХЁ',
            'ABEKMHOPCTYXE'
          ) LIKE '%' || $1 || '%'
        )
      `;
      
      const result = await pool.query(query, [normalizedArticle]);
      
      return result.rows.map((row: any) => ({
        smart: row.smart,
        articles: row.articles,
        name: row.name,
        brand: row.brand,
        description: row.description,
      }));
    } catch (error) {
      console.error('Error searching SMART:', error);
      throw new Error('Failed to search SMART database');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getSmartByCode(smartCode: string): Promise<Smart | undefined> {
    let pool: Pool | null = null;
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
      
      // Connect to external DB
      pool = this.createExternalPool(conn);
      
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
      
      const result = await pool.query(query, [smartCode]);
      
      if (result.rows.length === 0) return undefined;
      
      return {
        smart: result.rows[0].smart,
        articles: result.rows[0].articles,
        name: result.rows[0].name,
        brand: result.rows[0].brand,
        description: result.rows[0].description,
      };
    } catch (error) {
      console.error('Error getting SMART by code:', error);
      throw new Error('Failed to get SMART code');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async createMovement(movement: InsertMovement): Promise<Movement> {
    let pool: Pool | null = null;
    try {
      // Verify SMART code exists
      const smartRecord = await this.getSmartByCode(movement.smart);
      if (!smartRecord) {
        throw new Error(`SMART code ${movement.smart} not found in reference database`);
      }

      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        throw new Error('No active inventory connection configured');
      }
      
      // Get full connection details (including password)
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        throw new Error('Inventory connection not found');
      }
      
      const conn = fullConnections[0];
      
      // Connect to external DB
      pool = this.createExternalPool(conn);
      
      // Insert movement into external DB
      const result = await pool.query(
        `INSERT INTO inventory.movements (smart, article, qty_delta, reason, note, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [movement.smart, movement.article, movement.qtyDelta, movement.reason, movement.note]
      );
      
      // Map snake_case to camelCase
      const row = result.rows[0];
      return {
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error creating movement:', error);
      throw error;
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getMovements(limit = 50, offset = 0): Promise<Movement[]> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        console.log('No active inventory connection found');
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
      
      // Connect to external DB
      pool = this.createExternalPool(conn);
      
      // Query movements from external DB
      const result = await pool.query(
        `SELECT * FROM inventory.movements 
         ORDER BY created_at DESC 
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      
      // Map snake_case to camelCase
      return result.rows.map(row => ({
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('Error getting movements:', error);
      throw new Error('Failed to get movements');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getMovementsBySmartAndArticle(smartCode: string, article: string): Promise<Movement[]> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
      // Get full connection details
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return [];
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const result = await pool.query(
        `SELECT * FROM inventory.movements 
         WHERE smart = $1 AND article = $2
         ORDER BY created_at DESC`,
        [smartCode, article]
      );
      
      // Map snake_case to camelCase
      return result.rows.map(row => ({
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('Error getting movements by SMART and article:', error);
      throw new Error('Failed to get movements');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getStockLevels(limit = 50, offset = 0): Promise<StockLevel[]> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
      // Get full connection details
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return [];
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      // Get stock aggregates from inventory view
      const result = await pool.query(
        `SELECT smart, article, total_qty
         FROM inventory.stock
         ORDER BY smart, article
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      
      // Enrich with SMART reference data from active connection
      const enriched = await Promise.all(
        result.rows.map(async (row) => {
          const smartData = await this.getSmartByCode(row.smart);
          return {
            smart: row.smart,
            article: row.article,
            totalQty: row.total_qty,
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
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getStockBySmartAndArticle(smartCode: string, article: string): Promise<StockLevel | undefined> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return undefined;
      }
      
      // Get full connection details
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return undefined;
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const result = await pool.query(
        `SELECT smart, article, total_qty
         FROM inventory.stock
         WHERE smart = $1 AND article = $2
         LIMIT 1`,
        [smartCode, article]
      );
      
      if (result.rows.length === 0) return undefined;
      
      const row = result.rows[0];
      
      // Enrich with SMART reference data from active connection
      const smartData = await this.getSmartByCode(smartCode);
      
      return {
        smart: row.smart,
        article: row.article,
        totalQty: row.total_qty,
        brand: smartData?.brand || undefined,
        description: smartData?.description || undefined,
        name: smartData?.name || undefined,
      };
    } catch (error) {
      console.error('Error getting stock by SMART and article:', error);
      throw new Error('Failed to get stock');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getTotalStockBySmart(smartCode: string): Promise<number> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return 0;
      }
      
      // Get full connection details
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return 0;
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const result = await pool.query(
        `SELECT SUM(total_qty) as total
         FROM inventory.stock
         WHERE smart = $1`,
        [smartCode]
      );
      
      return result.rows[0]?.total || 0;
    } catch (error) {
      console.error('Error getting total stock by SMART:', error);
      throw new Error('Failed to get total stock');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getReasons(): Promise<Reason[]> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
      // Get full connection details
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return [];
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const result = await pool.query(
        `SELECT code, title FROM inventory.reasons ORDER BY code`
      );
      
      return result.rows;
    } catch (error) {
      console.error('Error getting reasons:', error);
      throw new Error('Failed to get reasons');
    } finally {
      if (pool) {
        await pool.end();
      }
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
    let pool: Pool | null = null;
    try {
      // Create pool
      pool = new Pool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.username,
        password: connection.password,
        ssl: connection.ssl ? { rejectUnauthorized: false } : undefined,
      });
      
      // Try to connect
      const result = await pool.query('SELECT version()');
      
      return {
        success: true,
        message: 'Соединение успешно',
        version: result.rows[0]?.version || 'Unknown',
      };
    } catch (error) {
      console.error('DB connection test error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Не удалось подключиться',
      };
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getDbTables(connectionId: number): Promise<DbTablesResult> {
    let pool: Pool | null = null;
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
      
      // Connect and get tables
      pool = this.createExternalPool(connection);
      const result = await pool.query(`
        SELECT 
          table_schema as schema,
          table_name as name,
          table_type as type
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `);
      
      return {
        connectionName: connection.name,
        tables: result.rows.map((row: any) => ({
          schema: row.schema,
          name: row.name,
          type: row.type,
        })),
      };
    } catch (error) {
      console.error('Error getting DB tables:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to get tables');
    } finally {
      if (pool) {
        await pool.end();
      }
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
    let pool: Pool | null = null;
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
      
      // Connect and get columns
      pool = this.createExternalPool(connection);
      
      // Parse schema and table name
      const [schema, table] = tableName.includes('.') 
        ? tableName.split('.') 
        : ['public', tableName];
      
      const result = await pool.query(`
        SELECT 
          column_name as name,
          data_type as type
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, table]);
      
      return result.rows.map((row: any) => ({
        name: row.name,
        type: row.type,
      }));
    } catch (error) {
      console.error('Error getting table columns:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to get columns');
    } finally {
      if (pool) {
        await pool.end();
      }
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

      // External database credentials (parts_admin)
      const externalHost = '81.30.105.134';
      const externalPort = 5403;
      const externalDatabase = 'parts_admin';
      const externalUsername = 'admin';
      const externalPassword = 'Password123';

      // Create SMART connection to external database
      await inventoryDb.insert(dbConnections).values({
        name: 'По умолчанию (SMART)',
        host: externalHost,
        port: externalPort,
        database: externalDatabase,
        username: externalUsername,
        password: externalPassword,
        role: 'smart',
        tableName: 'public.smart',
        fieldMapping: {
          smart: 'smart',
          articles: 'артикул',
          name: 'наименование',
          brand: 'бренд',
          description: 'коннект_бренд',
        } as any,
        isActive: true,
        updatedAt: new Date(),
      });

      // Create Inventory connection to external database
      await inventoryDb.insert(dbConnections).values({
        name: 'По умолчанию (Учёт)',
        host: externalHost,
        port: externalPort,
        database: externalDatabase,
        username: externalUsername,
        password: externalPassword,
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
      
      // Initialize inventory schema in external database
      await this.initializeExternalInventoryDb(
        externalHost,
        externalPort,
        externalDatabase,
        externalUsername,
        externalPassword
      );
    } catch (error) {
      console.error('Error creating default connections:', error);
      // Don't throw, just log - this is optional
    }
  }

  private async initializeExternalInventoryDb(
    host: string,
    port: number,
    database: string,
    username: string,
    password: string
  ): Promise<void> {
    let pool: Pool | null = null;
    try {
      console.log('Initializing inventory schema in external database...');
      
      // Create pool for external database
      pool = new Pool({
        host,
        port,
        database,
        user: username,
        password,
      });
      
      // Create inventory schema
      await pool.query(`CREATE SCHEMA IF NOT EXISTS inventory`);
      
      // Create reasons table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS inventory.reasons (
          code VARCHAR PRIMARY KEY,
          title TEXT NOT NULL
        )
      `);
      
      // Insert fixed reasons
      await pool.query(`
        INSERT INTO inventory.reasons (code, title) VALUES
          ('purchase', 'Покупка'),
          ('sale', 'Продажа'),
          ('return', 'Возврат'),
          ('adjust', 'Корректировка'),
          ('writeoff', 'Списание')
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
      
      console.log('External inventory schema initialized successfully');
    } catch (error) {
      console.error('Error initializing external inventory schema:', error);
      // Don't throw - this is optional initialization
    } finally {
      // Close pool connection
      if (pool) {
        await pool.end();
      }
    }
  }
}

export const storage = new DatabaseStorage();
