# SMART Inventory Management System

## Overview

This project is an internal inventory tracking system designed to link user-entered article codes with a standardized SMART reference database. It features robust fuzzy matching for article variants, maintains a complete movement history, and calculates current stock levels from transaction deltas. The system also includes financial tracking for purchase and sale operations, warehouse tracking (box numbers), and a two-phase sales workflow with shipping integration. A critical business logic ensures stock validation before sales/write-offs, preventing negative stock levels. The system automatically handles schema migrations and is localized entirely in Russian for internal network users.

### Recent Fixes (November 2025)
- **Autofill Fixed**: URL parameter autofill now correctly uses `window.location.search` instead of wouter's location (which doesn't include query strings). Article and SMART code fields are automatically populated when navigating from search results.
- **Complete E2E Workflow Validated**: Full purchase → sale → sold items page workflow tested and working correctly with all financial fields, shipping tracking, and status management.
- **Stock Aggregation Fixed**: inventory.stock VIEW now correctly groups by SMART code only (not SMART+article), eliminating duplicate rows and summing quantities across all article variants.
- **Zero Quantity Validation**: Added frontend and backend validation to prevent movements with qty_delta = 0. Error message displays below quantity field.
- **Negative Stock Prevention**: getCurrentStock method now checks total by SMART code (not by article) to prevent overselling across all article variants.

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