# SMART Inventory Management System

## Overview

This is an internal inventory tracking system that links user-entered article codes to a standardized SMART reference database. The system handles fuzzy matching of article variants (different cases, delimiters, Cyrillic/Latin lookalikes) and maintains a complete movement history with current stock levels calculated from transaction deltas.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript
- Vite for build tooling and development server
- Wouter for client-side routing
- TanStack Query (React Query) for server state management
- shadcn/ui component library built on Radix UI primitives
- Tailwind CSS for styling with custom design tokens

**Key Design Patterns:**
- Component-based architecture with reusable UI primitives
- Form management using React Hook Form with Zod validation
- Centralized query client with custom fetch wrappers
- Toast notifications for user feedback
- Modal-based disambiguation when multiple SMART codes match a search

**Page Structure:**
- Dashboard: Overview of inventory stats and recent activity
- Article Search: Fuzzy search interface with disambiguation workflow
- Add Movement: Form for recording inventory transactions
- Stock Levels: Current inventory view aggregated from movements
- Movement History: Complete transaction log
- Bulk Import: Excel/CSV file upload for batch operations

### Backend Architecture

**Technology Stack:**
- Express.js server with TypeScript
- Node.js runtime using ESM modules
- Drizzle ORM for database interactions
- PostgreSQL database (Neon serverless driver)
- Multer for file upload handling
- XLSX library for spreadsheet parsing

**Key Design Patterns:**
- Repository pattern with storage abstraction (IStorage interface)
- Dual database connection strategy (read-only for SMART reference, read-write for inventory)
- Server-side normalization logic for fuzzy article matching
- RESTful API endpoints following resource-based routing
- Database initialization on startup with seed data

**API Structure:**
- `GET /api/articles/search?query={article}` - Fuzzy search for SMART codes
- `GET /api/smart/:code` - Retrieve SMART reference details
- `POST /api/movements` - Record inventory movement
- `GET /api/movements` - List movement history
- `GET /api/stock` - Current stock levels (aggregated view)
- `POST /api/bulk-import` - Process CSV/Excel uploads
- `GET /api/reasons` - List valid movement reason codes
- `GET /api/dashboard/stats` - Summary statistics

### Data Storage Solutions

**Database Schema (PostgreSQL):**

*Public Schema (SMART Reference - Read Only):*
- `smart` table: Primary key `smart` (VARCHAR), JSONB array of `articles`, optional `name`, `brand`, `description` fields
- Used as reference data only; not modified by application

*Inventory Schema (Read-Write):*
- `inventory.reasons` table: Fixed lookup table with `code` (PK) and `title` for transaction types (purchase, sale, return, adjust, writeoff)
- `inventory.movements` table: Transaction log with auto-incrementing `id`, `smart` code, original `article` as entered, `qty_delta` (±integer), `reason` code, optional `note`, and `created_at` timestamp
- `inventory.stock` view (computed): Aggregates movements by `(article, smart)` to calculate current quantities

**Normalization Strategy:**
- Normalization applied only for search/matching, never stored
- Three-step process: uppercase conversion → delimiter removal → Cyrillic-to-Latin character mapping
- Original user input preserved in database for traceability
- SQL query uses jsonb_array_elements_text with regex-based normalization for matching

**Data Flow:**
1. User enters article → normalized for search
2. System queries SMART table with normalized comparison
3. If unique match found, movement recorded with original article text
4. Stock levels calculated on-demand from movements table sum

### Authentication and Authorization

**Access Control:**
- No authentication implemented (internal network assumption)
- All endpoints publicly accessible
- Validation focused on data integrity rather than user permissions

### External Dependencies

**Database:**
- PostgreSQL database via Neon serverless driver (`@neondatabase/serverless`)
- Connection via `DATABASE_URL` environment variable
- Drizzle ORM for type-safe queries
- Production setup would use separate database instances for `parts_admin` (port 5403) and `ebay_admin` (port 5405)

**Third-Party Libraries:**
- Radix UI: Comprehensive set of accessible component primitives
- TanStack Query: Server state synchronization and caching
- React Hook Form: Form state management
- Zod: Runtime type validation and schema definition
- XLSX: Excel/CSV file parsing for bulk imports
- date-fns: Date formatting and manipulation

**Build Tools:**
- Vite: Fast development server with HMR
- esbuild: Production bundling for server code
- TypeScript compiler: Type checking without emission
- PostCSS with Tailwind: CSS processing pipeline

**Development Tools (Replit-specific):**
- `@replit/vite-plugin-runtime-error-modal`: Error overlay
- `@replit/vite-plugin-cartographer`: Code mapping
- `@replit/vite-plugin-dev-banner`: Development banner