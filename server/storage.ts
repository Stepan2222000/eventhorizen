import type { Pool, PoolClient } from "pg";
import type {
  ArticleSearchResult,
  BulkImportResult,
  BulkImportRow,
  InsertMovement,
  Movement,
  Reason,
  ReasonCode,
  ShippingMethod,
  SoldOutItem,
  StockLevel,
  TopPart,
} from "@shared/schema";
import { reasonCodeSchema } from "@shared/schema";
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
  created_at: Date | string;
};

export class DatabaseStorage {
  constructor(
    private inventoryPool: Pool,
    private smartCache: SmartCache
  ) {}

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

  async getReasons(): Promise<Reason[]> {
    const res = await this.inventoryPool.query<Reason>(`SELECT code, title FROM inventory.reasons ORDER BY code`);
    return res.rows;
  }

  async getShippingMethods(): Promise<ShippingMethod[]> {
    const res = await this.inventoryPool.query<{ id: number; name: string; created_at: Date | string }>(
      `SELECT id, name, created_at FROM inventory.shipping_methods ORDER BY name`
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name, createdAt: toDateIso(r.created_at) }));
  }

  async createShippingMethod(method: Pick<ShippingMethod, "name">): Promise<ShippingMethod> {
    const name = requireNonEmpty(method.name, "Название");
    const res = await this.inventoryPool.query<{ id: number; name: string; created_at: Date | string }>(
      `INSERT INTO inventory.shipping_methods (name) VALUES ($1) RETURNING *`,
      [name]
    );
    const row = res.rows[0];
    return { id: row.id, name: row.name, createdAt: toDateIso(row.created_at) };
  }

  async deleteShippingMethod(id: number): Promise<void> {
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
    const res = await this.inventoryPool.query<{
      smart: string;
      avg_profit: string;
      total_sales: string;
      profit_margin: string;
      current_stock: string;
    }>(`
      WITH avg_purchase AS (
        SELECT
          smart,
          (SUM(CAST(purchase_price AS NUMERIC) * qty_delta) / NULLIF(SUM(qty_delta), 0)) as avg_purchase_price
        FROM inventory.movements
        WHERE reason = 'purchase' AND purchase_price IS NOT NULL
        GROUP BY smart
      ),
      sales AS (
        SELECT
          m.smart,
          SUM(ABS(m.qty_delta)) as total_sales_qty,
          SUM(
            (
              CAST(m.sale_price AS NUMERIC)
              - ap.avg_purchase_price
              - COALESCE(CAST(m.delivery_price AS NUMERIC), 0)
            ) * ABS(m.qty_delta)
          ) as total_profit,
          ap.avg_purchase_price as avg_purchase_price
        FROM inventory.movements m
        JOIN avg_purchase ap ON ap.smart = m.smart
        WHERE m.reason = 'sale' AND m.sale_price IS NOT NULL
        GROUP BY m.smart, ap.avg_purchase_price
      ),
      stock AS (
        SELECT smart, SUM(qty_delta) as current_stock
        FROM inventory.movements
        GROUP BY smart
      )
      SELECT
        s.smart,
        (s.total_profit / NULLIF(s.total_sales_qty, 0)) as avg_profit,
        s.total_sales_qty as total_sales,
        CASE
          WHEN s.avg_purchase_price > 0 THEN
            ((s.total_profit / NULLIF(s.total_sales_qty, 0)) / s.avg_purchase_price) * 100
          ELSE 0
        END as profit_margin,
        COALESCE(st.current_stock, 0) as current_stock
      FROM sales s
      LEFT JOIN stock st ON st.smart = s.smart
      WHERE s.total_sales_qty > 0
    `);

    const items = res.rows.map((row) => {
      const avgProfit = Number(row.avg_profit || 0);
      const totalSales = toInt(row.total_sales);
      const profitMargin = Number(row.profit_margin || 0);
      const currentStock = toInt(row.current_stock);

      const normalizedSales = Math.min(totalSales / 10, 100);
      const normalizedProfit = Math.min(avgProfit / 10, 100);
      const combinedScore = normalizedSales * 0.5 + normalizedProfit * 0.5;

      const smartInfo = this.smartCache.getBySmart(row.smart);
      return {
        smart: row.smart,
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
