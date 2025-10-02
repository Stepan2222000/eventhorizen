import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Parts Admin Database (Read-Only) - SMART reference
export const smart = pgTable("smart", {
  smart: varchar("smart").primaryKey(),
  articles: jsonb("articles").$type<string[]>().notNull(),
  name: text("name"),
  brand: text("brand"),
  description: text("description"),
});

// Inventory Database (Read-Write) - Tracking
export const reasons = pgTable("reasons", {
  code: varchar("code").primaryKey(),
  title: text("title").notNull(),
});

export const movements = pgTable("movements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  smart: varchar("smart").notNull(),
  article: text("article").notNull(),
  qtyDelta: integer("qty_delta").notNull(),
  reason: varchar("reason").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Types
export type Smart = typeof smart.$inferSelect;
export type InsertSmart = typeof smart.$inferInsert;

export type Reason = typeof reasons.$inferSelect;
export type InsertReason = typeof reasons.$inferInsert;

export type Movement = typeof movements.$inferSelect;
export type InsertMovement = typeof movements.$inferInsert;

// Zod schemas
export const insertMovementSchema = createInsertSchema(movements).pick({
  smart: true,
  article: true,
  qtyDelta: true,
  reason: true,
  note: true,
});

export const insertReasonSchema = createInsertSchema(reasons);

// Stock level type for VIEW
export type StockLevel = {
  smart: string;
  article: string;
  totalQty: number;
  brand?: string;
  description?: string;
  name?: string;
};

// Search result types
export type ArticleSearchResult = {
  smart: string;
  article: string;
  brand?: string;
  description?: string;
  name?: string;
  currentStock: number;
};

export type BulkImportRow = {
  article: string;
  qtyDelta: number;
  reason: string;
  note?: string;
  smart?: string;
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
