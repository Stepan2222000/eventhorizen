# SMART Inventory Management System

## Overview

This project is an internal inventory tracking system designed to link user-entered article codes with a standardized SMART reference database. It features robust fuzzy matching for article variants, maintains a complete movement history, and calculates current stock levels from transaction deltas. The system also includes financial tracking for purchase and sale operations, warehouse tracking (box numbers), and a two-phase sales workflow with shipping integration. A critical business logic ensures stock validation before sales/write-offs, preventing negative stock levels. The system automatically handles schema migrations and is localized entirely in Russian for internal network users.

### Recent Fixes (November 2025)
- **Connection Pool Exhaustion Fixed**: Resolved critical "too many clients already" error (PostgreSQL code 53300) in article search. Root cause was parallel connection creation for each search result via `Promise.all`. Implemented batch query method `getTotalStockBySmartBatch` that fetches all stock levels in ONE database query using `WHERE smart = ANY($1)` instead of creating hundreds of parallel connections. Search now creates maximum one inventory connection per request regardless of result count.
- **Autofill Fixed**: URL parameter autofill now correctly uses `window.location.search` instead of wouter's location (which doesn't include query strings). Article and SMART code fields are automatically populated when navigating from search results.
- **Complete E2E Workflow Validated**: Full purchase → sale → sold items page workflow tested and working correctly with all financial fields, shipping tracking, and status management.
- **Stock Aggregation Fixed**: inventory.stock VIEW now correctly groups by SMART code only (not SMART+article), eliminating duplicate rows and summing quantities across all article variants.
- **Zero Quantity Validation**: Added frontend and backend validation to prevent movements with qty_delta = 0. Error message displays below quantity field.
- **Negative Stock Prevention**: getCurrentStock method now checks total by SMART code (not by article) to prevent overselling across all article variants.
- **Zero Stock Items Hidden**: Added `HAVING SUM(qty_delta) > 0` to inventory.stock VIEW to automatically filter out items with zero or negative quantities from stock display. Stock table now shows only items currently in inventory.
- **SMART Code Search Enhanced**: Search functionality now works for both SMART codes AND article codes (OR condition in SQL). Autocomplete displays SMART code first for better visibility.
- **Runtime Errors Fixed (Two-Phase Solution)**: Eliminated "cannot read property 'join' of null/undefined" errors in search results display. **Phase 1 (Frontend)**: Added `Array.isArray()` checks before all `.join()` calls in DisambiguationModal, add-movement autocomplete, and article-search result display. **Phase 2 (Backend)**: Normalized data in `/api/articles/search` endpoint with `toArray()` helper that converts string values to singleton arrays (e.g., `"YAMAHA"` → `["YAMAHA"]`), handles null gracefully, and ensures `brand`/`description` fields match frontend `ArticleSearchResult` type expectations. This two-phase approach prevents crashes while preserving data display fidelity for text fields stored in database.
- **Button Colors Improved**: Quantity adjustment buttons changed from red/green to orange decrement (`text-orange-600`) and green increment (`text-green-600`) with outline variant for better UX.
- **Duplicate Return Prevention**: Atomic transaction-level duplicate check prevents creating multiple return movements for the same sale. Check uses exact equality `note = 'Возврат продажи #<id>'` within SERIALIZABLE transaction. Server returns 409 Conflict with error message to frontend.
- **Sale Price Clarification**: Label changed from "Цена продажи" to "Цена за единицу товара" with automatic total calculation display showing "Общая сумма: X ₽" (using |quantity| × price).
- **Quantity Direction Validation**: Added frontend and backend validation to enforce correct quantity signs: Purchase/Return must be positive (+), Sale/Writeoff must be negative (-). Clear error messages prevent logical errors in inventory operations.
- **Return Option Removed from Add Movement Form**: Removed "Возврат" from the reasons dropdown on Add Movement page. Returns are now created exclusively via "Вернуть на склад" button on Sold Items page, enforcing proper business logic that ties each return to its specific sale. Frontend filters `availableReasons` to exclude 'return' code. Backend maintains defensive validation for both purchase and return endpoints.
- **Quantity Validation Auto-Trigger Fixed**: Fixed validation bugs in Add Movement form. Added `useEffect` to trigger validation when reason changes. Fixed `incrementQty`/`decrementQty` functions that were using stale `qtyInput` values due to closure bug. Now validation triggers immediately when quantity changes via buttons or direct input, preventing false validation errors.
- **Extended Inline Editing on Stock Details Page**: Expanded inline editing capabilities from 2 fields (price, comment) to 4 fields (price, quantity, box number, comment). Implemented compact, fixed-width inputs for better UX: price (w-28/112px), quantity (w-20/80px), box number (w-24/96px). All inputs standardized to h-8 height with compact h-8 w-8 save/cancel buttons. Added dual-layer validation (frontend + backend) requiring qtyDelta > 0 to prevent inventory corruption. Backend PATCH endpoint returns 400 for invalid quantities. Total column auto-recalculates after price/quantity changes. All changes tested end-to-end with successful validation of compact layout and data integrity.
- **Table Text Wrapping Fixed**: Added `whitespace-nowrap` CSS class to key columns in purchase history table (Date, Article, Box Number, Total) to prevent unwanted line breaks. Box numbers like "K-3" no longer split across lines. All data displays cleanly on single lines without horizontal overflow issues.
- **Plus Button Navigation Added**: Stock levels page "+" button now functional - wraps in Link component to navigate to /movement page with pre-filled SMART code via query parameter (?smart=code). Enables quick movement creation directly from stock overview.
- **Comment Field Improved**: Replaced single-line Input with multi-line Textarea (80px min-height, vertically resizable) for comment editing on stock details page. Save shortcut changed to Ctrl+Enter (Enter creates new line). Display mode preserves line breaks with whitespace-pre-wrap. Save/cancel buttons positioned vertically beside textarea for better UX.
- **Sales Analytics Added**: Implemented comprehensive sales analytics section on stock details page below purchase history. New GET /api/stock/:smart/sales endpoint returns sales with calculated profitability metrics. **Critical fixes**: (1) Sales match purchases by ARTICLE first, then time proximity, ensuring correct cost basis when SMART code has multiple articles. (2) Profit margin percentage uses weighted formula (totalProfit / totalPurchaseCost × 100) instead of simple average, reflecting true portfolio profitability. Frontend displays 4 metric cards (average days to sell, sell-through rate, average profit per unit in rubles, profit margin percentage) and detailed sales table (8 columns: date, quantity, sale price, purchase price, delivery, profit, margin %, days from purchase). Delivery costs included in all profit calculations. Green/red color coding for positive/negative values. Empty state message displays when no sales exist.
- **Independent Table Scrolling Fixed**: Resolved issue where user couldn't scroll down to see Sales History section when Purchase History table was very long. **Root cause**: shadcn Table component has built-in overflow-auto wrapper that prevented max-h-[500px] from working properly. **Solution**: Replaced all shadcn Table/TableHeader/TableRow/TableHead/TableBody/TableCell components with plain HTML table/thead/tr/th/tbody/td elements in both Purchase History (lines 224-447) and Sales History (lines 520-571) tables. Each table now wrapped in `<div className="relative max-h-[500px] overflow-auto border rounded-md">` container. This enables independent scrolling within each table while keeping both sections simultaneously visible with minimal main page scrolling. All inline editing functionality, styling (via Tailwind classes), and test IDs preserved. E2E tested: both tables scroll independently, containers enforce 500px max height, borders visible.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript
- Vite for build tooling
- Wouter for client-side routing
- TanStack Query for server state management
- shadcn/ui component library (Radix UI + Tailwind CSS)
- React Hook Form with Zod for form management

**Key Features:**
- Component-based architecture with reusable UI primitives.
- Live article autocomplete with debounced search and rich results display.
- Auto-filling of movement forms from search results via URL parameters.
- Modal-based disambiguation for multiple SMART code matches.
- Full UI localization in Russian.
- Pages include Dashboard, Article Search, Add Movement, Stock Levels, Movement History, Bulk Import, and Database Connections.

### Backend Architecture

**Technology Stack:**
- Express.js server with TypeScript (Node.js runtime, ESM modules)
- Drizzle ORM for local database interactions
- PostgreSQL database (standard `pg` driver)
- Multer for file uploads
- XLSX library for spreadsheet parsing

**Key Design Patterns:**
- Repository pattern with storage abstraction.
- Dual database connection strategy (read-only for SMART, read-write for inventory).
- Server-side normalization logic for fuzzy article matching.
- RESTful API endpoints.
- Automatic schema migration and seed data on startup.
- Critical stock validation with `InsufficientStockError` and `SERIALIZABLE` transactions to prevent negative stock.
- Automatic retry with exponential backoff for serialization conflicts.

**API Structure:**
- Endpoints for article search, SMART code retrieval, inventory movements (record, history), stock levels, bulk import, reasons, dashboard stats, and database connection management (create, delete, test, get tables).

### Data Storage Solutions

**Database Schema (PostgreSQL):**
- **External SMART Database:** `public.smart` table (read-only) stores SMART codes, article arrays, product names, brands, and other metadata. Configurable field mapping allows dynamic adaptation.
- **Inventory Schema:**
  - `inventory.reasons`: Lookup table for transaction types (purchase, sale, return, writeoff).
  - `inventory.movements`: Transaction log including `smart` code, original `article`, `qty_delta`, `reason`, `note`, `created_at`, `purchasePrice`, `salePrice`, `deliveryPrice`, `boxNumber`, `trackNumber`, `shippingMethodId`, `saleStatus`.
  - `inventory.stock` view: Aggregates movements for current stock levels.
  - `inventory.shipping_methods`: Stores available shipping methods.
  - `inventory.db_connections`: Stores database connection credentials (securely managed).

**Normalization Strategy:**
- Three-step normalization for search (uppercase, delimiter removal, Cyrillic-to-Latin) is applied on the fly, preserving original user input in the database.
- Uses `unnest()` with regex for partial and fuzzy matching on VARCHAR arrays.

## External Dependencies

**Database:**
- PostgreSQL database via standard `pg` driver with connection pooling.
- Local inventory database (configured via `DATABASE_URL`).
- External SMART database (e.g., `parts_admin@81.30.105.134:5403`).
- Drizzle ORM for local database, raw `pg.Pool` for dynamic external connections.

**Third-Party Libraries:**
- Radix UI: Accessible component primitives.
- TanStack Query: Server state synchronization.
- React Hook Form: Form state management.
- Zod: Runtime type validation.
- XLSX: Excel/CSV parsing.
- date-fns: Date utilities.

**Build Tools:**
- Vite, esbuild, TypeScript compiler, PostCSS with Tailwind.