import { sql } from "drizzle-orm";
import { pgTable, pgSchema, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Parts Admin Database (Read-Only) - SMART reference (public schema)
export const smart = pgTable("smart", {
  smart: varchar("smart").primaryKey(),
  articles: jsonb("articles").$type<string[]>().notNull(),
  name: text("name"),
  brand: text("brand"),
  description: text("description"),
});

// Inventory schema for movement tracking
export const inventorySchema = pgSchema("inventory");

// Inventory Database (Read-Write) - Tracking
export const reasons = inventorySchema.table("reasons", {
  code: varchar("code").primaryKey(),
  title: text("title").notNull(),
});

export const movements = inventorySchema.table("movements", {
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
  articles: string[];
  brand?: string[];
  description?: string[];
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

// Database connections table for managing external DB connections
export const dbConnections = inventorySchema.table("db_connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").default(5432).notNull(),
  database: varchar("database", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  password: text("password").notNull(),
  ssl: varchar("ssl", { length: 50 }),
  role: varchar("role", { length: 20 }), // 'smart' | 'inventory' | null
  tableName: varchar("table_name", { length: 255 }),
  fieldMapping: jsonb("field_mapping"), // JSON object mapping external fields to system fields
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DbConnection = typeof dbConnections.$inferSelect;

export const insertDbConnectionSchema = createInsertSchema(dbConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  isActive: true, // managed by backend
}).extend({
  name: z.string().min(1, "Название обязательно"),
  host: z.string().min(1, "Хост обязателен"),
  port: z.number().int().positive().default(5432),
  database: z.string().min(1, "База данных обязательна"),
  username: z.string().min(1, "Имя пользователя обязательно"),
  password: z.string().min(1, "Пароль обязателен"),
  ssl: z.string().optional().nullable(),
  role: z.enum(['smart', 'inventory']).optional().nullable(),
  tableName: z.string().optional().nullable(),
  fieldMapping: z.any().optional().nullable(), // JSON object
});

export type InsertDbConnection = z.infer<typeof insertDbConnectionSchema>;

export type SafeDbConnection = Omit<DbConnection, 'password'>;

export type DbConnectionTest = {
  success: boolean;
  message: string;
  version?: string;
};

export type DbTable = {
  schema: string;
  name: string;
  type: string;
};

export type DbTablesResult = {
  tables: DbTable[];
  connectionName: string;
};

export type ConnectionRole = 'smart' | 'inventory' | null;

export type SmartFieldMapping = {
  smart: string;      // field name for SMART code
  articles: string;   // field name for articles array
  name?: string;      // optional: field name for product name
  brand?: string;     // optional: field name for brand
  description?: string; // optional: field name for description
};

export type InventoryFieldMapping = {
  id: string;         // field name for primary key
  smart: string;      // field name for SMART code
  article: string;    // field name for article
  qtyDelta: string;   // field name for quantity delta
  reason: string;     // field name for reason
  note?: string;      // optional: field name for note
  createdAt: string;  // field name for created timestamp
};

export type FieldMapping = SmartFieldMapping | InventoryFieldMapping | null;

export type ConfigureConnectionPayload = {
  connectionId: number;
  role: ConnectionRole;
  tableName: string;
  fieldMapping: FieldMapping;
};

export type ConfigureConnectionResponse = {
  success: boolean;
  connection: SafeDbConnection;
};

export type DbColumnsResult = {
  columns: string[];
};
