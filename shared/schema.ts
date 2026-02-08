import { z } from "zod";

// Core enums
export const reasonCodeSchema = z.enum([
  "purchase",
  "sale",
  "return",
  "writeoff",
  "adjust",
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

export const saleStatusSchema = z.enum(["awaiting_shipment", "shipped"]);
export type SaleStatus = z.infer<typeof saleStatusSchema>;

// SMART reference record (cached on server, read-only from parts DB)
export type Smart = {
  smart: string;
  articles: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
};

export type Reason = {
  code: ReasonCode;
  title: string;
};

export type ShippingMethod = {
  id: number;
  name: string;
  createdAt: string;
};

// Movement stored in inventory DB (no `article` column by specification).
export type Movement = {
  id: number;
  smart: string;
  qtyDelta: number;
  reason: ReasonCode;
  note: string | null;

  // Financial fields (numeric from Postgres are serialized as strings)
  purchasePrice: string | null;
  salePrice: string | null;
  deliveryPrice: string | null;

  // Warehouse tracking
  boxNumber: string | null;

  // Shipping tracking (only for sales)
  trackNumber: string | null;
  shippingMethodId: number | null;
  saleStatus: SaleStatus | null;

  createdAt: string;

  // Derived fields (from SMART cache; not stored in inventory.movements)
  articles?: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
};

export const insertMovementSchema = z.object({
  smart: z.string().min(1, "SMART код обязателен"),
  qtyDelta: z
    .number()
    .int()
    .refine((val) => val !== 0, { message: "Количество не может быть равно 0" }),
  reason: reasonCodeSchema,
  note: z.string().optional().nullable(),

  purchasePrice: z.string().optional().nullable(),
  salePrice: z.string().optional().nullable(),
  deliveryPrice: z.string().optional().nullable(),

  boxNumber: z.string().optional().nullable(),
  trackNumber: z.string().optional().nullable(),
  shippingMethodId: z.number().int().positive().optional().nullable(),
  saleStatus: saleStatusSchema.optional().nullable(),
});

export type InsertMovement = z.infer<typeof insertMovementSchema>;

// Stock level from inventory.stock VIEW (only items with totalQty > 0)
export type StockLevel = {
  smart: string;
  totalQty: number;
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
  articles?: string[];
};

export type ArticleSearchResult = {
  smart: string;
  articles: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
  currentStock: number;
};

export type BulkImportRow = {
  smart: string;
  qtyDelta: number;
  // Import is external input; keep as string to report invalid values per-row.
  reason: string;
  note?: string;

  purchasePrice?: string;
  salePrice?: string;
  deliveryPrice?: string;
  boxNumber?: string;
  trackNumber?: string;
  shippingMethodId?: number;
};

export type BulkImportResult = {
  totalRows: number;
  imported: number;
  errors: Array<{
    row: number;
    error: string;
    data: BulkImportRow;
  }>;
};

export type SoldOutItem = {
  smart: string;
  name?: string | null;
  avgSalePrice: number;
  lastSaleDate: string;
  totalSales: number;
};

export type TopPart = {
  smart: string;
  name?: string | null;
  avgProfit: number;
  totalSales: number;
  profitMargin: number;
  currentStock: number;
  combinedScore?: number;
};
