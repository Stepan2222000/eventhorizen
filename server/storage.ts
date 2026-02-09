import type { Pool, PoolClient } from "pg";
import type {
  ArticleSearchResult,
  BulkImportResult,
  BulkImportRow,
  CreateCustomerInput,
  CreateOrderInput,
  CreateOrderReturnInput,
  Customer,
  DeliveryPayer,
  InsertMovement,
  Movement,
  OrderDetails,
  OrderFinancialSummary,
  OrderItem,
  OrderReturn,
  OrderShipment,
  OrderSummary,
  Reason,
  ReasonCode,
  ReturnItem,
  ReturnKind,
  ShipmentItem,
  ShipmentStatus,
  ShippingMethod,
  SoldOutItem,
  StockLevel,
  TopPart,
  UpdateCustomerInput,
} from "@shared/schema";
import { reasonCodeSchema, REASONS } from "@shared/schema";
import type { SmartCache } from "./smart-cache";

function isSerializationError(err: unknown): boolean {
  const e = err as any;
  return e?.code === "40001" || (typeof e?.message === "string" && e.message.includes("could not serialize access"));
}

function toInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function toDateIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function toFloat(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function toNumberString(value: unknown): string {
  return toFloat(value).toFixed(2);
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidRequestError(`${field} обязательно`);
  }
  return value.trim();
}

function requireNumberString(value: unknown, field: string): string {
  const str = requireNonEmpty(value, field);
  const n = Number(str);
  if (!Number.isFinite(n)) {
    throw new InvalidRequestError(`${field} должно быть числом`);
  }
  return str;
}

function requireNonNegativeNumberString(value: unknown, field: string): string {
  const str = requireNumberString(value, field);
  if (Number(str) < 0) {
    throw new InvalidRequestError(`${field} не может быть отрицательным`);
  }
  return str;
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export class InsufficientStockError extends Error {
  constructor(
    public smart: string,
    public currentStock: number,
    public requestedQty: number
  ) {
    super(
      `Недостаточно товара на складе. SMART: ${smart}. Текущий остаток: ${currentStock}, запрошено: ${requestedQty}`
    );
    this.name = "InsufficientStockError";
  }
}

type MovementRow = {
  id: number;
  smart: string;
  qty_delta: number;
  reason: ReasonCode;
  note: string | null;
  purchase_price: string | null;
  sale_price: string | null;
  delivery_price: string | null;
  box_number: string | null;
  track_number: string | null;
  shipping_method_id: number | null;
  sale_status: string | null;
  order_id: number | null;
  order_item_id: number | null;
  shipment_id: number | null;
  return_id: number | null;
  created_at: Date | string;
};

export class DatabaseStorage {
  constructor(
    private inventoryPool: Pool,
    private smartCache: SmartCache
  ) {}

  updateSmartCache(cache: SmartCache) {
    this.smartCache = cache;
  }

  searchSmart(query: string): ArticleSearchResult[] {
    const matches = this.smartCache.search(query);
    return matches.map((m) => ({
      smart: m.smart,
      articles: m.articles,
      name: m.name,
      brand: m.brand,
      description: m.description,
      currentStock: 0, // filled by routes using batch query
    }));
  }

  getSmartByCode(smart: string) {
    return this.smartCache.getBySmart(smart);
  }

  private async getCurrentStockTx(client: PoolClient, smart: string): Promise<number> {
    const res = await client.query<{ total_qty: unknown }>(
      `SELECT COALESCE(SUM(qty_delta), 0) as total_qty FROM inventory.movements WHERE smart = $1`,
      [smart]
    );
    return toInt(res.rows[0]?.total_qty);
  }

  private mapMovementRow(row: MovementRow): Movement {
    return {
      id: row.id,
      smart: row.smart,
      qtyDelta: toInt(row.qty_delta),
      reason: row.reason,
      note: row.note,
      purchasePrice: row.purchase_price,
      salePrice: row.sale_price,
      deliveryPrice: row.delivery_price,
      boxNumber: row.box_number,
      trackNumber: row.track_number,
      shippingMethodId: row.shipping_method_id,
      saleStatus:
        row.sale_status === "awaiting_shipment" || row.sale_status === "shipped" ? row.sale_status : null,
      orderId: row.order_id,
      orderItemId: row.order_item_id,
      shipmentId: row.shipment_id,
      returnId: row.return_id,
      createdAt: toDateIso(row.created_at),
    };
  }

  private enrichMovement(m: Movement): Movement {
    const smart = this.smartCache.getBySmart(m.smart);
    if (!smart) return m;
    return {
      ...m,
      articles: smart.articles,
      name: smart.name ?? null,
      brand: smart.brand ?? null,
      description: smart.description ?? null,
    };
  }

  private validateAndSanitizeForInsert(input: InsertMovement): Required<InsertMovement> {
    const reason = input.reason;
    const smart = requireNonEmpty(input.smart, "SMART код");
    const qtyDelta = input.qtyDelta;

    if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
      throw new InvalidRequestError("Количество не может быть равно 0");
    }
    if (!Number.isInteger(qtyDelta)) {
      throw new InvalidRequestError("Количество должно быть целым числом");
    }

    const note = input.note ?? null;
    const purchasePrice = input.purchasePrice ?? null;
    const salePrice = input.salePrice ?? null;
    const deliveryPrice = input.deliveryPrice ?? null;
    const boxNumber = input.boxNumber ?? null;
    const trackNumber = input.trackNumber ?? null;
    const shippingMethodId = input.shippingMethodId ?? null;

    if (!this.smartCache.getBySmart(smart)) {
      throw new InvalidRequestError(`SMART код не найден в справочнике: ${smart}`);
    }

    if (reason === "purchase") {
      if (qtyDelta <= 0) throw new InvalidRequestError("Для покупки количество должно быть положительным");
      requireNumberString(purchasePrice, "Цена закупки");
      requireNonEmpty(boxNumber, "Номер коробки");
      return {
        smart,
        qtyDelta,
        reason,
        note,
        purchasePrice,
        salePrice: null,
        deliveryPrice: null,
        boxNumber,
        trackNumber: null,
        shippingMethodId: null,
        saleStatus: null,
      };
    }

    if (reason === "sale") {
      if (qtyDelta >= 0) throw new InvalidRequestError("Для продажи количество должно быть отрицательным");
      requireNumberString(salePrice, "Цена продажи");
      requireNumberString(deliveryPrice, "Стоимость доставки");
      if (shippingMethodId === null || !Number.isFinite(shippingMethodId)) {
        throw new InvalidRequestError("Способ доставки обязателен");
      }
      return {
        smart,
        qtyDelta,
        reason,
        note,
        purchasePrice: null,
        salePrice,
        deliveryPrice,
        boxNumber: null,
        trackNumber,
        shippingMethodId,
        // By spec: server sets it automatically for all new sales.
        saleStatus: "awaiting_shipment",
      };
    }

    if (reason === "return") {
      if (qtyDelta <= 0) throw new InvalidRequestError("Для возврата количество должно быть положительным");
      requireNonEmpty(note, "Примечание");
      return {
        smart,
        qtyDelta,
        reason,
        note,
        purchasePrice: null,
        salePrice: null,
        deliveryPrice: null,
        boxNumber: null,
        trackNumber: null,
        shippingMethodId: null,
        saleStatus: null,
      };
    }

    if (reason === "writeoff") {
      if (qtyDelta >= 0) throw new InvalidRequestError("Для списания количество должно быть отрицательным");
      return {
        smart,
        qtyDelta,
        reason,
        note,
        purchasePrice: null,
        salePrice: null,
        deliveryPrice: null,
        boxNumber: null,
        trackNumber: null,
        shippingMethodId: null,
        saleStatus: null,
      };
    }

    // adjust
    requireNonEmpty(note, "Примечание");
    // purchasePrice is optional here; validate only if provided
    if (purchasePrice !== null && purchasePrice !== undefined && String(purchasePrice).trim()) {
      requireNumberString(purchasePrice, "Цена за единицу");
    }
    return {
      smart,
      qtyDelta,
      reason,
      note,
      purchasePrice: purchasePrice ?? null,
      salePrice: null,
      deliveryPrice: null,
      boxNumber: null,
      trackNumber: null,
      shippingMethodId: null,
      saleStatus: null,
    };
  }

  async createMovement(input: InsertMovement): Promise<Movement> {
    const maxRetries = 3;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.createMovementAttempt(input);
      } catch (err) {
        lastError = err;
        if (isSerializationError(err) && attempt < maxRetries - 1) {
          const delayMs = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Failed to create movement after ${maxRetries} attempts due to concurrent access: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private async createMovementAttempt(input: InsertMovement): Promise<Movement> {
    const movement = this.validateAndSanitizeForInsert(input);

    const client = await this.inventoryPool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      try {
        // Prevent duplicate return (same note string).
        if (movement.reason === "return" && movement.note && movement.note.includes("Возврат продажи #")) {
          const dup = await client.query(`SELECT id FROM inventory.movements WHERE reason = 'return' AND note = $1 LIMIT 1`, [
            movement.note,
          ]);
          if (dup.rows.length > 0) {
            throw new Error("Товар уже возвращен на склад");
          }
        }

        const isDecrease = movement.reason === "sale" || movement.reason === "writeoff";
        const isNegativeAdjust = movement.reason === "adjust" && movement.qtyDelta < 0;

        if (isDecrease || isNegativeAdjust) {
          const currentStock = await this.getCurrentStockTx(client, movement.smart);
          const requestedQty = Math.abs(movement.qtyDelta);
          if (currentStock < requestedQty) {
            throw new InsufficientStockError(movement.smart, currentStock, requestedQty);
          }
        }

        const insertRes = await client.query<MovementRow>(
          `
          INSERT INTO inventory.movements (
            smart, qty_delta, reason, note,
            purchase_price, sale_price, delivery_price,
            box_number, track_number, shipping_method_id, sale_status,
            created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
          RETURNING *
        `,
          [
            movement.smart,
            movement.qtyDelta,
            movement.reason,
            movement.note,
            movement.purchasePrice,
            movement.salePrice,
            movement.deliveryPrice,
            movement.boxNumber,
            movement.trackNumber,
            movement.shippingMethodId,
            movement.saleStatus,
          ]
        );

        await client.query("COMMIT");

        const mapped = this.mapMovementRow(insertRes.rows[0]);
        return this.enrichMovement(mapped);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async getMovements(): Promise<Movement[]> {
    const res = await this.inventoryPool.query<MovementRow>(`
      SELECT *
      FROM inventory.movements
      ORDER BY created_at DESC
    `);
    return res.rows.map((r) => this.enrichMovement(this.mapMovementRow(r)));
  }

  async getMovementById(id: number): Promise<Movement | undefined> {
    const res = await this.inventoryPool.query<MovementRow>(`SELECT * FROM inventory.movements WHERE id = $1`, [id]);
    if (res.rows.length === 0) return undefined;
    return this.enrichMovement(this.mapMovementRow(res.rows[0]));
  }

  async getPurchasesBySmart(smart: string): Promise<Movement[]> {
    const res = await this.inventoryPool.query<MovementRow>(
      `SELECT * FROM inventory.movements WHERE smart = $1 AND reason = 'purchase' ORDER BY created_at DESC`,
      [smart]
    );
    return res.rows.map((r) => this.enrichMovement(this.mapMovementRow(r)));
  }

  async getSalesBySmart(smart: string): Promise<Movement[]> {
    const res = await this.inventoryPool.query<MovementRow>(
      `SELECT * FROM inventory.movements WHERE smart = $1 AND reason = 'sale' ORDER BY created_at DESC`,
      [smart]
    );
    return res.rows.map((r) => this.enrichMovement(this.mapMovementRow(r)));
  }

  async updateMovement(
    id: number,
    updates: Partial<Pick<Movement, "purchasePrice" | "note" | "qtyDelta" | "boxNumber">>
  ): Promise<Movement> {
    if (
      updates.purchasePrice === undefined &&
      updates.note === undefined &&
      updates.qtyDelta === undefined &&
      updates.boxNumber === undefined
    ) {
      throw new Error("No fields to update");
    }

    const client = await this.inventoryPool.connect();
    try {
      // qty_delta changes can affect stock totals; validate within a SERIALIZABLE transaction.
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      try {
        const existingRes = await client.query<Pick<MovementRow, "id" | "smart" | "qty_delta" | "reason">>(
          `SELECT id, smart, qty_delta, reason FROM inventory.movements WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (existingRes.rows.length === 0) throw new Error("Movement not found");

        const existing = existingRes.rows[0];
        if (existing.reason !== "purchase") {
          throw new InvalidRequestError("Редактирование доступно только для покупок");
        }

        const setClauses: string[] = [];
        const values: any[] = [];
        let param = 1;

        if (updates.purchasePrice !== undefined) {
          if (updates.purchasePrice === null) {
            throw new InvalidRequestError("Цена закупки обязательна");
          }
          const price = requireNumberString(updates.purchasePrice, "Цена закупки");
          setClauses.push(`purchase_price = $${param++}`);
          values.push(price);
        }
        if (updates.note !== undefined) {
          setClauses.push(`note = $${param++}`);
          values.push(updates.note);
        }
        if (updates.boxNumber !== undefined) {
          if (updates.boxNumber === null) {
            throw new InvalidRequestError("Номер коробки обязателен");
          }
          const box = requireNonEmpty(updates.boxNumber, "Номер коробки");
          setClauses.push(`box_number = $${param++}`);
          values.push(box);
        }

        if (updates.qtyDelta !== undefined) {
          const oldQtyDelta = toInt(existing.qty_delta);
          const absQty = Math.abs(updates.qtyDelta);

          const nextQtyDelta = absQty;

          const currentStock = await this.getCurrentStockTx(client, existing.smart);
          const nextStock = currentStock - oldQtyDelta + nextQtyDelta;
          if (nextStock < 0) {
            throw new InsufficientStockError(existing.smart, currentStock, currentStock - nextStock);
          }

          setClauses.push(`qty_delta = $${param++}`);
          values.push(nextQtyDelta);
        }

        if (setClauses.length === 0) throw new Error("No fields to update");

        values.push(id);
        const updateRes = await client.query<MovementRow>(
          `UPDATE inventory.movements SET ${setClauses.join(", ")} WHERE id = $${param} RETURNING *`,
          values
        );
        if (updateRes.rows.length === 0) throw new Error("Movement not found");

        await client.query("COMMIT");
        return this.enrichMovement(this.mapMovementRow(updateRes.rows[0]));
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async updateMovementSaleStatus(id: number, status: "awaiting_shipment" | "shipped"): Promise<Movement> {
    const existing = await this.inventoryPool.query<{ reason: string }>(`SELECT reason FROM inventory.movements WHERE id = $1`, [id]);
    if (existing.rows.length === 0) throw new Error("Movement not found");
    if (existing.rows[0].reason !== "sale") {
      throw new InvalidRequestError("Можно менять статус только у продаж");
    }

    const res = await this.inventoryPool.query<MovementRow>(
      `UPDATE inventory.movements SET sale_status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (res.rows.length === 0) throw new Error("Movement not found");
    return this.enrichMovement(this.mapMovementRow(res.rows[0]));
  }

  async getStockLevels(): Promise<StockLevel[]> {
    const res = await this.inventoryPool.query<{ smart: string; total_qty: unknown }>(`
      SELECT smart, total_qty
      FROM inventory.stock
      ORDER BY smart
    `);

    return res.rows.map((row) => {
      const smartInfo = this.smartCache.getBySmart(row.smart);
      return {
        smart: row.smart,
        totalQty: toInt(row.total_qty),
        name: smartInfo?.name ?? null,
        brand: smartInfo?.brand ?? null,
        description: smartInfo?.description ?? null,
        articles: smartInfo?.articles,
      };
    });
  }

  async getStockBySmart(smart: string): Promise<{ smart: string; totalQty: number; existed: boolean } & Omit<StockLevel, "totalQty">> {
    const res = await this.inventoryPool.query<{ movements_count: string; total_qty: unknown }>(
      `
      SELECT
        COUNT(*)::text as movements_count,
        COALESCE(SUM(qty_delta), 0) as total_qty
      FROM inventory.movements
      WHERE smart = $1
    `,
      [smart]
    );

    const existed = Number(res.rows[0]?.movements_count || 0) > 0;
    if (!existed) {
      return {
        smart,
        totalQty: 0,
        existed: false,
        name: null,
        brand: null,
        description: null,
        articles: [],
      };
    }

    const smartInfo = this.smartCache.getBySmart(smart);
    return {
      smart,
      totalQty: toInt(res.rows[0]?.total_qty),
      existed: true,
      name: smartInfo?.name ?? null,
      brand: smartInfo?.brand ?? null,
      description: smartInfo?.description ?? null,
      articles: smartInfo?.articles ?? [],
    };
  }

  async getTotalStockBySmartBatch(smartCodes: string[]): Promise<Map<string, number>> {
    if (!smartCodes || smartCodes.length === 0) return new Map();

    const res = await this.inventoryPool.query<{ smart: string; total_qty: unknown }>(
      `SELECT smart, total_qty FROM inventory.stock WHERE smart = ANY($1)`,
      [smartCodes]
    );

    const map = new Map<string, number>();
    for (const row of res.rows) {
      map.set(row.smart, toInt(row.total_qty));
    }
    for (const code of smartCodes) {
      if (!map.has(code)) map.set(code, 0);
    }
    return map;
  }

  getReasons(): Reason[] {
    return REASONS;
  }

  async getShippingMethods(): Promise<ShippingMethod[]> {
    const res = await this.inventoryPool.query<{ id: number; name: string; is_pickup: boolean; created_at: Date | string }>(
      `SELECT id, name, is_pickup, created_at FROM inventory.shipping_methods ORDER BY is_pickup DESC, name`
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      isPickup: Boolean(r.is_pickup),
      createdAt: toDateIso(r.created_at),
    }));
  }

  async createShippingMethod(method: Pick<ShippingMethod, "name"> & { isPickup?: boolean }): Promise<ShippingMethod> {
    const name = requireNonEmpty(method.name, "Название");
    const res = await this.inventoryPool.query<{ id: number; name: string; is_pickup: boolean; created_at: Date | string }>(
      `INSERT INTO inventory.shipping_methods (name, is_pickup) VALUES ($1, $2) RETURNING *`,
      [name, Boolean(method.isPickup)]
    );
    const row = res.rows[0];
    return { id: row.id, name: row.name, isPickup: Boolean(row.is_pickup), createdAt: toDateIso(row.created_at) };
  }

  async deleteShippingMethod(id: number): Promise<void> {
    const usage = await this.inventoryPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM inventory.movements WHERE shipping_method_id = $1`,
      [id],
    );
    const ordersUsage = await this.inventoryPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM inventory.shipments WHERE shipping_method_id = $1`,
      [id],
    );
    const returnsUsage = await this.inventoryPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM inventory.returns WHERE shipping_method_id = $1`,
      [id],
    );
    const count =
      Number(usage.rows[0]?.count || 0) + Number(ordersUsage.rows[0]?.count || 0) + Number(returnsUsage.rows[0]?.count || 0);
    if (count > 0) {
      throw new InvalidRequestError(
        `Невозможно удалить: способ доставки используется в ${count} операциях`,
      );
    }
    await this.inventoryPool.query(`DELETE FROM inventory.shipping_methods WHERE id = $1`, [id]);
  }

  async getSoldOutItems(): Promise<SoldOutItem[]> {
    const res = await this.inventoryPool.query<{
      smart: string;
      avg_sale_price: string | null;
      last_sale_date: Date | string;
      total_sales: string;
    }>(`
      WITH sales_summary AS (
        SELECT
          smart,
          AVG(CAST(sale_price AS NUMERIC)) as avg_sale_price,
          MAX(created_at) as last_sale_date,
          SUM(ABS(qty_delta))::text as total_sales
        FROM inventory.movements
        WHERE reason = 'sale'
        GROUP BY smart
      ),
      stock_summary AS (
        SELECT smart, SUM(qty_delta) as current_stock
        FROM inventory.movements
        GROUP BY smart
      )
      SELECT
        s.smart,
        s.avg_sale_price,
        s.last_sale_date,
        s.total_sales
      FROM sales_summary s
      JOIN stock_summary st ON st.smart = s.smart
      WHERE st.current_stock = 0
      ORDER BY s.last_sale_date DESC
    `);

    return res.rows.map((row) => {
      const smartInfo = this.smartCache.getBySmart(row.smart);
      return {
        smart: row.smart,
        name: smartInfo?.name ?? null,
        avgSalePrice: Number(row.avg_sale_price || 0),
        lastSaleDate: toDateIso(row.last_sale_date),
        totalSales: toInt(row.total_sales),
      };
    });
  }

  async getTopParts(mode: "profit" | "sales" | "combined"): Promise<TopPart[]> {
    const [avgPurchaseRes, stockRes, legacySalesRes, orderItemsRes, shipmentCostRes, returnCostRes] = await Promise.all([
      this.inventoryPool.query<{ smart: string; avg_purchase_price: string }>(`
        SELECT
          smart,
          (SUM(CAST(purchase_price AS NUMERIC) * qty_delta) / NULLIF(SUM(qty_delta), 0))::text as avg_purchase_price
        FROM inventory.movements
        WHERE reason = 'purchase' AND purchase_price IS NOT NULL AND qty_delta > 0
        GROUP BY smart
      `),
      this.inventoryPool.query<{ smart: string; current_stock: unknown }>(`
        SELECT smart, COALESCE(SUM(qty_delta), 0) as current_stock
        FROM inventory.movements
        GROUP BY smart
      `),
      this.inventoryPool.query<{
        smart: string;
        qty_delta: number;
        sale_price: string | null;
        delivery_price: string | null;
      }>(`
        SELECT smart, qty_delta, sale_price, delivery_price
        FROM inventory.movements
        WHERE reason = 'sale' AND order_id IS NULL
      `),
      this.inventoryPool.query<{
        id: number;
        smart: string;
        qty: number;
        sale_price: string;
        returned_qty: string;
      }>(`
        SELECT
          oi.id,
          oi.smart,
          oi.qty,
          oi.sale_price::text as sale_price,
          COALESCE(ri.returned_qty, 0)::text as returned_qty
        FROM inventory.order_items oi
        LEFT JOIN (
          SELECT order_item_id, SUM(qty) as returned_qty
          FROM inventory.return_items
          GROUP BY order_item_id
        ) ri ON ri.order_item_id = oi.id
      `),
      this.inventoryPool.query<{
        shipment_id: number;
        smart: string;
        qty: number;
        sale_price: string;
        delivery_price: string;
      }>(`
        SELECT
          s.id as shipment_id,
          oi.smart,
          si.qty,
          oi.sale_price::text as sale_price,
          s.delivery_price::text as delivery_price
        FROM inventory.shipments s
        JOIN inventory.shipment_items si ON si.shipment_id = s.id
        JOIN inventory.order_items oi ON oi.id = si.order_item_id
        WHERE s.delivery_payer = 'seller'
      `),
      this.inventoryPool.query<{
        return_id: number;
        smart: string;
        qty: number;
        sale_price: string;
        return_price: string;
      }>(`
        SELECT
          r.id as return_id,
          oi.smart,
          ri.qty,
          oi.sale_price::text as sale_price,
          r.return_price::text as return_price
        FROM inventory.returns r
        JOIN inventory.return_items ri ON ri.return_id = r.id
        JOIN inventory.order_items oi ON oi.id = ri.order_item_id
        WHERE r.return_payer = 'seller'
      `),
    ]);

    const avgPurchaseBySmart = new Map<string, number>(
      avgPurchaseRes.rows.map((r) => [r.smart, toFloat(r.avg_purchase_price)])
    );
    const currentStockBySmart = new Map<string, number>(
      stockRes.rows.map((r) => [r.smart, toInt(r.current_stock)])
    );

    type ProfitAcc = {
      revenue: number;
      cost: number;
      deliveryCost: number;
      totalSalesQty: number;
    };

    const accBySmart = new Map<string, ProfitAcc>();
    const ensureAcc = (smart: string): ProfitAcc => {
      const found = accBySmart.get(smart);
      if (found) return found;
      const next: ProfitAcc = { revenue: 0, cost: 0, deliveryCost: 0, totalSalesQty: 0 };
      accBySmart.set(smart, next);
      return next;
    };

    for (const sale of legacySalesRes.rows) {
      const smart = sale.smart;
      const qty = Math.abs(toInt(sale.qty_delta));
      if (qty <= 0) continue;
      const salePrice = toFloat(sale.sale_price);
      const deliveryPrice = toFloat(sale.delivery_price);
      const avgPurchase = avgPurchaseBySmart.get(smart) ?? 0;
      const acc = ensureAcc(smart);
      acc.revenue += salePrice * qty;
      acc.cost += avgPurchase * qty;
      acc.deliveryCost += deliveryPrice;
      acc.totalSalesQty += qty;
    }

    for (const row of orderItemsRes.rows) {
      const qty = toInt(row.qty);
      const returnedQty = Math.max(0, toInt(row.returned_qty));
      const netQty = Math.max(0, qty - returnedQty);
      if (netQty <= 0) continue;
      const smart = row.smart;
      const salePrice = toFloat(row.sale_price);
      const avgPurchase = avgPurchaseBySmart.get(smart) ?? 0;
      const acc = ensureAcc(smart);
      acc.revenue += salePrice * netQty;
      acc.cost += avgPurchase * netQty;
      acc.totalSalesQty += netQty;
    }

    const shipmentRowsByShipment = new Map<number, Array<{ smart: string; value: number; deliveryPrice: number }>>();
    for (const row of shipmentCostRes.rows) {
      const shipmentId = row.shipment_id;
      const value = toFloat(row.sale_price) * toInt(row.qty);
      if (value <= 0) continue;
      const group = shipmentRowsByShipment.get(shipmentId) ?? [];
      group.push({ smart: row.smart, value, deliveryPrice: toFloat(row.delivery_price) });
      shipmentRowsByShipment.set(shipmentId, group);
    }

    for (const rows of Array.from(shipmentRowsByShipment.values())) {
      const totalValue = rows.reduce((sum: number, r) => sum + r.value, 0);
      const deliveryPrice = rows[0]?.deliveryPrice ?? 0;
      if (totalValue <= 0 || deliveryPrice <= 0) continue;
      for (const row of rows) {
        const share = deliveryPrice * (row.value / totalValue);
        ensureAcc(row.smart).deliveryCost += share;
      }
    }

    const returnRowsByReturn = new Map<number, Array<{ smart: string; value: number; returnPrice: number }>>();
    for (const row of returnCostRes.rows) {
      const returnId = row.return_id;
      const value = toFloat(row.sale_price) * toInt(row.qty);
      if (value <= 0) continue;
      const group = returnRowsByReturn.get(returnId) ?? [];
      group.push({ smart: row.smart, value, returnPrice: toFloat(row.return_price) });
      returnRowsByReturn.set(returnId, group);
    }

    for (const rows of Array.from(returnRowsByReturn.values())) {
      const totalValue = rows.reduce((sum: number, r) => sum + r.value, 0);
      const returnPrice = rows[0]?.returnPrice ?? 0;
      if (totalValue <= 0 || returnPrice <= 0) continue;
      for (const row of rows) {
        const share = returnPrice * (row.value / totalValue);
        ensureAcc(row.smart).deliveryCost += share;
      }
    }

    const items = Array.from(accBySmart.entries())
      .filter(([, acc]) => acc.totalSalesQty > 0)
      .map(([smart, acc]) => {
        const totalProfit = acc.revenue - acc.cost - acc.deliveryCost;
        const avgProfit = totalProfit / acc.totalSalesQty;
        const avgPurchase = avgPurchaseBySmart.get(smart) ?? 0;
        const profitMargin = avgPurchase > 0 ? (avgProfit / avgPurchase) * 100 : 0;
        const totalSales = acc.totalSalesQty;
        const currentStock = currentStockBySmart.get(smart) ?? 0;

        const normalizedSales = Math.min(totalSales / 10, 100);
        const normalizedProfit = Math.min(Math.max(avgProfit, 0) / 10, 100);
        const combinedScore = normalizedSales * 0.5 + normalizedProfit * 0.5;

        const smartInfo = this.smartCache.getBySmart(smart);
        return {
          smart,
          name: smartInfo?.name ?? null,
          avgProfit,
          totalSales,
          profitMargin,
          currentStock,
          combinedScore,
        } satisfies TopPart;
      });

    let sorted: TopPart[];
    if (mode === "profit") sorted = [...items].sort((a, b) => b.avgProfit - a.avgProfit);
    else if (mode === "sales") sorted = [...items].sort((a, b) => b.totalSales - a.totalSales);
    else sorted = [...items].sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

    return sorted;
  }

  private mapCustomerRow(row: {
    id: number;
    name: string;
    phone: string | null;
    note: string | null;
    archived_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }): Customer {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      note: row.note,
      archivedAt: row.archived_at ? toDateIso(row.archived_at) : null,
      createdAt: toDateIso(row.created_at),
      updatedAt: toDateIso(row.updated_at),
    };
  }

  private mapShipmentStatusToSaleStatus(status: ShipmentStatus): "awaiting_shipment" | "shipped" {
    return status === "pending" ? "awaiting_shipment" : "shipped";
  }

  private async getAvgPurchasePriceBySmartCodes(smartCodes: string[]): Promise<Map<string, number>> {
    if (smartCodes.length === 0) return new Map();
    const uniq = Array.from(new Set(smartCodes.filter((s) => typeof s === "string" && s.trim()))).map((s) => s.trim());
    if (uniq.length === 0) return new Map();

    const res = await this.inventoryPool.query<{ smart: string; avg_purchase_price: string }>(
      `
      SELECT
        smart,
        (SUM(CAST(purchase_price AS NUMERIC) * qty_delta) / NULLIF(SUM(qty_delta), 0))::text as avg_purchase_price
      FROM inventory.movements
      WHERE reason = 'purchase'
        AND purchase_price IS NOT NULL
        AND qty_delta > 0
        AND smart = ANY($1)
      GROUP BY smart
    `,
      [uniq]
    );

    return new Map(res.rows.map((r) => [r.smart, toFloat(r.avg_purchase_price)]));
  }

  async getCustomers(search?: string, includeArchived = false): Promise<Customer[]> {
    const q = typeof search === "string" ? search.trim() : "";
    const hasQuery = q.length > 0;
    const like = `%${q.toLowerCase()}%`;

    const res = await this.inventoryPool.query<{
      id: number;
      name: string;
      phone: string | null;
      note: string | null;
      archived_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `
      SELECT id, name, phone, note, archived_at, created_at, updated_at
      FROM inventory.customers
      WHERE ($1::boolean OR archived_at IS NULL)
        AND (
          NOT $2::boolean
          OR LOWER(name) LIKE $3
          OR LOWER(COALESCE(phone, '')) LIKE $3
        )
      ORDER BY archived_at IS NOT NULL, name ASC
    `,
      [includeArchived, hasQuery, like]
    );

    return res.rows.map((row) => this.mapCustomerRow(row));
  }

  async getCustomerById(id: number): Promise<Customer | undefined> {
    const res = await this.inventoryPool.query<{
      id: number;
      name: string;
      phone: string | null;
      note: string | null;
      archived_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `
      SELECT id, name, phone, note, archived_at, created_at, updated_at
      FROM inventory.customers
      WHERE id = $1
    `,
      [id]
    );
    if (res.rows.length === 0) return undefined;
    return this.mapCustomerRow(res.rows[0]);
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const name = requireNonEmpty(input.name, "Имя клиента");
    const phone = input.phone?.trim() ? input.phone.trim() : null;
    const note = input.note?.trim() ? input.note.trim() : null;

    const res = await this.inventoryPool.query<{
      id: number;
      name: string;
      phone: string | null;
      note: string | null;
      archived_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `
      INSERT INTO inventory.customers (name, phone, note, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id, name, phone, note, archived_at, created_at, updated_at
    `,
      [name, phone, note]
    );

    return this.mapCustomerRow(res.rows[0]);
  }

  async updateCustomer(id: number, input: UpdateCustomerInput): Promise<Customer> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (input.name !== undefined) {
      setClauses.push(`name = $${i++}`);
      values.push(requireNonEmpty(input.name, "Имя клиента"));
    }
    if (input.phone !== undefined) {
      setClauses.push(`phone = $${i++}`);
      values.push(input.phone?.trim() ? input.phone.trim() : null);
    }
    if (input.note !== undefined) {
      setClauses.push(`note = $${i++}`);
      values.push(input.note?.trim() ? input.note.trim() : null);
    }
    if (input.archived !== undefined) {
      if (input.archived) {
        setClauses.push(`archived_at = COALESCE(archived_at, NOW())`);
      } else {
        setClauses.push(`archived_at = NULL`);
      }
    }

    if (setClauses.length === 0) {
      throw new InvalidRequestError("Нет полей для обновления");
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await this.inventoryPool.query<{
      id: number;
      name: string;
      phone: string | null;
      note: string | null;
      archived_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `
      UPDATE inventory.customers
      SET ${setClauses.join(", ")}
      WHERE id = $${i}
      RETURNING id, name, phone, note, archived_at, created_at, updated_at
    `,
      values
    );

    if (res.rows.length === 0) {
      throw new Error("Customer not found");
    }
    return this.mapCustomerRow(res.rows[0]);
  }

  async createOrder(input: CreateOrderInput): Promise<OrderDetails> {
    const note = input.note?.trim() ? input.note.trim() : null;
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new InvalidRequestError("Добавьте хотя бы одну позицию");
    }

    const normalizedItems = input.items.map((item) => ({
      smart: requireNonEmpty(item.smart, "SMART код"),
      qty: toInt(item.qty),
      salePrice: requireNonNegativeNumberString(item.salePrice, "Цена продажи"),
    }));
    for (const item of normalizedItems) {
      if (item.qty <= 0) {
        throw new InvalidRequestError("Количество в позиции должно быть положительным");
      }
      if (!this.smartCache.getBySmart(item.smart)) {
        throw new InvalidRequestError(`SMART код не найден в справочнике: ${item.smart}`);
      }
    }

    const dedupeSmart = new Set<string>();
    for (const item of normalizedItems) {
      if (dedupeSmart.has(item.smart)) {
        throw new InvalidRequestError(`SMART ${item.smart} дублируется в заказе. Объедините в одну позицию.`);
      }
      dedupeSmart.add(item.smart);
    }

    const shippingMethodId = toInt(input.shipment.shippingMethodId);
    if (shippingMethodId <= 0) {
      throw new InvalidRequestError("Способ доставки обязателен");
    }
    const trackNumber = input.shipment.trackNumber?.trim() ? input.shipment.trackNumber.trim() : null;
    const deliveryPrice = requireNonNegativeNumberString(input.shipment.deliveryPrice, "Стоимость доставки");
    const deliveryPriceNum = toFloat(deliveryPrice);

    const client = await this.inventoryPool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      try {
        let customerId: number;
        if (input.customerId) {
          const customerRes = await client.query<{ id: number }>(
            `SELECT id FROM inventory.customers WHERE id = $1`,
            [input.customerId]
          );
          if (customerRes.rows.length === 0) {
            throw new InvalidRequestError("Клиент не найден");
          }
          customerId = customerRes.rows[0].id;
        } else if (input.customer) {
          const createdCustomer = await client.query<{ id: number }>(
            `
            INSERT INTO inventory.customers (name, phone, note, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING id
          `,
            [
              requireNonEmpty(input.customer.name, "Имя клиента"),
              input.customer.phone?.trim() ? input.customer.phone.trim() : null,
              input.customer.note?.trim() ? input.customer.note.trim() : null,
            ]
          );
          customerId = createdCustomer.rows[0].id;
        } else {
          throw new InvalidRequestError("Нужно выбрать клиента или создать нового");
        }

        const shippingMethodRes = await client.query<{ id: number; is_pickup: boolean }>(
          `SELECT id, is_pickup FROM inventory.shipping_methods WHERE id = $1`,
          [shippingMethodId]
        );
        if (shippingMethodRes.rows.length === 0) {
          throw new InvalidRequestError("Способ доставки не найден");
        }
        const isPickup = Boolean(shippingMethodRes.rows[0].is_pickup);

        let deliveryPayer: DeliveryPayer | null = input.shipment.deliveryPayer ?? null;
        if (isPickup && deliveryPriceNum === 0) {
          deliveryPayer = null;
        }
        if (deliveryPriceNum > 0 && !deliveryPayer) {
          throw new InvalidRequestError("Укажите, кто платит за доставку");
        }

        const shipmentStatus: ShipmentStatus = isPickup ? "delivered" : "pending";
        const movementSaleStatus = this.mapShipmentStatusToSaleStatus(shipmentStatus);

        for (const item of normalizedItems) {
          const currentStock = await this.getCurrentStockTx(client, item.smart);
          if (currentStock < item.qty) {
            throw new InsufficientStockError(item.smart, currentStock, item.qty);
          }
        }

        const orderRes = await client.query<{ id: number }>(
          `
          INSERT INTO inventory.orders (customer_id, note, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          RETURNING id
        `,
          [customerId, note]
        );
        const orderId = orderRes.rows[0].id;

        const orderItems: Array<{ id: number; smart: string; qty: number; salePrice: string }> = [];
        for (const item of normalizedItems) {
          const inserted = await client.query<{ id: number }>(
            `
            INSERT INTO inventory.order_items (order_id, smart, qty, sale_price, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id
          `,
            [orderId, item.smart, item.qty, item.salePrice]
          );
          orderItems.push({
            id: inserted.rows[0].id,
            smart: item.smart,
            qty: item.qty,
            salePrice: item.salePrice,
          });
        }

        const shipmentRes = await client.query<{ id: number }>(
          `
          INSERT INTO inventory.shipments (
            order_id, shipping_method_id, track_number, delivery_price, delivery_payer, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING id
        `,
          [orderId, shippingMethodId, trackNumber, deliveryPrice, deliveryPayer, shipmentStatus]
        );
        const shipmentId = shipmentRes.rows[0].id;

        const orderTotalValue = orderItems.reduce((sum, item) => sum + toFloat(item.salePrice) * item.qty, 0);
        const shouldAllocateDelivery = deliveryPayer === "seller" && deliveryPriceNum > 0 && orderTotalValue > 0;

        for (const item of orderItems) {
          await client.query(
            `
            INSERT INTO inventory.shipment_items (shipment_id, order_item_id, qty, created_at)
            VALUES ($1, $2, $3, NOW())
          `,
            [shipmentId, item.id, item.qty]
          );
        }

        for (const item of orderItems) {
          const itemValue = toFloat(item.salePrice) * item.qty;
          const allocatedDelivery = shouldAllocateDelivery ? (deliveryPriceNum * itemValue) / orderTotalValue : 0;
          await client.query(
            `
            INSERT INTO inventory.movements (
              smart, qty_delta, reason, note,
              purchase_price, sale_price, delivery_price,
              box_number, track_number, shipping_method_id, sale_status,
              order_id, order_item_id, shipment_id, return_id,
              created_at
            )
            VALUES ($1,$2,'sale',$3,NULL,$4,$5,NULL,$6,$7,$8,$9,$10,$11,NULL,NOW())
          `,
            [
              item.smart,
              -item.qty,
              note,
              item.salePrice,
              shouldAllocateDelivery ? toNumberString(allocatedDelivery) : null,
              trackNumber,
              shippingMethodId,
              movementSaleStatus,
              orderId,
              item.id,
              shipmentId,
            ]
          );
        }

        await client.query("COMMIT");
        const details = await this.getOrderById(orderId);
        if (!details) {
          throw new Error("Order not found after creation");
        }
        return details;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async getOrders(options?: { customerId?: number; includeArchivedCustomers?: boolean }): Promise<OrderSummary[]> {
    const customerId = options?.customerId ?? null;
    const includeArchived = Boolean(options?.includeArchivedCustomers);

    const res = await this.inventoryPool.query<{
      id: number;
      customer_id: number;
      customer_name: string;
      customer_phone: string | null;
      customer_archived_at: Date | string | null;
      note: string | null;
      created_at: Date | string;
      positions_count: string;
      total_qty: string;
      items_total: string;
      shipments_pending: string;
      shipments_shipped: string;
      shipments_delivered: string;
      returns_count: string;
    }>(
      `
      SELECT
        o.id,
        o.customer_id,
        c.name as customer_name,
        c.phone as customer_phone,
        c.archived_at as customer_archived_at,
        o.note,
        o.created_at,
        (
          SELECT COUNT(*)::text
          FROM inventory.order_items oi
          WHERE oi.order_id = o.id
        ) as positions_count,
        (
          SELECT COALESCE(SUM(oi.qty), 0)::text
          FROM inventory.order_items oi
          WHERE oi.order_id = o.id
        ) as total_qty,
        (
          SELECT COALESCE(SUM(oi.qty * oi.sale_price), 0)::text
          FROM inventory.order_items oi
          WHERE oi.order_id = o.id
        ) as items_total,
        (
          SELECT COUNT(*)::text
          FROM inventory.shipments s
          WHERE s.order_id = o.id AND s.status = 'pending'
        ) as shipments_pending,
        (
          SELECT COUNT(*)::text
          FROM inventory.shipments s
          WHERE s.order_id = o.id AND s.status = 'shipped'
        ) as shipments_shipped,
        (
          SELECT COUNT(*)::text
          FROM inventory.shipments s
          WHERE s.order_id = o.id AND s.status = 'delivered'
        ) as shipments_delivered,
        (
          SELECT COUNT(*)::text
          FROM inventory.returns r
          WHERE r.order_id = o.id
        ) as returns_count
      FROM inventory.orders o
      JOIN inventory.customers c ON c.id = o.customer_id
      WHERE ($1::int IS NULL OR o.customer_id = $1)
        AND ($2::boolean OR c.archived_at IS NULL)
      ORDER BY o.created_at DESC
    `,
      [customerId, includeArchived]
    );

    return res.rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerArchivedAt: row.customer_archived_at ? toDateIso(row.customer_archived_at) : null,
      note: row.note,
      createdAt: toDateIso(row.created_at),
      positionsCount: toInt(row.positions_count),
      totalQty: toInt(row.total_qty),
      itemsTotal: toFloat(row.items_total),
      shipmentsPending: toInt(row.shipments_pending),
      shipmentsShipped: toInt(row.shipments_shipped),
      shipmentsDelivered: toInt(row.shipments_delivered),
      returnsCount: toInt(row.returns_count),
    }));
  }

  async getOrderById(orderId: number): Promise<OrderDetails | undefined> {
    const orderRes = await this.inventoryPool.query<{
      id: number;
      customer_id: number;
      note: string | null;
      created_at: Date | string;
      customer_name: string;
      customer_phone: string | null;
      customer_note: string | null;
      customer_archived_at: Date | string | null;
      customer_created_at: Date | string;
      customer_updated_at: Date | string;
    }>(
      `
      SELECT
        o.id,
        o.customer_id,
        o.note,
        o.created_at,
        c.name as customer_name,
        c.phone as customer_phone,
        c.note as customer_note,
        c.archived_at as customer_archived_at,
        c.created_at as customer_created_at,
        c.updated_at as customer_updated_at
      FROM inventory.orders o
      JOIN inventory.customers c ON c.id = o.customer_id
      WHERE o.id = $1
    `,
      [orderId]
    );
    if (orderRes.rows.length === 0) return undefined;

    const itemsRes = await this.inventoryPool.query<{
      id: number;
      order_id: number;
      smart: string;
      qty: number;
      sale_price: string;
      created_at: Date | string;
      returned_qty: string;
      shipped_qty: string;
    }>(
      `
      SELECT
        oi.id,
        oi.order_id,
        oi.smart,
        oi.qty,
        oi.sale_price::text as sale_price,
        oi.created_at,
        COALESCE(r.returned_qty, 0)::text as returned_qty,
        COALESCE(s.shipped_qty, 0)::text as shipped_qty
      FROM inventory.order_items oi
      LEFT JOIN (
        SELECT order_item_id, SUM(qty) as returned_qty
        FROM inventory.return_items
        GROUP BY order_item_id
      ) r ON r.order_item_id = oi.id
      LEFT JOIN (
        SELECT si.order_item_id, SUM(si.qty) as shipped_qty
        FROM inventory.shipment_items si
        JOIN inventory.shipments s ON s.id = si.shipment_id
        WHERE s.status IN ('shipped', 'delivered')
        GROUP BY si.order_item_id
      ) s ON s.order_item_id = oi.id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `,
      [orderId]
    );

    const shipmentsRes = await this.inventoryPool.query<{
      id: number;
      order_id: number;
      shipping_method_id: number;
      shipping_method_name: string;
      is_pickup: boolean;
      track_number: string | null;
      delivery_price: string;
      delivery_payer: DeliveryPayer | null;
      status: ShipmentStatus;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `
      SELECT
        s.id,
        s.order_id,
        s.shipping_method_id,
        sm.name as shipping_method_name,
        sm.is_pickup,
        s.track_number,
        s.delivery_price::text as delivery_price,
        s.delivery_payer,
        s.status,
        s.created_at,
        s.updated_at
      FROM inventory.shipments s
      JOIN inventory.shipping_methods sm ON sm.id = s.shipping_method_id
      WHERE s.order_id = $1
      ORDER BY s.created_at ASC, s.id ASC
    `,
      [orderId]
    );

    const shipmentIds = shipmentsRes.rows.map((s) => s.id);
    const shipmentItemsRes = shipmentIds.length
      ? await this.inventoryPool.query<{
          id: number;
          shipment_id: number;
          order_item_id: number;
          qty: number;
          created_at: Date | string;
        }>(
          `
          SELECT id, shipment_id, order_item_id, qty, created_at
          FROM inventory.shipment_items
          WHERE shipment_id = ANY($1)
          ORDER BY id ASC
        `,
          [shipmentIds]
        )
      : { rows: [] as Array<{ id: number; shipment_id: number; order_item_id: number; qty: number; created_at: Date | string }> };

    const returnsRes = await this.inventoryPool.query<{
      id: number;
      order_id: number;
      kind: ReturnKind;
      note: string | null;
      return_price: string;
      return_payer: DeliveryPayer | null;
      shipping_method_id: number | null;
      shipping_method_name: string | null;
      track_number: string | null;
      created_at: Date | string;
    }>(
      `
      SELECT
        r.id,
        r.order_id,
        r.kind,
        r.note,
        r.return_price::text as return_price,
        r.return_payer,
        r.shipping_method_id,
        sm.name as shipping_method_name,
        r.track_number,
        r.created_at
      FROM inventory.returns r
      LEFT JOIN inventory.shipping_methods sm ON sm.id = r.shipping_method_id
      WHERE r.order_id = $1
      ORDER BY r.created_at DESC, r.id DESC
    `,
      [orderId]
    );

    const returnIds = returnsRes.rows.map((r) => r.id);
    const returnItemsRes = returnIds.length
      ? await this.inventoryPool.query<{
          id: number;
          return_id: number;
          order_item_id: number;
          qty: number;
          created_at: Date | string;
        }>(
          `
          SELECT id, return_id, order_item_id, qty, created_at
          FROM inventory.return_items
          WHERE return_id = ANY($1)
          ORDER BY id ASC
        `,
          [returnIds]
        )
      : { rows: [] as Array<{ id: number; return_id: number; order_item_id: number; qty: number; created_at: Date | string }> };

    const itemById = new Map<number, OrderItem>();
    for (const row of itemsRes.rows) {
      const smartInfo = this.smartCache.getBySmart(row.smart);
      const item: OrderItem = {
        id: row.id,
        orderId: row.order_id,
        smart: row.smart,
        qty: toInt(row.qty),
        salePrice: toNumberString(row.sale_price),
        returnedQty: toInt(row.returned_qty),
        shippedQty: toInt(row.shipped_qty),
        createdAt: toDateIso(row.created_at),
        articles: smartInfo?.articles,
        name: smartInfo?.name ?? null,
        brand: smartInfo?.brand ?? null,
        description: smartInfo?.description ?? null,
      };
      itemById.set(item.id, item);
    }
    const items = Array.from(itemById.values());

    const shipmentItemsByShipment = new Map<number, ShipmentItem[]>();
    for (const row of shipmentItemsRes.rows) {
      const list = shipmentItemsByShipment.get(row.shipment_id) ?? [];
      list.push({
        id: row.id,
        shipmentId: row.shipment_id,
        orderItemId: row.order_item_id,
        qty: toInt(row.qty),
        createdAt: toDateIso(row.created_at),
      });
      shipmentItemsByShipment.set(row.shipment_id, list);
    }

    const shipments: OrderShipment[] = shipmentsRes.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      shippingMethodId: row.shipping_method_id,
      shippingMethodName: row.shipping_method_name,
      isPickup: Boolean(row.is_pickup),
      trackNumber: row.track_number,
      deliveryPrice: toNumberString(row.delivery_price),
      deliveryPayer: row.delivery_payer,
      status: row.status,
      createdAt: toDateIso(row.created_at),
      updatedAt: toDateIso(row.updated_at),
      items: shipmentItemsByShipment.get(row.id) ?? [],
    }));

    const returnItemsByReturn = new Map<number, ReturnItem[]>();
    for (const row of returnItemsRes.rows) {
      const list = returnItemsByReturn.get(row.return_id) ?? [];
      list.push({
        id: row.id,
        returnId: row.return_id,
        orderItemId: row.order_item_id,
        qty: toInt(row.qty),
        createdAt: toDateIso(row.created_at),
      });
      returnItemsByReturn.set(row.return_id, list);
    }

    const returns: OrderReturn[] = returnsRes.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      kind: row.kind,
      note: row.note,
      returnPrice: toNumberString(row.return_price),
      returnPayer: row.return_payer,
      shippingMethodId: row.shipping_method_id,
      shippingMethodName: row.shipping_method_name,
      trackNumber: row.track_number,
      createdAt: toDateIso(row.created_at),
      items: returnItemsByReturn.get(row.id) ?? [],
    }));

    const avgPurchaseMap = await this.getAvgPurchasePriceBySmartCodes(items.map((i) => i.smart));

    const financial: OrderFinancialSummary = {
      revenue: 0,
      cost: 0,
      deliveryCost: 0,
      returnCost: 0,
      profit: 0,
    };

    for (const item of items) {
      const netQty = Math.max(0, item.qty - item.returnedQty);
      const salePrice = toFloat(item.salePrice);
      const avgPurchase = avgPurchaseMap.get(item.smart) ?? 0;
      financial.revenue += salePrice * netQty;
      financial.cost += avgPurchase * netQty;
    }

    for (const shipment of shipments) {
      if (shipment.deliveryPayer === "seller") {
        financial.deliveryCost += toFloat(shipment.deliveryPrice);
      }
    }
    for (const ret of returns) {
      if (ret.returnPayer === "seller") {
        const value = toFloat(ret.returnPrice);
        financial.deliveryCost += value;
        financial.returnCost += value;
      }
    }

    financial.profit = financial.revenue - financial.cost - financial.deliveryCost;
    financial.revenue = Number(financial.revenue.toFixed(2));
    financial.cost = Number(financial.cost.toFixed(2));
    financial.deliveryCost = Number(financial.deliveryCost.toFixed(2));
    financial.returnCost = Number(financial.returnCost.toFixed(2));
    financial.profit = Number(financial.profit.toFixed(2));

    const base = orderRes.rows[0];
    return {
      id: base.id,
      customer: {
        id: base.customer_id,
        name: base.customer_name,
        phone: base.customer_phone,
        note: base.customer_note,
        archivedAt: base.customer_archived_at ? toDateIso(base.customer_archived_at) : null,
        createdAt: toDateIso(base.customer_created_at),
        updatedAt: toDateIso(base.customer_updated_at),
      },
      note: base.note,
      createdAt: toDateIso(base.created_at),
      items,
      shipments,
      returns,
      financial,
    };
  }

  async updateShipmentStatus(shipmentId: number, status: ShipmentStatus): Promise<OrderShipment> {
    const res = await this.inventoryPool.query<{
      id: number;
      order_id: number;
      shipping_method_id: number;
      shipping_method_name: string;
      is_pickup: boolean;
      track_number: string | null;
      delivery_price: string;
      delivery_payer: DeliveryPayer | null;
      status: ShipmentStatus;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `
      UPDATE inventory.shipments s
      SET status = $1, updated_at = NOW()
      FROM inventory.shipping_methods sm
      WHERE s.shipping_method_id = sm.id
        AND s.id = $2
      RETURNING
        s.id,
        s.order_id,
        s.shipping_method_id,
        sm.name as shipping_method_name,
        sm.is_pickup,
        s.track_number,
        s.delivery_price::text as delivery_price,
        s.delivery_payer,
        s.status,
        s.created_at,
        s.updated_at
    `,
      [status, shipmentId]
    );

    if (res.rows.length === 0) {
      throw new Error("Shipment not found");
    }

    const itemRes = await this.inventoryPool.query<{ order_item_id: number; qty: number; id: number; created_at: Date | string }>(
      `
      SELECT id, order_item_id, qty, created_at
      FROM inventory.shipment_items
      WHERE shipment_id = $1
      ORDER BY id
    `,
      [shipmentId]
    );

    await this.inventoryPool.query(
      `
      UPDATE inventory.movements
      SET sale_status = $1,
          shipment_id = $2
      WHERE reason = 'sale'
        AND order_item_id = ANY(
          SELECT order_item_id
          FROM inventory.shipment_items
          WHERE shipment_id = $2
        )
    `,
      [this.mapShipmentStatusToSaleStatus(status), shipmentId]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      orderId: row.order_id,
      shippingMethodId: row.shipping_method_id,
      shippingMethodName: row.shipping_method_name,
      isPickup: Boolean(row.is_pickup),
      trackNumber: row.track_number,
      deliveryPrice: toNumberString(row.delivery_price),
      deliveryPayer: row.delivery_payer,
      status: row.status,
      createdAt: toDateIso(row.created_at),
      updatedAt: toDateIso(row.updated_at),
      items: itemRes.rows.map((item) => ({
        id: item.id,
        shipmentId,
        orderItemId: item.order_item_id,
        qty: toInt(item.qty),
        createdAt: toDateIso(item.created_at),
      })),
    };
  }

  async createOrderReturn(orderId: number, input: CreateOrderReturnInput): Promise<OrderReturn> {
    const returnPrice = requireNonNegativeNumberString(input.returnPrice, "Стоимость обратной доставки");
    const returnPriceNum = toFloat(returnPrice);
    const kind: ReturnKind = input.kind ?? "return";
    const note = input.note?.trim() ? input.note.trim() : null;
    const trackNumber = input.trackNumber?.trim() ? input.trackNumber.trim() : null;
    const returnPayer: DeliveryPayer | null = input.returnPayer ?? null;
    const shippingMethodId = input.shippingMethodId ? toInt(input.shippingMethodId) : null;

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new InvalidRequestError("Добавьте хотя бы одну позицию для возврата");
    }
    if (returnPriceNum > 0 && !returnPayer) {
      throw new InvalidRequestError("Укажите, кто платит за обратную доставку");
    }

    const client = await this.inventoryPool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      try {
        const orderRes = await client.query<{ id: number }>(`SELECT id FROM inventory.orders WHERE id = $1`, [orderId]);
        if (orderRes.rows.length === 0) {
          throw new InvalidRequestError("Заказ не найден");
        }

        if (shippingMethodId) {
          const methodRes = await client.query<{ id: number }>(
            `SELECT id FROM inventory.shipping_methods WHERE id = $1`,
            [shippingMethodId]
          );
          if (methodRes.rows.length === 0) {
            throw new InvalidRequestError("Способ доставки возврата не найден");
          }
        }

        const orderItemsRes = await client.query<{ id: number; smart: string; qty: number }>(
          `
          SELECT id, smart, qty
          FROM inventory.order_items
          WHERE order_id = $1
        `,
          [orderId]
        );
        const itemById = new Map(orderItemsRes.rows.map((row) => [row.id, row]));

        const returnedQtyRes = await client.query<{ order_item_id: number; returned_qty: string }>(
          `
          SELECT order_item_id, SUM(qty)::text as returned_qty
          FROM inventory.return_items ri
          JOIN inventory.returns r ON r.id = ri.return_id
          WHERE r.order_id = $1
          GROUP BY order_item_id
        `,
          [orderId]
        );
        const alreadyReturnedMap = new Map(returnedQtyRes.rows.map((row) => [row.order_item_id, toInt(row.returned_qty)]));

        for (const item of input.items) {
          const orderItemId = toInt(item.orderItemId);
          const qty = toInt(item.qty);
          if (qty <= 0) {
            throw new InvalidRequestError("Количество возврата должно быть положительным");
          }
          const orderItem = itemById.get(orderItemId);
          if (!orderItem) {
            throw new InvalidRequestError(`Позиция заказа #${orderItemId} не найдена`);
          }
          const alreadyReturned = alreadyReturnedMap.get(orderItemId) ?? 0;
          if (alreadyReturned + qty > toInt(orderItem.qty)) {
            throw new InvalidRequestError(
              `Превышено допустимое количество возврата для ${orderItem.smart}: можно вернуть максимум ${
                toInt(orderItem.qty) - alreadyReturned
              }`
            );
          }
        }

        const returnRes = await client.query<{ id: number }>(
          `
          INSERT INTO inventory.returns (
            order_id, kind, note, return_price, return_payer, shipping_method_id, track_number, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING id
        `,
          [orderId, kind, note, returnPrice, returnPayer, shippingMethodId, trackNumber]
        );
        const returnId = returnRes.rows[0].id;

        for (const item of input.items) {
          const orderItemId = toInt(item.orderItemId);
          const qty = toInt(item.qty);
          const orderItem = itemById.get(orderItemId)!;

          await client.query(
            `
            INSERT INTO inventory.return_items (return_id, order_item_id, qty, created_at)
            VALUES ($1, $2, $3, NOW())
          `,
            [returnId, orderItemId, qty]
          );

          await client.query(
            `
            INSERT INTO inventory.movements (
              smart, qty_delta, reason, note,
              purchase_price, sale_price, delivery_price,
              box_number, track_number, shipping_method_id, sale_status,
              order_id, order_item_id, shipment_id, return_id,
              created_at
            )
            VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $5, $6, NULL, $7, NOW())
          `,
            [
              orderItem.smart,
              qty,
              kind === "correction" ? "adjust" : "return",
              note ??
                (kind === "correction"
                  ? `Корректировка заказа #${orderId}, позиция #${orderItemId}`
                  : `Возврат заказа #${orderId}, позиция #${orderItemId}`),
              orderId,
              orderItemId,
              returnId,
            ]
          );
        }

        await client.query("COMMIT");

        const details = await this.getOrderById(orderId);
        const createdReturn = details?.returns.find((r) => r.id === returnId);
        if (!createdReturn) {
          throw new Error("Return not found after creation");
        }
        return createdReturn;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async getSalesAnalyticsBySmart(smart: string): Promise<{
    sales: Array<{
      id: string;
      source: "legacy" | "order";
      createdAt: string;
      qty: number;
      salePrice: number;
      deliveryPrice: number;
      deliveryPayer: DeliveryPayer | "mixed" | null;
      customerName: string | null;
      orderId: number | null;
      profit: number;
      profitMarginPercent: number;
      daysFromPurchase: number | null;
      purchasePriceUsed: number;
    }>;
    metrics: {
      averageDaysToSell: number;
      soldQuantity: number;
      totalPurchased: number;
      sellThroughRate: number;
      averageProfitPerUnit: number;
      averageProfitMarginPercent: number;
    };
  }> {
    const [purchases, legacySales, orderSales, orderDeliveryRes, returnCostRes] = await Promise.all([
      this.inventoryPool.query<{
        qty_delta: number;
        purchase_price: string | null;
        created_at: Date | string;
      }>(
        `
        SELECT qty_delta, purchase_price, created_at
        FROM inventory.movements
        WHERE smart = $1 AND reason = 'purchase'
        ORDER BY created_at DESC
      `,
        [smart]
      ),
      this.inventoryPool.query<{
        id: number;
        qty_delta: number;
        sale_price: string | null;
        delivery_price: string | null;
        created_at: Date | string;
      }>(
        `
        SELECT id, qty_delta, sale_price, delivery_price, created_at
        FROM inventory.movements
        WHERE smart = $1 AND reason = 'sale' AND order_id IS NULL
        ORDER BY created_at DESC
      `,
        [smart]
      ),
      this.inventoryPool.query<{
        order_item_id: number;
        order_id: number;
        customer_name: string;
        qty: number;
        returned_qty: string;
        sale_price: string;
        created_at: Date | string;
      }>(
        `
        SELECT
          oi.id as order_item_id,
          o.id as order_id,
          c.name as customer_name,
          oi.qty,
          COALESCE(ri.returned_qty, 0)::text as returned_qty,
          oi.sale_price::text as sale_price,
          o.created_at
        FROM inventory.order_items oi
        JOIN inventory.orders o ON o.id = oi.order_id
        JOIN inventory.customers c ON c.id = o.customer_id
        LEFT JOIN (
          SELECT order_item_id, SUM(qty) as returned_qty
          FROM inventory.return_items
          GROUP BY order_item_id
        ) ri ON ri.order_item_id = oi.id
        WHERE oi.smart = $1
        ORDER BY o.created_at DESC, oi.id DESC
      `,
        [smart]
      ),
      this.inventoryPool.query<{
        order_item_id: number;
        delivery_share: string;
        has_seller_delivery: boolean;
        has_buyer_delivery: boolean;
      }>(
        `
        SELECT
          target.order_item_id,
          COALESCE(
            SUM(
              CASE
                WHEN s.delivery_payer = 'seller' AND totals.total_value > 0
                THEN s.delivery_price * (target.item_value / totals.total_value)
                ELSE 0
              END
            ),
            0
          )::text as delivery_share,
          BOOL_OR(s.delivery_payer = 'seller' AND s.delivery_price > 0) as has_seller_delivery,
          BOOL_OR(s.delivery_payer = 'buyer' AND s.delivery_price > 0) as has_buyer_delivery
        FROM (
          SELECT
            oi.id as order_item_id,
            si.shipment_id,
            (oi.sale_price * si.qty)::numeric as item_value
          FROM inventory.order_items oi
          JOIN inventory.shipment_items si ON si.order_item_id = oi.id
          WHERE oi.smart = $1
        ) target
        JOIN inventory.shipments s ON s.id = target.shipment_id
        JOIN (
          SELECT
            si.shipment_id,
            SUM(oi.sale_price * si.qty)::numeric as total_value
          FROM inventory.shipment_items si
          JOIN inventory.order_items oi ON oi.id = si.order_item_id
          GROUP BY si.shipment_id
        ) totals ON totals.shipment_id = target.shipment_id
        GROUP BY target.order_item_id
      `,
        [smart]
      ),
      this.inventoryPool.query<{
        return_id: number;
        order_item_id: number;
        qty: number;
        sale_price: string;
        return_price: string;
      }>(
        `
        SELECT
          r.id as return_id,
          ri.order_item_id,
          ri.qty,
          oi.sale_price::text as sale_price,
          r.return_price::text as return_price
        FROM inventory.returns r
        JOIN inventory.return_items ri ON ri.return_id = r.id
        JOIN inventory.order_items oi ON oi.id = ri.order_item_id
        WHERE oi.smart = $1
          AND r.return_payer = 'seller'
      `,
        [smart]
      ),
    ]);

    const purchaseLines = purchases.rows
      .map((p) => ({ qty: Math.abs(toInt(p.qty_delta)), price: toFloat(p.purchase_price), createdAt: toDateIso(p.created_at) }))
      .filter((p) => p.qty > 0 && Number.isFinite(p.price));
    const totalPurchaseQty = purchaseLines.reduce((sum, p) => sum + p.qty, 0);
    const weightedPurchaseCost = purchaseLines.reduce((sum, p) => sum + p.price * p.qty, 0);
    const avgPurchasePrice = totalPurchaseQty > 0 ? weightedPurchaseCost / totalPurchaseQty : 0;

    const returnRowsByReturn = new Map<number, Array<{ orderItemId: number; value: number; returnPrice: number }>>();
    for (const row of returnCostRes.rows) {
      const list = returnRowsByReturn.get(row.return_id) ?? [];
      list.push({
        orderItemId: row.order_item_id,
        value: toFloat(row.sale_price) * toInt(row.qty),
        returnPrice: toFloat(row.return_price),
      });
      returnRowsByReturn.set(row.return_id, list);
    }

    const returnCostByOrderItem = new Map<number, number>();
    for (const rows of Array.from(returnRowsByReturn.values())) {
      const totalValue = rows.reduce((sum: number, r) => sum + r.value, 0);
      if (totalValue <= 0) continue;
      const returnPrice = rows[0]?.returnPrice ?? 0;
      for (const row of rows) {
        const share = returnPrice * (row.value / totalValue);
        returnCostByOrderItem.set(row.orderItemId, (returnCostByOrderItem.get(row.orderItemId) ?? 0) + share);
      }
    }

    const orderDeliveryByOrderItem = new Map<number, { deliveryShare: number; deliveryPayer: DeliveryPayer | "mixed" | null }>();
    for (const row of orderDeliveryRes.rows) {
      let deliveryPayer: DeliveryPayer | "mixed" | null = null;
      if (row.has_seller_delivery && row.has_buyer_delivery) {
        deliveryPayer = "mixed";
      } else if (row.has_seller_delivery) {
        deliveryPayer = "seller";
      } else if (row.has_buyer_delivery) {
        deliveryPayer = "buyer";
      }
      orderDeliveryByOrderItem.set(row.order_item_id, {
        deliveryShare: toFloat(row.delivery_share),
        deliveryPayer,
      });
    }

    const getDaysFromClosestPurchase = (saleDateIso: string): number | null => {
      const saleTime = new Date(saleDateIso).getTime();
      const closest = purchaseLines
        .filter((p) => new Date(p.createdAt).getTime() <= saleTime)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (!closest) return null;
      return Math.round((saleTime - new Date(closest.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    };

    const sales: Array<{
      id: string;
      source: "legacy" | "order";
      createdAt: string;
      qty: number;
      salePrice: number;
      deliveryPrice: number;
      deliveryPayer: DeliveryPayer | "mixed" | null;
      customerName: string | null;
      orderId: number | null;
      profit: number;
      profitMarginPercent: number;
      daysFromPurchase: number | null;
      purchasePriceUsed: number;
    }> = [];

    for (const row of legacySales.rows) {
      const qty = Math.abs(toInt(row.qty_delta));
      if (qty <= 0) continue;
      const salePrice = toFloat(row.sale_price);
      const deliveryPrice = toFloat(row.delivery_price);
      const gross = (salePrice - avgPurchasePrice) * qty;
      const profit = gross - deliveryPrice;
      const profitPerUnit = qty > 0 ? profit / qty : 0;

      const createdAt = toDateIso(row.created_at);
      sales.push({
        id: `legacy-${row.id}`,
        source: "legacy",
        createdAt,
        qty,
        salePrice,
        deliveryPrice,
        deliveryPayer: deliveryPrice > 0 ? "seller" : null,
        customerName: null,
        orderId: null,
        profit,
        profitMarginPercent: avgPurchasePrice > 0 ? (profitPerUnit / avgPurchasePrice) * 100 : 0,
        daysFromPurchase: getDaysFromClosestPurchase(createdAt),
        purchasePriceUsed: avgPurchasePrice,
      });
    }

    for (const row of orderSales.rows) {
      const qty = toInt(row.qty);
      const returnedQty = Math.max(0, toInt(row.returned_qty));
      const netQty = Math.max(0, qty - returnedQty);

      const salePrice = toFloat(row.sale_price);
      const deliveryInfo = orderDeliveryByOrderItem.get(row.order_item_id);
      const deliveryShare = deliveryInfo?.deliveryShare ?? 0;
      const returnDeliveryShare = returnCostByOrderItem.get(row.order_item_id) ?? 0;
      const deliveryPrice = deliveryShare + returnDeliveryShare;
      if (netQty <= 0 && Math.abs(deliveryPrice) < 0.000001) continue;

      let deliveryPayer: DeliveryPayer | "mixed" | null = deliveryInfo?.deliveryPayer ?? null;
      if (returnDeliveryShare > 0) {
        if (deliveryPayer === "buyer" || deliveryPayer === "mixed") {
          deliveryPayer = "mixed";
        } else {
          deliveryPayer = "seller";
        }
      }

      const gross = (salePrice - avgPurchasePrice) * netQty;
      const profit = gross - deliveryPrice;
      const profitPerUnit = netQty > 0 ? profit / netQty : 0;

      const createdAt = toDateIso(row.created_at);
      sales.push({
        id: `order-item-${row.order_item_id}`,
        source: "order",
        createdAt,
        qty: netQty,
        salePrice,
        deliveryPrice,
        deliveryPayer,
        customerName: row.customer_name,
        orderId: row.order_id,
        profit,
        profitMarginPercent: avgPurchasePrice > 0 ? (profitPerUnit / avgPurchasePrice) * 100 : 0,
        daysFromPurchase: getDaysFromClosestPurchase(createdAt),
        purchasePriceUsed: avgPurchasePrice,
      });
    }

    sales.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const soldQuantity = sales.reduce((sum, s) => sum + s.qty, 0);
    const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0);
    const averageProfitPerUnit = soldQuantity > 0 ? totalProfit / soldQuantity : 0;
    const sellThroughRate = totalPurchaseQty > 0 ? (soldQuantity / totalPurchaseQty) * 100 : 0;
    const salesWithDays = sales.filter((s) => s.daysFromPurchase !== null);
    const averageDaysToSell =
      salesWithDays.length > 0
        ? salesWithDays.reduce((sum, s) => sum + (s.daysFromPurchase ?? 0), 0) / salesWithDays.length
        : 0;
    const averageProfitMarginPercent =
      avgPurchasePrice > 0 ? (averageProfitPerUnit / avgPurchasePrice) * 100 : 0;

    return {
      sales: sales.map((s) => ({
        ...s,
        profit: Number(s.profit.toFixed(2)),
        profitMarginPercent: Number(s.profitMarginPercent.toFixed(1)),
        purchasePriceUsed: Number(s.purchasePriceUsed.toFixed(2)),
        deliveryPrice: Number(s.deliveryPrice.toFixed(2)),
        salePrice: Number(s.salePrice.toFixed(2)),
      })),
      metrics: {
        averageDaysToSell: Number(averageDaysToSell.toFixed(1)),
        soldQuantity,
        totalPurchased: totalPurchaseQty,
        sellThroughRate: Number(sellThroughRate.toFixed(1)),
        averageProfitPerUnit: Number(averageProfitPerUnit.toFixed(2)),
        averageProfitMarginPercent: Number(averageProfitMarginPercent.toFixed(1)),
      },
    };
  }

  async processBulkImport(rows: Array<BulkImportRow & { __row?: number }>): Promise<BulkImportResult> {
    const result: BulkImportResult = { totalRows: rows.length, imported: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Spec: SMART is mandatory, no guessing by article.
        const smart = requireNonEmpty(row.smart, "SMART код");

        const reasonRaw = typeof row.reason === "string" ? row.reason.trim() : String(row.reason);
        const parsedReason = reasonCodeSchema.safeParse(reasonRaw);
        if (!parsedReason.success) throw new Error(`Неверный код операции: ${reasonRaw}`);

        const reason = parsedReason.data;
        if (reason === "return") {
          throw new Error("Операция return создается только через страницу проданных товаров");
        }

        await this.createMovement({
          smart,
          qtyDelta: row.qtyDelta,
          reason,
          note: row.note ?? null,
          purchasePrice: row.purchasePrice ?? null,
          salePrice: row.salePrice ?? null,
          deliveryPrice: row.deliveryPrice ?? null,
          boxNumber: row.boxNumber ?? null,
          trackNumber: row.trackNumber ?? null,
          shippingMethodId: row.shippingMethodId ?? null,
          saleStatus: null,
        });

        result.imported++;
      } catch (err) {
        const { __row, ...data } = row as any;
        result.errors.push({
          row: typeof __row === "number" && Number.isFinite(__row) ? __row : i + 1,
          error: err instanceof Error ? err.message : String(err),
          data,
        });
      }
    }

    return result;
  }
}
