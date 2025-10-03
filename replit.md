# SMART Inventory Management System

## Overview

This is an internal inventory tracking system that links user-entered article codes to a standardized SMART reference database. The system handles fuzzy matching of article variants (different cases, delimiters, Cyrillic/Latin lookalikes) and maintains a complete movement history with current stock levels calculated from transaction deltas.

## Recent Changes

**October 3, 2025 - Article Autocomplete in Movement Form:**
- ✅ **Live Autocomplete**: Real-time article suggestions appear as user types (min 2 characters)
- ✅ **Debounced Search**: 300ms debounce prevents excessive API calls during typing
- ✅ **Popover UI**: Results displayed in sleek dropdown using Radix Popover + Command components
- ✅ **Rich Results Display**: Shows article codes, SMART codes, and product names in suggestions
- ✅ **Auto SMART Fill**: Selecting a suggestion automatically fills both article and SMART code fields
- ✅ **Memory Safe**: Proper cleanup on component unmount prevents memory leaks
- ✅ **Keyboard Navigation**: Escape to close, Enter for manual search still works
- ✅ **Full Test Coverage**: e2e tests verify autocomplete flow with real database data

**October 3, 2025 - Auto-Fill Movement Form from Search Results:**
- ✅ **URL Parameter Passing**: "Добавить движение" button passes smart code and article via URL query params (?smart=X&article=Y)
- ✅ **Form Auto-Fill**: AddMovement page reads URL params and auto-fills form using form.reset() for reliable initialization
- ✅ **User Intent Preservation**: Passes original search query (searchQuery) instead of first array element to preserve user input
- ✅ **SMART Field Protection**: Locked SMART input against manual edits via onKeyDown/onPaste preventDefault while allowing programmatic updates
- ✅ **XSS Prevention**: Toast messages use static content to prevent XSS via URL parameters
- ✅ **Single Toast**: hasPrefilled flag ensures toast notification appears only once per navigation
- ✅ **Full Test Coverage**: e2e tests verify complete flow from search → selection → auto-filled form → movement creation

**October 3, 2025 - UI Improvements & Navigation Fix:**
- ✅ **Article Display**: Fixed article text wrapping in search results (flex-col layout with break-words)
- ✅ **Navigation Buttons**: Added working onClick handlers for "Добавить движение" and history buttons
- ✅ **Route Correction**: Fixed navigation routes to match App.tsx (/movement and /history instead of /add-movement and /movements)
- ✅ **Modal Enhancements**: Added scrollable area (max-h-50vh) and compact card sizing to disambiguation modal
- ✅ **Full Test Coverage**: Verified search, navigation, movement creation, and history display work correctly

**October 3, 2025 - Database Driver Migration & Connection Fix:**
- ✅ **PostgreSQL Driver Migration**: Replaced all Neon serverless driver (`neon()`) with standard `pg.Pool` for compatibility with regular PostgreSQL servers
- ✅ **External Database Connection**: Fixed connection to parts_admin@81.30.105.134:5403 (corrected port from 5432 to 5403, username from parts_admin to admin)
- ✅ **Field Mapping Correction**: Fixed articles field mapping from "оригинальность" to "артикул" (VARCHAR array)
- ✅ **Query Optimization**: Changed from `jsonb_array_elements_text()` to `unnest()` for VARCHAR array handling
- ✅ **Partial Search**: Implemented partial matching with LIKE for user-friendly article search (e.g., "5VX" finds "5VX-25806-00-00")
- ✅ **Auto Schema Creation**: System automatically creates inventory schema in external database on startup
- ✅ **Full Test Coverage**: Comprehensive e2e tests verify search, disambiguation, movement creation, and stock tracking

**Earlier - External Database Integration:**
- ✅ **Removed Mock Data**: Deleted all test SMART codes and movements - system now uses ONLY real data from connected databases
- ✅ **External SMART Connection**: All SMART lookups now use active configured external database with field mapping
- ✅ **Default Connections**: System creates default connections automatically to parts_admin database
- ✅ **Dynamic Field Mapping**: searchSmart/getSmartByCode methods dynamically adapt to configured field names
- ✅ **Stock Enrichment**: Stock levels fetch metadata from configured SMART connection instead of local JOIN

**October 2, 2025 - Critical Bug Fixes:**
- ✅ **Auto SMART Lookup**: Added automatic SMART code search when adding movements - users now only enter the article, system finds SMART code automatically
- ✅ **Disambiguation Modal**: Integrated modal dialog for selecting from multiple SMART matches
- ✅ **Stale Data Protection**: Implemented safeguards to prevent article/SMART mismatches when user edits article field
- ✅ **Race Condition Handling**: Added logic to ignore outdated search results when article changes during async lookup
- ✅ **Full Test Coverage**: Comprehensive e2e tests verify all scenarios (single match, multiple matches, no matches, normalization)

## User Preferences

Preferred communication style: Simple, everyday language.

## Interface Language

The entire user interface is in Russian (ru-RU), including:
- Navigation menu (Sidebar): Главная, Поиск артикулов, Добавить движение, Остатки, История движений, Массовая загрузка, Подключения БД
- Page titles, descriptions, and instructions
- Form labels and placeholders
- Button labels and actions
- Table headers and status indicators
- Toast notifications and error messages
- Modal dialogs and confirmations

This localization ensures the system is accessible for Russian-speaking users in the internal network.

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
- Database Connections: Manage connections to external PostgreSQL databases

### Backend Architecture

**Technology Stack:**
- Express.js server with TypeScript
- Node.js runtime using ESM modules
- Drizzle ORM for database interactions
- PostgreSQL database (standard `pg` driver with connection pooling)
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
- `GET /api/db-connections` - List database connections (passwords excluded)
- `POST /api/db-connections` - Create new database connection
- `DELETE /api/db-connections/:id` - Delete database connection
- `POST /api/db-connections/test` - Test database connection
- `POST /api/db-connections/:id/tables` - Get tables from database connection

### Data Storage Solutions

**Database Schema (PostgreSQL):**

*External SMART Database (parts_admin@81.30.105.134:5403 - Read Only):*
- `public.smart` table: 
  - `smart` (VARCHAR(15), PRIMARY KEY) - SMART reference code
  - `артикул` (VARCHAR(20)[]) - Array of article codes
  - `наименование` (VARCHAR(100)) - Product name
  - `бренд` (VARCHAR(15)[]) - Array of brands
  - `коннект_бренд` (VARCHAR(15)[]) - Array of connector brands
  - Additional fields: оригинальность, тип_транспорта, область_применения, вес, объем, коннект_артикул
- Field mapping configured via db_connections table (articles → артикул, name → наименование, etc.)
- Used as reference data only; not modified by application

*Inventory Schema (Read-Write):*
- `inventory.reasons` table: Fixed lookup table with `code` (PK) and `title` for transaction types (purchase, sale, return, adjust, writeoff)
- `inventory.movements` table: Transaction log with auto-incrementing `id`, `smart` code, original `article` as entered, `qty_delta` (±integer), `reason` code, optional `note`, and `created_at` timestamp
- `inventory.stock` view (computed): Aggregates movements by `(article, smart)` to calculate current quantities
- `inventory.db_connections` table: Database connection credentials with `id` (PK), `name`, `host`, `port`, `database`, `username`, `password` (stored but never exposed to frontend), optional `ssl` mode, and timestamps

**Normalization Strategy:**
- Normalization applied only for search/matching, never stored
- Three-step process: uppercase conversion → delimiter removal → Cyrillic-to-Latin character mapping
- Original user input preserved in database for traceability
- SQL query uses `unnest()` with regex-based normalization for matching VARCHAR arrays
- Partial matching enabled: search "5VX" finds articles like "5VX-25806-00-00"

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
- PostgreSQL database via standard `pg` driver with connection pooling
- Local inventory database via `DATABASE_URL` environment variable
- External SMART database at parts_admin@81.30.105.134:5403
- Drizzle ORM for type-safe queries on local database
- Raw `pg.Pool` for dynamic connections to external databases

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