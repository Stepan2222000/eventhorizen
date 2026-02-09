import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { normalizeArticle } from "@shared/normalization";
import { insertMovementSchema, saleStatusSchema, type BulkImportRow } from "@shared/schema";
import type { AppContext } from "./context";
import { InsufficientStockError, InvalidRequestError } from "./storage";

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES },
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    // Ignore completely empty trailing rows
    if (row.length === 1 && row[0] === "" && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      pushField();
      continue;
    }

    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }

    if (ch === "\r") {
      // handle CRLF
      const next = text[i + 1];
      if (next === "\n") {
        // newline will be handled in next iteration; ignore CR
        continue;
      }
      // standalone CR => treat as newline
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  pushField();
  if (row.length > 0) pushRow();

  // Trim trailing empty rows
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

function pickRowValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

function toStringOrEmpty(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function toIntOrZero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(toStringOrEmpty(v));
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function toOptString(v: unknown): string | undefined {
  const s = toStringOrEmpty(v).trim();
  return s ? s : undefined;
}

function parseBulkImportRowsFromObjects(rawRows: Array<Record<string, unknown>>): Array<BulkImportRow & { __row?: number }> {
  return rawRows.map((obj, idx) => {
    const smart = toStringOrEmpty(pickRowValue(obj, ["smart", "SMART"])).trim();
    const qtyDelta = toIntOrZero(pickRowValue(obj, ["qty_delta", "qtyDelta", "qty"]));
    const reason = toStringOrEmpty(pickRowValue(obj, ["reason", "type"])).trim();

    const row: BulkImportRow & { __row?: number } = {
      smart,
      qtyDelta,
      reason,
    };

    const note = toOptString(pickRowValue(obj, ["note", "comment", "примечание"]));
    if (note) row.note = note;

    const purchasePrice = toOptString(pickRowValue(obj, ["purchase_price", "purchasePrice"]));
    if (purchasePrice) row.purchasePrice = purchasePrice;

    const salePrice = toOptString(pickRowValue(obj, ["sale_price", "salePrice"]));
    if (salePrice) row.salePrice = salePrice;

    const deliveryPrice = toOptString(pickRowValue(obj, ["delivery_price", "deliveryPrice"]));
    if (deliveryPrice) row.deliveryPrice = deliveryPrice;

    const boxNumber = toOptString(pickRowValue(obj, ["box_number", "boxNumber"]));
    if (boxNumber) row.boxNumber = boxNumber;

    const trackNumber = toOptString(pickRowValue(obj, ["track_number", "trackNumber"]));
    if (trackNumber) row.trackNumber = trackNumber;

    const shippingMethodId = pickRowValue(obj, ["shipping_method_id", "shippingMethodId"]);
    const shippingMethodIdNum = toIntOrZero(shippingMethodId);
    if (shippingMethodId !== undefined && shippingMethodIdNum > 0) row.shippingMethodId = shippingMethodIdNum;

    // Keep original row number (1-based, excluding headers) if provided by the caller.
    row.__row = (obj as any).__row ?? idx + 2;

    return row;
  });
}

export async function registerRoutes(app: Express, ctx: AppContext): Promise<Server> {
  const { storage } = ctx;

  app.get("/api/articles/search", async (req, res) => {
    try {
      const query = req.query.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      const normalized = normalizeArticle(query);
      if (!normalized || normalized.length < 2) {
        return res.status(400).json({ error: "Query parameter is too short" });
      }

      const matches = storage.searchSmart(normalized);
      const smartCodes = matches.map((m) => m.smart);
      const stockMap = await storage.getTotalStockBySmartBatch(smartCodes);

      res.json(
        matches.map((m) => ({
          ...m,
          currentStock: stockMap.get(m.smart) ?? 0,
        }))
      );
    } catch (err) {
      console.error("Search error:", err);
      res.status(500).json({ error: "Failed to search" });
    }
  });

  app.get("/api/smart/:code", (req, res) => {
    const smart = storage.getSmartByCode(req.params.code);
    if (!smart) return res.status(404).json({ error: "SMART code not found" });
    res.json(smart);
  });

  app.post("/api/movements", async (req, res) => {
    try {
      const validated = insertMovementSchema.parse(req.body);
      if (validated.reason === "return") {
        return res.status(400).json({ error: "Возврат создается только через страницу проданных товаров" });
      }

      const movement = await storage.createMovement(validated);
      res.status(201).json(movement);
    } catch (err) {
      console.error("Create movement error:", err);

      if (err instanceof InsufficientStockError) {
        return res.status(409).json({
          error: err.message,
          details: {
            smart: err.smart,
            currentStock: err.currentStock,
            requestedQty: err.requestedQty,
          },
        });
      }

      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues.map((i) => i.message).join("; ") });
      }

      if (err instanceof InvalidRequestError) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create movement" });
    }
  });

  app.get("/api/movements", async (_req, res) => {
    try {
      const movements = await storage.getMovements();
      res.json(movements);
    } catch (err) {
      console.error("Get movements error:", err);
      res.status(500).json({ error: "Failed to get movements" });
    }
  });

  app.get("/api/stock", async (_req, res) => {
    try {
      const stock = await storage.getStockLevels();
      res.json(stock);
    } catch (err) {
      console.error("Get stock error:", err);
      res.status(500).json({ error: "Failed to get stock levels" });
    }
  });

  app.get("/api/stock/:smart/purchases", async (req, res) => {
    try {
      const purchases = await storage.getPurchasesBySmart(req.params.smart);
      res.json(purchases);
    } catch (err) {
      console.error("Get purchases error:", err);
      res.status(500).json({ error: "Failed to get purchases" });
    }
  });

  app.get("/api/stock/:smart/sales", async (req, res) => {
    try {
      const smart = req.params.smart;
      const [sales, purchases] = await Promise.all([
        storage.getSalesBySmart(smart),
        storage.getPurchasesBySmart(smart),
      ]);

      // Average purchase price must be computed across ALL purchases for SMART.
      // Use weighted average by quantity (price-per-unit).
      const purchaseLines = purchases
        .map((p) => ({
          price: p.purchasePrice ? Number(p.purchasePrice) : NaN,
          qty: Math.abs(p.qtyDelta),
        }))
        .filter((l) => Number.isFinite(l.price) && l.qty > 0);

      const totalPurchaseQty = purchaseLines.reduce((sum, l) => sum + l.qty, 0);
      const totalPurchaseCostWeighted = purchaseLines.reduce((sum, l) => sum + l.price * l.qty, 0);
      const avgPurchasePrice = totalPurchaseQty > 0 ? totalPurchaseCostWeighted / totalPurchaseQty : 0;

      const salesWithMetrics = sales.map((sale) => {
        const salePrice = sale.salePrice ? Number(sale.salePrice) : 0;
        const deliveryPrice = sale.deliveryPrice ? Number(sale.deliveryPrice) : 0;
        const quantity = Math.abs(sale.qtyDelta);

        const profitPerUnit = salePrice - avgPurchasePrice - deliveryPrice;
        const profit = profitPerUnit * quantity;
        const profitMarginPercent = avgPurchasePrice > 0 ? (profitPerUnit / avgPurchasePrice) * 100 : 0;

        // Optional UX metric: closest previous purchase (by SMART only).
        const closestPurchase = purchases
          .filter((p) => new Date(p.createdAt) < new Date(sale.createdAt))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        const daysFromPurchase = closestPurchase
          ? Math.round(
              (new Date(sale.createdAt).getTime() - new Date(closestPurchase.createdAt).getTime()) / (1000 * 60 * 60 * 24)
            )
          : null;

        return {
          ...sale,
          profit,
          profitMarginPercent,
          daysFromPurchase,
          purchasePriceUsed: avgPurchasePrice,
        };
      });

      const totalSold = salesWithMetrics.reduce((sum, s) => sum + Math.abs(s.qtyDelta), 0);
      const totalPurchased = purchases.reduce((sum, p) => sum + Math.abs(p.qtyDelta), 0);
      const sellThroughRate = totalPurchased > 0 ? (totalSold / totalPurchased) * 100 : 0;

      const salesWithDays = salesWithMetrics.filter((s) => s.daysFromPurchase !== null);
      const averageDaysToSell =
        salesWithDays.length > 0
          ? salesWithDays.reduce((sum, s) => sum + (s.daysFromPurchase || 0), 0) / salesWithDays.length
          : 0;

      const totalProfit = salesWithMetrics.reduce((sum, s) => sum + s.profit, 0);
      const averageProfitPerUnit = totalSold > 0 ? totalProfit / totalSold : 0;

      const totalPurchaseCost = avgPurchasePrice * totalSold;
      const averageProfitMarginPercent = totalPurchaseCost > 0 ? (totalProfit / totalPurchaseCost) * 100 : 0;

      res.json({
        sales: salesWithMetrics,
        metrics: {
          averageDaysToSell: Math.round(averageDaysToSell * 10) / 10,
          soldQuantity: totalSold,
          totalPurchased,
          sellThroughRate: Math.round(sellThroughRate * 10) / 10,
          averageProfitPerUnit: Math.round(averageProfitPerUnit * 100) / 100,
          averageProfitMarginPercent: Math.round(averageProfitMarginPercent * 10) / 10,
        },
      });
    } catch (err) {
      console.error("Get sales analytics error:", err);
      res.status(500).json({ error: "Failed to get sales analytics" });
    }
  });

  // Stock details (must return 0 stock if existed, 404 only if never existed)
  app.get("/api/stock/:smart", async (req, res) => {
    try {
      const info = await storage.getStockBySmart(req.params.smart);
      if (!info.existed) return res.status(404).json({ error: "SMART code not found in inventory history" });
      // Drop helper field from response
      const { existed, ...payload } = info;
      res.json(payload);
    } catch (err) {
      console.error("Get stock details error:", err);
      res.status(500).json({ error: "Failed to get stock details" });
    }
  });

  app.patch("/api/movements/:id", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

      const { purchasePrice, note, qtyDelta, boxNumber } = req.body as Record<string, unknown>;

      const updates: any = {};

      if (purchasePrice !== undefined) updates.purchasePrice = purchasePrice;
      if (note !== undefined) updates.note = note;
      if (boxNumber !== undefined) updates.boxNumber = boxNumber;

      if (qtyDelta !== undefined) {
        const n = typeof qtyDelta === "number" ? qtyDelta : Number(qtyDelta);
        if (!Number.isFinite(n) || n <= 0) {
          return res.status(400).json({ error: "Quantity must be a positive number" });
        }
        updates.qtyDelta = Math.trunc(n);
      }

      const movement = await storage.updateMovement(id, updates);
      res.json(movement);
    } catch (err) {
      console.error("Update movement error:", err);

      if (err instanceof InsufficientStockError) {
        return res.status(409).json({
          error: err.message,
          details: { smart: err.smart, currentStock: err.currentStock, requestedQty: err.requestedQty },
        });
      }

      if (err instanceof Error && err.message === "Movement not found") {
        return res.status(404).json({ error: err.message });
      }

      if (err instanceof InvalidRequestError) {
        return res.status(400).json({ error: err.message });
      }

      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update movement" });
    }
  });

  app.get("/api/reasons", async (_req, res) => {
    try {
      const reasons = await storage.getReasons();
      res.json(reasons);
    } catch (err) {
      console.error("Get reasons error:", err);
      res.status(500).json({ error: "Failed to get reasons" });
    }
  });

  app.get("/api/shipping-methods", async (_req, res) => {
    try {
      const methods = await storage.getShippingMethods();
      res.json(methods);
    } catch (err) {
      console.error("Get shipping methods error:", err);
      res.status(500).json({ error: "Failed to get shipping methods" });
    }
  });

  app.post("/api/shipping-methods", async (req, res) => {
    try {
      const name = req.body?.name;
      if (!name || typeof name !== "string") return res.status(400).json({ error: "Name is required" });
      const method = await storage.createShippingMethod({ name });
      res.status(201).json(method);
    } catch (err) {
      console.error("Create shipping method error:", err);
      if (err instanceof InvalidRequestError) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Failed to create shipping method" });
    }
  });

  app.delete("/api/shipping-methods/:id", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      await storage.deleteShippingMethod(id);
      res.status(204).send();
    } catch (err) {
      console.error("Delete shipping method error:", err);
      res.status(500).json({ error: "Failed to delete shipping method" });
    }
  });

  app.patch("/api/movements/:id/status", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

      const status = req.body?.status;
      const parsed = saleStatusSchema.safeParse(status);
      if (!parsed.success) return res.status(400).json({ error: "Invalid status" });

      const movement = await storage.updateMovementSaleStatus(id, parsed.data);
      res.json(movement);
    } catch (err) {
      console.error("Update movement status error:", err);
      if (err instanceof Error && err.message === "Movement not found") {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof InvalidRequestError) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update movement status" });
    }
  });

  app.patch("/api/movements/:id/ship", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const movement = await storage.updateMovementSaleStatus(id, "shipped");
      res.json(movement);
    } catch (err) {
      console.error("Mark as shipped error:", err);
      if (err instanceof Error && err.message === "Movement not found") {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof InvalidRequestError) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to mark as shipped" });
    }
  });

  app.get("/api/sold-out", async (_req, res) => {
    try {
      const items = await storage.getSoldOutItems();
      res.json(items);
    } catch (err) {
      console.error("Get sold out items error:", err);
      res.status(500).json({ error: "Failed to get sold out items" });
    }
  });

  app.get("/api/top-parts", async (req, res) => {
    try {
      const mode = req.query.mode;
      if (mode !== "profit" && mode !== "sales" && mode !== "combined") {
        return res.status(400).json({ error: "Invalid mode. Must be 'profit', 'sales', or 'combined'" });
      }
      const items = await storage.getTopParts(mode);
      res.json(items);
    } catch (err) {
      console.error("Get top parts error:", err);
      res.status(500).json({ error: "Failed to get top parts" });
    }
  });

  app.post("/api/movements/:id/return", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });

      const saleMovement = await storage.getMovementById(id);
      if (!saleMovement) return res.status(404).json({ error: "Movement not found" });
      if (saleMovement.reason !== "sale") return res.status(400).json({ error: "Can only return sales" });

      const returnMovement = await storage.createMovement({
        smart: saleMovement.smart,
        qtyDelta: Math.abs(saleMovement.qtyDelta),
        reason: "return",
        note: `Возврат продажи #${id}`,
        purchasePrice: null,
        salePrice: null,
        deliveryPrice: null,
        boxNumber: null,
        trackNumber: null,
        shippingMethodId: null,
        saleStatus: null,
      });

      res.status(201).json(returnMovement);
    } catch (err) {
      console.error("Return to inventory error:", err);
      if (err instanceof Error && err.message === "Товар уже возвращен на склад") {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to return to inventory" });
    }
  });

  app.post("/api/bulk-import", upload.single("file"), async (req: Request, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let rows: Array<BulkImportRow & { __row?: number }> = [];

      const isExcel =
        req.file.mimetype.includes("sheet") ||
        req.file.originalname?.toLowerCase().endsWith(".xlsx") ||
        req.file.originalname?.toLowerCase().endsWith(".xls");
      const isCsv = req.file.mimetype.includes("csv") || req.file.originalname?.toLowerCase().endsWith(".csv");

      if (isExcel) {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          return res.status(400).json({ error: "Empty Excel file (no sheets)" });
        }
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          return res.status(400).json({ error: "Empty Excel file" });
        }

        const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Record<string, unknown>[];
        if (rawRows.length === 0) {
          return res.status(400).json({ error: "Empty Excel sheet" });
        }

        // Add 1-based excel row numbers (header row is 1)
        const withRow = rawRows.map((r, idx) => ({ ...r, __row: idx + 2 }));
        rows = parseBulkImportRowsFromObjects(withRow);
      } else if (isCsv) {
        const csvText = req.file.buffer.toString("utf-8");
        const table = parseCsv(csvText);
        if (table.length === 0) return res.status(400).json({ error: "Empty CSV file" });

        const headers = table[0].map((h) => h.trim());
        const rawObjects: Record<string, unknown>[] = [];
        for (let i = 1; i < table.length; i++) {
          const values = table[i];
          if (values.every((v) => !v || !String(v).trim())) continue;

          const obj: Record<string, unknown> = { __row: i + 1 };
          for (let c = 0; c < headers.length; c++) {
            obj[headers[c]] = values[c] ?? "";
          }
          rawObjects.push(obj);
        }

        rows = parseBulkImportRowsFromObjects(rawObjects);
      } else {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      const normalizedRows = rows.map((r) => ({
        ...r,
        smart: typeof r.smart === "string" ? r.smart.trim() : r.smart,
        reason: typeof r.reason === "string" ? r.reason.trim() : r.reason,
      }));

      const result = await storage.processBulkImport(normalizedRows);
      res.json(result);
    } catch (err: any) {
      // Multer file-size limit
      if (err && typeof err === "object" && (err as any).code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `File too large. Max ${MAX_IMPORT_FILE_BYTES} bytes.` });
      }
      console.error("Bulk import error:", err);
      res.status(500).json({ error: "Failed to process bulk import" });
    }
  });

  app.get("/api/import-template", (_req, res) => {
    const templateData = [
      { smart: "smart_17713", qty_delta: 10, reason: "purchase", purchase_price: 100.0, box_number: "K-123", note: "Example purchase" },
      { smart: "smart_17713", qty_delta: -1, reason: "sale", sale_price: 250.0, delivery_price: 0.0, shipping_method_id: 1, note: "Example sale" },
      { smart: "smart_17713", qty_delta: -1, reason: "writeoff", note: "Example writeoff" },
      { smart: "smart_17713", qty_delta: 2, reason: "adjust", purchase_price: 120.0, note: "Пересчет склада, нашли лишние" },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import Template");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", 'attachment; filename="inventory-import-template.xlsx"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  });

  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      // Use SQL aggregation (no artificial limits, no full-table fetch to JS).
      const stats = await ctx.pools.inventoryPool.query<{
        in_stock: string;
        total_parts: string;
        movements_today: string;
        sales_today: string;
      }>(`
        WITH
          in_stock AS (
            SELECT COUNT(*)::text as in_stock
            FROM inventory.stock
          ),
          total_parts AS (
            SELECT COALESCE(SUM(total_qty::bigint), 0)::text as total_parts
            FROM inventory.stock
          ),
          movements_today AS (
            SELECT COUNT(*)::text as movements_today
            FROM inventory.movements
            WHERE created_at::date = CURRENT_DATE
          ),
          sales_today AS (
            SELECT COUNT(*)::text as sales_today
            FROM inventory.movements
            WHERE created_at::date = CURRENT_DATE AND reason = 'sale'
          )
        SELECT
          (SELECT in_stock FROM in_stock) as in_stock,
          (SELECT total_parts FROM total_parts) as total_parts,
          (SELECT movements_today FROM movements_today) as movements_today,
          (SELECT sales_today FROM sales_today) as sales_today
      `);

      const row = stats.rows[0];
      res.json({
        inStock: Number(row?.in_stock || 0),
        totalParts: Number(row?.total_parts || 0),
        movementsToday: Number(row?.movements_today || 0),
        salesToday: Number(row?.sales_today || 0),
      });
    } catch (err) {
      console.error("Dashboard stats error:", err);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
