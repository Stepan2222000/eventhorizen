import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initializeInventoryDb } from "./db";
import { insertMovementSchema } from "@shared/schema";
import { normalizeArticle } from "@shared/normalization";
import type { BulkImportRow } from "@shared/schema";
import multer from "multer";
import * as XLSX from "xlsx";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database
  await initializeInventoryDb();
  
  // Create default connections if they don't exist
  await storage.createDefaultConnections();

  // Search articles by normalized input
  app.get("/api/articles/search", async (req, res) => {
    try {
      const { query } = req.query;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: "Query parameter is required" });
      }

      const normalized = normalizeArticle(query);
      const matches = await storage.searchSmart(normalized);
      
      // Get total stock by SMART code (aggregated across all article variants)
      const results = await Promise.all(
        matches.map(async (match) => {
          const totalStock = await storage.getTotalStockBySmart(match.smart);
          return {
            smart: match.smart,
            article: query,
            brand: match.brand,
            description: match.description,
            name: match.name,
            currentStock: totalStock,
          };
        })
      );

      res.json(results);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Failed to search articles" });
    }
  });

  // Get SMART details by code
  app.get("/api/smart/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const smart = await storage.getSmartByCode(code);
      
      if (!smart) {
        return res.status(404).json({ error: "SMART code not found" });
      }

      res.json(smart);
    } catch (error) {
      console.error("Get SMART error:", error);
      res.status(500).json({ error: "Failed to get SMART details" });
    }
  });

  // Create movement
  app.post("/api/movements", async (req, res) => {
    try {
      const validatedData = insertMovementSchema.parse(req.body);
      const movement = await storage.createMovement(validatedData);
      res.status(201).json(movement);
    } catch (error) {
      console.error("Create movement error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create movement" });
      }
    }
  });

  // Get movements with pagination
  app.get("/api/movements", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const movements = await storage.getMovements(limit, offset);
      res.json(movements);
    } catch (error) {
      console.error("Get movements error:", error);
      res.status(500).json({ error: "Failed to get movements" });
    }
  });

  // Get movements by SMART and article
  app.get("/api/movements/:smart/:article", async (req, res) => {
    try {
      const { smart, article } = req.params;
      const movements = await storage.getMovementsBySmartAndArticle(smart, article);
      res.json(movements);
    } catch (error) {
      console.error("Get movements by SMART/article error:", error);
      res.status(500).json({ error: "Failed to get movements" });
    }
  });

  // Get stock levels with pagination
  app.get("/api/stock", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const stock = await storage.getStockLevels(limit, offset);
      res.json(stock);
    } catch (error) {
      console.error("Get stock error:", error);
      res.status(500).json({ error: "Failed to get stock levels" });
    }
  });

  // Get stock by SMART and article
  app.get("/api/stock/:smart/:article", async (req, res) => {
    try {
      const { smart, article } = req.params;
      const stock = await storage.getStockBySmartAndArticle(smart, article);
      
      if (!stock) {
        return res.status(404).json({ error: "Stock not found" });
      }

      res.json(stock);
    } catch (error) {
      console.error("Get stock by SMART/article error:", error);
      res.status(500).json({ error: "Failed to get stock" });
    }
  });

  // Get reasons
  app.get("/api/reasons", async (req, res) => {
    try {
      const reasons = await storage.getReasons();
      res.json(reasons);
    } catch (error) {
      console.error("Get reasons error:", error);
      res.status(500).json({ error: "Failed to get reasons" });
    }
  });

  // Bulk import
  app.post("/api/bulk-import", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let rows: BulkImportRow[] = [];

      // Parse file based on type
      if (req.file.mimetype.includes('sheet') || req.file.originalname?.endsWith('.xlsx') || req.file.originalname?.endsWith('.xls')) {
        // Excel file
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];
        
        // Convert Excel rows to BulkImportRow format (handle both snake_case and camelCase)
        rows = rawRows.map(row => ({
          article: row.article || '',
          qtyDelta: parseInt(row.qty_delta || row.qtyDelta) || 0,
          reason: row.reason || '',
          note: row.note || undefined,
          smart: row.smart || undefined,
        })).filter(row => row.article && row.qtyDelta && row.reason);
      } else if (req.file.mimetype.includes('csv') || req.file.originalname?.endsWith('.csv')) {
        // CSV file
        const csvText = req.file.buffer.toString('utf-8');
        const lines = csvText.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          const row: any = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          
          const qtyDelta = parseInt(row.qty_delta || row.qtyDelta) || 0;
          
          if (row.article && qtyDelta && row.reason) {
            rows.push({
              article: row.article,
              qtyDelta: qtyDelta,
              reason: row.reason,
              note: row.note || undefined,
              smart: row.smart || undefined,
            });
          }
        }
      } else {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      // Process bulk import
      const result = await storage.processBulkImport(rows);
      res.json(result);
    } catch (error) {
      console.error("Bulk import error:", error);
      res.status(500).json({ error: "Failed to process bulk import" });
    }
  });

  // Download import template
  app.get("/api/import-template", (req, res) => {
    const templateData = [
      { article: 'ABC-123', qty_delta: 10, reason: 'purchase', note: 'Example purchase', smart: '' },
      { article: 'DEF-456', qty_delta: -5, reason: 'sale', note: 'Example sale', smart: 'SMART-00123' },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import Template');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-import-template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  });

  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      // This would need custom queries to get actual stats
      // For now, return basic structure
      const movements = await storage.getMovements(1000, 0);
      const stockLevels = await storage.getStockLevels(1000, 0);
      
      const stats = {
        totalArticles: stockLevels.length,
        inStock: stockLevels.filter(s => s.totalQty > 0).length,
        movementsToday: movements.filter(m => {
          const today = new Date();
          const movementDate = new Date(m.createdAt);
          return movementDate.toDateString() === today.toDateString();
        }).length,
        lowStockAlerts: stockLevels.filter(s => s.totalQty > 0 && s.totalQty <= 10).length,
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Failed to get dashboard stats" });
    }
  });

  // Database connections management
  app.get("/api/db-connections", async (req, res) => {
    try {
      const connections = await storage.getDbConnections();
      // Password is already removed by storage layer
      res.json(connections);
    } catch (error) {
      console.error("Get DB connections error:", error);
      res.status(500).json({ error: "Failed to get database connections" });
    }
  });

  app.post("/api/db-connections", async (req, res) => {
    try {
      const connection = await storage.createDbConnection(req.body);
      // Password is already removed by storage layer
      res.status(201).json(connection);
    } catch (error) {
      console.error("Create DB connection error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create database connection" });
      }
    }
  });

  app.delete("/api/db-connections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDbConnection(id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete DB connection error:", error);
      res.status(500).json({ error: "Failed to delete database connection" });
    }
  });

  app.post("/api/db-connections/test", async (req, res) => {
    try {
      const result = await storage.testDbConnection(req.body);
      res.json(result);
    } catch (error) {
      console.error("Test DB connection error:", error);
      if (error instanceof Error) {
        res.status(400).json({ success: false, message: error.message });
      } else {
        res.status(500).json({ success: false, message: "Failed to test connection" });
      }
    }
  });

  app.post("/api/db-connections/:id/tables", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = await storage.getDbTables(id);
      res.json(result);
    } catch (error) {
      console.error("Get DB tables error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to get tables" });
      }
    }
  });

  app.post("/api/db-connections/:id/configure", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { role, tableName, fieldMapping } = req.body;
      
      const result = await storage.configureConnection({
        connectionId: id,
        role,
        tableName,
        fieldMapping,
      });
      
      res.json(result);
    } catch (error) {
      console.error("Configure connection error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to configure connection" });
      }
    }
  });

  app.get("/api/db-connections/:id/columns", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { tableName } = req.query;
      
      if (!tableName || typeof tableName !== 'string') {
        return res.status(400).json({ error: "tableName query parameter is required" });
      }
      
      const columns = await storage.getTableColumns(id, tableName);
      res.json({ columns });
    } catch (error) {
      console.error("Get table columns error:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to get columns" });
      }
    }
  });

  app.get("/api/db-connections/active/:role", async (req, res) => {
    try {
      const { role } = req.params;
      
      if (role !== 'smart' && role !== 'inventory') {
        return res.status(400).json({ error: "Invalid role" });
      }
      
      const connection = await storage.getActiveConnection(role);
      res.json(connection);
    } catch (error) {
      console.error("Get active connection error:", error);
      res.status(500).json({ error: "Failed to get active connection" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
