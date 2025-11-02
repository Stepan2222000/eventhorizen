# SMART Inventory Management System

## Overview

This project is an internal inventory tracking system designed to link user-entered article codes with a standardized SMART reference database. It features robust fuzzy matching for article variants, maintains a complete movement history, and calculates current stock levels from transaction deltas. The system includes financial tracking for purchase and sale operations, warehouse tracking (box numbers), and a two-phase sales workflow with shipping integration. A critical business logic ensures stock validation before sales/write-offs, preventing negative stock levels. The system automatically handles schema migrations and is localized entirely in Russian for internal network users. Key capabilities include:

-   Fuzzy matching of article codes to a SMART reference database.
-   Comprehensive movement history and real-time stock level calculation.
-   Financial tracking for purchases and sales, including profitability analytics.
-   Warehouse management with box number tracking.
-   Two-phase sales workflow with shipping integration.
-   Prevention of negative stock through rigorous validation.
-   Advanced analytics for sold-out items and top-performing parts based on profitability, sales volume, and a combined metric.

### Recent Critical Fix (November 2025)
**Array/String Field Handling:** Resolved recurring runtime errors caused by calling `.join()` on fields that could be strings instead of arrays. Applied comprehensive fix across all three files that display ArticleSearchResult data (add-movement.tsx, article-search.tsx, disambiguation-modal.tsx). Changed from conditional rendering with `Array.isArray()` check before the block to inline ternary operator `Array.isArray(field) ? field.join(', ') : field` within the rendering. This ensures robust handling regardless of whether backend returns arrays or strings for brand, articles, and description fields.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
-   React with TypeScript
-   Vite for build tooling
-   Wouter for client-side routing
-   TanStack Query for server state management
-   shadcn/ui component library (Radix UI + Tailwind CSS)
-   React Hook Form with Zod for form management

**UI/UX Decisions:**
-   Component-based architecture with reusable UI primitives.
-   Live article autocomplete with debounced search.
-   Modal-based disambiguation for multiple SMART code matches.
-   Full UI localization in Russian.
-   Compact inline editing for stock details with dual-layer validation.
-   Independent scrolling for long tables within sections to improve visibility.

**Feature Specifications:**
-   Pages for Dashboard, Article Search, Add Movement, Stock Levels, Stock Details (with purchase/sales analytics), Movement History, Sold Items, Sold Out Items, Top Parts Ranking, Bulk Import, and Database Connections.
-   Pre-filling of movement forms from search results via URL parameters.
-   Comprehensive sales analytics on stock details including profitability metrics and cost basis matching.
-   "Sold Out Items" page displaying zero-stock items with sales history.
-   "Top Parts Ranking" page with analytical modes for profitability, sales, and combined performance.

### Backend Architecture

**Technology Stack:**
-   Express.js server with TypeScript (Node.js runtime, ESM modules)
-   Drizzle ORM for local database interactions
-   PostgreSQL database (standard `pg` driver)
-   Multer for file uploads
-   XLSX library for spreadsheet parsing

**System Design Choices:**
-   Repository pattern with storage abstraction.
-   Dual database connection strategy (read-only for SMART, read-write for inventory).
-   Server-side normalization logic for fuzzy article matching (uppercase, delimiter removal, Cyrillic-to-Latin).
-   RESTful API endpoints.
-   Automatic schema migration and seed data on startup.
-   Critical stock validation with `InsufficientStockError` and `SERIALIZABLE` transactions to prevent negative stock.
-   Automatic retry with exponential backoff for serialization conflicts.
-   Batch query methods to optimize database connections for operations like stock level retrieval.

### Data Storage Solutions

**Database Schema (PostgreSQL):**
-   **External SMART Database:** `public.smart` table (read-only) stores SMART codes, article arrays, product names, brands, and metadata.
-   **Inventory Schema:**
    -   `inventory.reasons`: Lookup table for transaction types.
    -   `inventory.movements`: Transaction log for all inventory operations, including financial and logistical details.
    -   `inventory.stock` view: Aggregates movements for current stock levels.
    -   `inventory.shipping_methods`: Stores available shipping methods.
    -   `inventory.db_connections`: Stores database connection credentials.

## External Dependencies

**Database:**
-   PostgreSQL database via standard `pg` driver with connection pooling.
-   Local inventory database (configured via `DATABASE_URL`).
-   External SMART database (e.g., `parts_admin@81.30.105.134:5403`).
-   Drizzle ORM for local database, raw `pg.Pool` for dynamic external connections.

**Third-Party Libraries:**
-   Radix UI: Accessible component primitives.
-   TanStack Query: Server state synchronization.
-   React Hook Form: Form state management.
-   Zod: Runtime type validation.
-   XLSX: Excel/CSV parsing.
-   date-fns: Date utilities.

**Build Tools:**
-   Vite, esbuild, TypeScript compiler, PostCSS with Tailwind.