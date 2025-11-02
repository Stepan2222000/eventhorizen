import { eq, sql, and, ilike } from "drizzle-orm";
import { partsDb, inventoryDb } from "./db";
import { smart, reasons, movements, dbConnections, shippingMethods } from "@shared/schema";
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
  ConnectionRole,
  ShippingMethod,
  InsertShippingMethod,
  SoldOutItem,
  TopPart
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
  getMovementById(id: number): Promise<Movement | undefined>;
  getMovementsBySmartAndArticle(smart: string, article: string): Promise<Movement[]>;
  getPurchasesBySmart(smart: string): Promise<Movement[]>;
  getSalesBySmart(smart: string): Promise<Movement[]>;
  updateMovement(id: number, updates: Partial<Pick<Movement, 'purchasePrice' | 'note' | 'qtyDelta' | 'boxNumber'>>): Promise<Movement>;
  updateMovementSaleStatus(id: number, status: 'awaiting_shipment' | 'shipped'): Promise<Movement>;
  
  // Stock operations
  getStockLevels(limit?: number, offset?: number): Promise<StockLevel[]>;
  getStockBySmartAndArticle(smart: string, article: string): Promise<StockLevel | undefined>;
  getTotalStockBySmart(smart: string): Promise<number>;
  getTotalStockBySmartBatch(smartCodes: string[]): Promise<Map<string, number>>;
  
  // Analytics operations
  getSoldOutItems(): Promise<SoldOutItem[]>;
  getTopParts(mode: 'profit' | 'sales' | 'combined'): Promise<TopPart[]>;
  
  // Reasons
  getReasons(): Promise<Reason[]>;
  
  // Shipping methods
  getShippingMethods(): Promise<ShippingMethod[]>;
  createShippingMethod(method: InsertShippingMethod): Promise<ShippingMethod>;
  deleteShippingMethod(id: number): Promise<void>;
  
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
      // Supports searching by SMART code OR by article number
      const query = `
        SELECT 
          "${smartField}" as smart,
          "${articlesField}" as articles,
          "${nameField}" as name,
          "${brandField}" as brand,
          "${descField}" as description
        FROM ${tableName}
        WHERE 
          -- Search by SMART code
          TRANSLATE(
            UPPER(REGEXP_REPLACE("${smartField}", '[\\s\\-_./]', '', 'g')),
            'АВЕКМНОРСТУХЁ',
            'ABEKMHOPCTYXE'
          ) LIKE '%' || $1 || '%'
          OR
          -- Search by article variants
          EXISTS (
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

  private async getCurrentStock(pool: Pool, smart: string, article: string): Promise<number> {
    // Stock is now grouped by SMART code only, not by article
    // Check total stock for the SMART code regardless of article
    const result = await pool.query(
      `SELECT COALESCE(SUM(qty_delta), 0)::int as total_qty
       FROM inventory.movements
       WHERE smart = $1`,
      [smart]
    );
    return result.rows[0]?.total_qty || 0;
  }

  async createMovement(movement: InsertMovement): Promise<Movement> {
    // Retry logic for serialization failures
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.createMovementAttempt(movement);
      } catch (error: any) {
        // Check if this is a serialization error
        const isSerializationError = 
          error?.code === '40001' || 
          error?.message?.includes('could not serialize access');
        
        if (isSerializationError && attempt < maxRetries - 1) {
          // Wait before retry with exponential backoff
          const delayMs = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          lastError = error;
          continue;
        }
        
        // Not a serialization error or retries exhausted
        throw error;
      }
    }
    
    // All retries exhausted
    throw new Error(`Failed to create movement after ${maxRetries} attempts due to concurrent access: ${lastError?.message}`);
  }

  private async createMovementAttempt(movement: InsertMovement): Promise<Movement> {
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
      
      // Start transaction with SERIALIZABLE isolation for stock validation
      // This prevents race conditions where two concurrent transactions both read
      // the same stock level and both insert, potentially creating negative stock
      await pool.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      
      try {
        // Check for duplicate return within transaction to prevent race conditions
        if (movement.reason === 'return' && movement.note && movement.note.includes('Возврат продажи #')) {
          const match = movement.note.match(/Возврат продажи #(\d+)/);
          if (match) {
            const saleId = match[1];
            const duplicateCheck = await pool.query(
              `SELECT id FROM inventory.movements WHERE reason = 'return' AND note = $1 LIMIT 1`,
              [`Возврат продажи #${saleId}`]
            );
            if (duplicateCheck.rows.length > 0) {
              throw new Error('Товар уже возвращен на склад');
            }
          }
        }
        
        // Get current stock for this article+smart combination
        const currentStock = await this.getCurrentStock(pool, movement.smart, movement.article);
        
        // Validate stock based on operation type
        const isDecrease = movement.reason === 'sale' || movement.reason === 'writeoff';
        const isNegativeAdjust = movement.reason === 'adjust' && movement.qtyDelta < 0;
        
        if (isDecrease || isNegativeAdjust) {
          const requestedQty = Math.abs(movement.qtyDelta);
          
          if (currentStock < requestedQty) {
            throw new InsufficientStockError(
              movement.article,
              movement.smart,
              currentStock,
              requestedQty
            );
          }
        }
        
        // Insert movement into external DB with new fields
        const result = await pool.query(
          `INSERT INTO inventory.movements (
            smart, article, qty_delta, reason, note,
            purchase_price, sale_price, delivery_price,
            box_number, track_number, shipping_method_id, sale_status,
            created_at
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           RETURNING *`,
          [
            movement.smart, 
            movement.article, 
            movement.qtyDelta, 
            movement.reason, 
            movement.note,
            movement.purchasePrice || null,
            movement.salePrice || null,
            movement.deliveryPrice || null,
            movement.boxNumber || null,
            movement.trackNumber || null,
            movement.shippingMethodId || null,
            movement.saleStatus || null
          ]
        );
        
        // Commit transaction
        await pool.query('COMMIT');
        
        // Map snake_case to camelCase
        const row = result.rows[0];
        return {
          id: row.id,
          smart: row.smart,
          article: row.article,
          qtyDelta: row.qty_delta,
          reason: row.reason,
          note: row.note,
          purchasePrice: row.purchase_price,
          salePrice: row.sale_price,
          deliveryPrice: row.delivery_price,
          boxNumber: row.box_number,
          trackNumber: row.track_number,
          shippingMethodId: row.shipping_method_id,
          saleStatus: row.sale_status,
          createdAt: row.created_at,
        };
      } catch (txError) {
        // Rollback transaction on error
        await pool.query('ROLLBACK');
        throw txError;
      }
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
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
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

  async getMovementById(id: number): Promise<Movement | undefined> {
    let pool: Pool | null = null;
    try {
      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
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
      
      // Connect to external DB
      pool = this.createExternalPool(conn);
      
      // Query movement by ID from external DB
      const result = await pool.query(
        `SELECT * FROM inventory.movements WHERE id = $1`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return undefined;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error getting movement by ID:', error);
      throw new Error('Failed to get movement');
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
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
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
      
      // Get stock aggregates from inventory view (grouped by SMART only)
      const result = await pool.query(
        `SELECT smart, total_qty
         FROM inventory.stock
         ORDER BY smart
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      
      // Enrich with SMART reference data from active connection
      const enriched = await Promise.all(
        result.rows.map(async (row) => {
          const smartData = await this.getSmartByCode(row.smart);
          return {
            smart: row.smart,
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
    // Since stock is now grouped by SMART only, just get stock by SMART code
    // (article parameter is kept for backwards compatibility but not used)
    return this.getTotalStockBySmart(smartCode).then(totalQty => {
      if (totalQty === 0) return undefined;
      return this.getSmartByCode(smartCode).then(smartData => ({
        smart: smartCode,
        totalQty,
        brand: smartData?.brand || undefined,
        description: smartData?.description || undefined,
        name: smartData?.name || undefined,
      }));
    });
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
      
      // View already groups by SMART, so just get the total_qty directly
      const result = await pool.query(
        `SELECT total_qty
         FROM inventory.stock
         WHERE smart = $1`,
        [smartCode]
      );
      
      return result.rows[0]?.total_qty || 0;
    } catch (error) {
      console.error('Error getting total stock by SMART:', error);
      throw new Error('Failed to get total stock');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getTotalStockBySmartBatch(smartCodes: string[]): Promise<Map<string, number>> {
    let pool: Pool | null = null;
    const stockMap = new Map<string, number>();
    
    try {
      // Return empty map if no codes provided
      if (!smartCodes || smartCodes.length === 0) {
        return stockMap;
      }

      // Get active inventory connection
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return stockMap;
      }
      
      // Get full connection details
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        return stockMap;
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      // Get stock for all SMART codes in one query
      const result = await pool.query(
        `SELECT smart, total_qty
         FROM inventory.stock
         WHERE smart = ANY($1)`,
        [smartCodes]
      );
      
      // Build map from results
      for (const row of result.rows) {
        stockMap.set(row.smart, row.total_qty || 0);
      }
      
      // Fill in 0 for codes not found in stock
      for (const code of smartCodes) {
        if (!stockMap.has(code)) {
          stockMap.set(code, 0);
        }
      }
      
      return stockMap;
    } catch (error) {
      console.error('Error getting total stock by SMART batch:', error);
      // Return partial results or empty map instead of throwing
      return stockMap;
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

  async getShippingMethods(): Promise<ShippingMethod[]> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
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
        `SELECT id, name, created_at FROM inventory.shipping_methods ORDER BY name`
      );
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('Error getting shipping methods:', error);
      throw new Error('Failed to get shipping methods');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async createShippingMethod(method: InsertShippingMethod): Promise<ShippingMethod> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        throw new Error('No active inventory connection configured');
      }
      
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        throw new Error('Inventory connection not found');
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const result = await pool.query(
        `INSERT INTO inventory.shipping_methods (name) 
         VALUES ($1) 
         RETURNING *`,
        [method.name]
      );
      
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error creating shipping method:', error);
      throw error;
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async deleteShippingMethod(id: number): Promise<void> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        throw new Error('No active inventory connection configured');
      }
      
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        throw new Error('Inventory connection not found');
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      await pool.query(
        `DELETE FROM inventory.shipping_methods WHERE id = $1`,
        [id]
      );
    } catch (error) {
      console.error('Error deleting shipping method:', error);
      throw error;
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getPurchasesBySmart(smartCode: string): Promise<Movement[]> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
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
         WHERE smart = $1 AND reason = 'purchase'
         ORDER BY created_at DESC`,
        [smartCode]
      );
      
      return result.rows.map((row: any) => ({
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('Error getting purchases by SMART:', error);
      throw new Error('Failed to get purchases');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getSalesBySmart(smartCode: string): Promise<Movement[]> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
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
         WHERE smart = $1 AND reason = 'sale'
         ORDER BY created_at DESC`,
        [smartCode]
      );
      
      return result.rows.map((row: any) => ({
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('Error getting sales by SMART:', error);
      throw new Error('Failed to get sales');
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async getSoldOutItems(): Promise<SoldOutItem[]> {
    let pool: Pool | null = null;
    let smartPool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
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
      
      // Get items with zero stock but had sales
      const result = await pool.query(`
        WITH stock_summary AS (
          SELECT 
            smart,
            SUM(qty_delta) as current_stock
          FROM inventory.movements
          GROUP BY smart
          HAVING SUM(qty_delta) = 0
        ),
        sales_summary AS (
          SELECT 
            m.smart,
            AVG(CAST(m.sale_price AS NUMERIC)) as avg_sale_price,
            MAX(m.created_at) as last_sale_date,
            COUNT(*) as total_sales
          FROM inventory.movements m
          WHERE m.reason = 'sale'
          GROUP BY m.smart
        )
        SELECT 
          ss.smart,
          COALESCE(sal.avg_sale_price, 0) as avg_sale_price,
          sal.last_sale_date,
          COALESCE(sal.total_sales, 0) as total_sales
        FROM stock_summary ss
        INNER JOIN sales_summary sal ON ss.smart = sal.smart
        ORDER BY sal.last_sale_date DESC
      `);
      
      // Get SMART names from external DB
      const smartConn = await this.getActiveConnection('smart');
      if (smartConn) {
        const smartFullConnections = await inventoryDb
          .select()
          .from(dbConnections)
          .where(eq(dbConnections.id, smartConn.id))
          .limit(1);
        
        if (smartFullConnections.length) {
          const smartConnData = smartFullConnections[0];
          smartPool = this.createExternalPool(smartConnData);
          const fieldMapping = (smartConnData.fieldMapping as any) || {};
          const smartField = fieldMapping.smart || 'smart';
          const nameField = fieldMapping.name || 'name';
          const tableName = smartConnData.tableName || 'smart';
          
          const smartCodes = result.rows.map((r: any) => r.smart);
          if (smartCodes.length > 0) {
            const namesResult = await smartPool.query(
              `SELECT ${smartField} as smart, ${nameField} as name 
               FROM ${tableName} 
               WHERE ${smartField} = ANY($1)`,
              [smartCodes]
            );
            
            const namesMap = new Map(namesResult.rows.map((r: any) => [r.smart, r.name]));
            
            return result.rows.map((row: any) => ({
              smart: row.smart,
              name: namesMap.get(row.smart),
              avgSalePrice: parseFloat(row.avg_sale_price),
              lastSaleDate: row.last_sale_date,
              totalSales: parseInt(row.total_sales),
            }));
          }
        }
      }
      
      return result.rows.map((row: any) => ({
        smart: row.smart,
        name: undefined,
        avgSalePrice: parseFloat(row.avg_sale_price),
        lastSaleDate: row.last_sale_date,
        totalSales: parseInt(row.total_sales),
      }));
    } catch (error) {
      console.error('Error getting sold out items:', error);
      throw new Error('Failed to get sold out items');
    } finally {
      if (pool) {
        await pool.end();
      }
      if (smartPool) {
        await smartPool.end();
      }
    }
  }

  async getTopParts(mode: 'profit' | 'sales' | 'combined'): Promise<TopPart[]> {
    let pool: Pool | null = null;
    let smartPool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        return [];
      }
      
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
      
      // Calculate top parts with different metrics
      const result = await pool.query(`
        WITH sales_data AS (
          SELECT 
            m.smart,
            m.article,
            SUM(ABS(m.qty_delta)) as total_sales_qty,
            AVG(CAST(m.sale_price AS NUMERIC)) as avg_sale_price,
            AVG(CAST(m.delivery_price AS NUMERIC)) as avg_delivery_price
          FROM inventory.movements m
          WHERE m.reason = 'sale'
          GROUP BY m.smart, m.article
        ),
        purchase_data AS (
          SELECT 
            m.smart,
            m.article,
            m.created_at as purchase_date,
            CAST(m.purchase_price AS NUMERIC) as purchase_price,
            m.qty_delta as purchase_qty
          FROM inventory.movements m
          WHERE m.reason = 'purchase'
        ),
        profit_calc AS (
          SELECT 
            s.smart,
            s.total_sales_qty,
            s.avg_sale_price,
            (
              SELECT AVG(p.purchase_price)
              FROM purchase_data p
              WHERE p.smart = s.smart AND p.article = s.article
              ORDER BY p.purchase_date DESC
              LIMIT 10
            ) as avg_purchase_price,
            COALESCE(s.avg_delivery_price, 0) as avg_delivery_price
          FROM sales_data s
        ),
        stock_calc AS (
          SELECT 
            smart,
            SUM(qty_delta) as current_stock
          FROM inventory.movements
          GROUP BY smart
        )
        SELECT 
          p.smart,
          COALESCE(p.avg_sale_price - p.avg_purchase_price - p.avg_delivery_price, 0) as avg_profit,
          COALESCE(p.total_sales_qty, 0) as total_sales,
          CASE 
            WHEN p.avg_purchase_price > 0 THEN 
              ((p.avg_sale_price - p.avg_purchase_price - p.avg_delivery_price) / p.avg_purchase_price * 100)
            ELSE 0
          END as profit_margin,
          COALESCE(s.current_stock, 0) as current_stock
        FROM profit_calc p
        LEFT JOIN stock_calc s ON p.smart = s.smart
        WHERE p.avg_purchase_price IS NOT NULL
      `);
      
      // Calculate combined score for each item
      const items = result.rows.map((row: any) => {
        const avgProfit = parseFloat(row.avg_profit);
        const totalSales = parseInt(row.total_sales);
        const profitMargin = parseFloat(row.profit_margin);
        const currentStock = parseInt(row.current_stock);
        
        // Weighted formula: (sales × 0.5) + (profit × 0.5)
        // Normalize sales (max 100) and profit (max 1000) for fair weighting
        const normalizedSales = Math.min(totalSales / 10, 100);
        const normalizedProfit = Math.min(avgProfit / 10, 100);
        const combinedScore = (normalizedSales * 0.5) + (normalizedProfit * 0.5);
        
        return {
          smart: row.smart,
          name: undefined,
          avgProfit,
          totalSales,
          profitMargin,
          currentStock,
          combinedScore,
        };
      });
      
      // Sort based on mode
      let sortedItems: any[];
      if (mode === 'profit') {
        sortedItems = items.sort((a, b) => b.avgProfit - a.avgProfit);
      } else if (mode === 'sales') {
        sortedItems = items.sort((a, b) => b.totalSales - a.totalSales);
      } else {
        sortedItems = items.sort((a, b) => b.combinedScore! - a.combinedScore!);
      }
      
      // Get SMART names from external DB
      const smartConn = await this.getActiveConnection('smart');
      if (smartConn) {
        const smartFullConnections = await inventoryDb
          .select()
          .from(dbConnections)
          .where(eq(dbConnections.id, smartConn.id))
          .limit(1);
        
        if (smartFullConnections.length) {
          const smartConnData = smartFullConnections[0];
          smartPool = this.createExternalPool(smartConnData);
          const fieldMapping = (smartConnData.fieldMapping as any) || {};
          const smartField = fieldMapping.smart || 'smart';
          const nameField = fieldMapping.name || 'name';
          const tableName = smartConnData.tableName || 'smart';
          
          const smartCodes = sortedItems.map((item) => item.smart);
          if (smartCodes.length > 0) {
            const namesResult = await smartPool.query(
              `SELECT ${smartField} as smart, ${nameField} as name 
               FROM ${tableName} 
               WHERE ${smartField} = ANY($1)`,
              [smartCodes]
            );
            
            const namesMap = new Map(namesResult.rows.map((r: any) => [r.smart, r.name]));
            
            return sortedItems.map((item) => ({
              ...item,
              name: namesMap.get(item.smart),
            }));
          }
        }
      }
      
      return sortedItems;
    } catch (error) {
      console.error('Error getting top parts:', error);
      throw new Error('Failed to get top parts');
    } finally {
      if (pool) {
        await pool.end();
      }
      if (smartPool) {
        await smartPool.end();
      }
    }
  }

  async updateMovement(id: number, updates: Partial<Pick<Movement, 'purchasePrice' | 'note' | 'qtyDelta' | 'boxNumber'>>): Promise<Movement> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        throw new Error('No active inventory connection configured');
      }
      
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        throw new Error('Inventory connection not found');
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      if (updates.purchasePrice !== undefined) {
        setClauses.push(`purchase_price = $${paramIndex++}`);
        values.push(updates.purchasePrice);
      }
      
      if (updates.note !== undefined) {
        setClauses.push(`note = $${paramIndex++}`);
        values.push(updates.note);
      }
      
      if (updates.qtyDelta !== undefined) {
        setClauses.push(`qty_delta = $${paramIndex++}`);
        values.push(updates.qtyDelta);
      }
      
      if (updates.boxNumber !== undefined) {
        setClauses.push(`box_number = $${paramIndex++}`);
        values.push(updates.boxNumber);
      }
      
      if (setClauses.length === 0) {
        throw new Error('No fields to update');
      }
      
      values.push(id);
      
      const result = await pool.query(
        `UPDATE inventory.movements 
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );
      
      if (result.rows.length === 0) {
        throw new Error('Movement not found');
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error updating movement:', error);
      throw error;
    } finally {
      if (pool) {
        await pool.end();
      }
    }
  }

  async updateMovementSaleStatus(id: number, status: 'awaiting_shipment' | 'shipped'): Promise<Movement> {
    let pool: Pool | null = null;
    try {
      const activeConn = await this.getActiveConnection('inventory');
      
      if (!activeConn) {
        throw new Error('No active inventory connection configured');
      }
      
      const fullConnections = await inventoryDb
        .select()
        .from(dbConnections)
        .where(eq(dbConnections.id, activeConn.id))
        .limit(1);
      
      if (!fullConnections.length) {
        throw new Error('Inventory connection not found');
      }
      
      const conn = fullConnections[0];
      pool = this.createExternalPool(conn);
      
      const result = await pool.query(
        `UPDATE inventory.movements 
         SET sale_status = $1 
         WHERE id = $2 
         RETURNING *`,
        [status, id]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Movement not found');
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        smart: row.smart,
        article: row.article,
        qtyDelta: row.qty_delta,
        reason: row.reason,
        note: row.note,
        purchasePrice: row.purchase_price,
        salePrice: row.sale_price,
        deliveryPrice: row.delivery_price,
        boxNumber: row.box_number,
        trackNumber: row.track_number,
        shippingMethodId: row.shipping_method_id,
        saleStatus: row.sale_status,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('Error updating movement sale status:', error);
      throw error;
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
      
      // Create stock VIEW (grouped by SMART code only to aggregate across all articles)
      await pool.query(`
        CREATE OR REPLACE VIEW inventory.stock AS
        SELECT 
          smart,
          SUM(qty_delta) as total_qty
        FROM inventory.movements
        GROUP BY smart
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
