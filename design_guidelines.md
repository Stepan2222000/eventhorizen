# Design Guidelines: SMART Code Inventory Detail Page

## Design Approach

**Selected System:** Linear + Notion hybrid approach
- Linear's dark mode aesthetic and minimalist data presentation
- Notion's inline editing patterns and table interactions
- Focus on functional clarity over decorative elements

**Core Principles:**
1. Data hierarchy through typography, not color
2. Streamlined editing workflows
3. Scannable information architecture
4. Keyboard-friendly interactions

## Typography System

**Font Family:** Inter (via Google Fonts CDN)
- Primary: Inter for all UI text
- Monospace: JetBrains Mono for SMART codes and numerical data

**Type Scale:**
- Page Title: text-2xl font-semibold (SMART код детализация)
- Section Headers: text-lg font-medium
- Table Headers: text-sm font-medium uppercase tracking-wide
- Body/Data: text-sm font-normal
- Secondary Info: text-xs text-gray-400
- SMART Code Display: text-3xl font-mono font-bold

## Layout Structure

**Spacing System:** Use Tailwind units: 2, 3, 4, 6, 8, 12, 16
- Page padding: p-8
- Section spacing: space-y-6
- Card padding: p-6
- Table cell padding: px-4 py-3
- Inline gaps: gap-3

**Page Layout:**
```
[Header Bar - Full Width]
- Breadcrumb navigation (Главная > Инвентарь > [SMART Code])
- Action buttons aligned right

[Main Content - max-w-7xl mx-auto]
├─ [SMART Code Info Card]
│  ├─ Large SMART code display (monospace, prominent)
│  ├─ Metadata grid: 3-column (Item Name, Category, Status)
│  └─ Quick stats: 4-column (Total Purchases, Avg Price, etc.)
│
└─ [Purchase History Section]
   ├─ Section header with filter/search
   └─ Editable data table
```

## Component Specifications

### SMART Code Header Card
- Background: bg-gray-900 (slightly lighter than page bg-gray-950)
- Border: border border-gray-800
- Rounded: rounded-lg
- Layout: Vertical stack with horizontal metadata grid
- SMART Code: Displayed prominently at top with copy button icon
- Metadata Grid: 3 columns on desktop (grid-cols-3), stack on mobile
- Quick Stats: 4 mini cards in grid-cols-4, each with label + large number

### Purchase History Table
**Table Container:**
- Background: bg-gray-900
- Border: border border-gray-800
- Rounded: rounded-lg
- Overflow: overflow-x-auto for horizontal scroll on mobile

**Table Structure:**
- Header: bg-gray-800 with sticky positioning
- Rows: hover:bg-gray-800/50 transition
- Borders: border-b border-gray-800 between rows
- Columns: Date | Supplier | Quantity | Purchase Price (Editable) | Comments (Editable) | Total | Actions

**Inline Editing Pattern:**
- Default State: Text displays normally, subtle edit icon appears on row hover
- Edit Mode: Click cell to activate inline contentEditable field
- Active Field: bg-gray-800 border-2 border-blue-500 rounded px-2
- Save/Cancel: Auto-save on blur + explicit save/cancel buttons in cell
- Validation: Red border (border-red-500) for invalid inputs

### Interactive Elements

**Buttons:**
- Primary: bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md
- Secondary: bg-gray-800 hover:bg-gray-700 border border-gray-700
- Ghost: hover:bg-gray-800 text-gray-300
- Icon buttons: p-2 rounded-md hover:bg-gray-800

**Input Fields (for inline editing):**
- Background: bg-gray-800
- Border: border border-gray-700 focus:border-blue-500
- Text: text-white placeholder:text-gray-500
- Rounded: rounded-md
- Padding: px-3 py-2

**Badges (for status indicators):**
- Small rounded pills (rounded-full px-2.5 py-0.5 text-xs)
- Use opacity variations of gray for different states

## Data Table Design

**Column Widths:**
- Date: 120px (fixed)
- Supplier: minmax(150px, 1fr)
- Quantity: 100px (fixed, right-aligned)
- Purchase Price: 150px (editable, right-aligned, monospace)
- Comments: minmax(200px, 2fr) (editable)
- Total: 120px (fixed, right-aligned, monospace, bold)
- Actions: 80px (fixed)

**Table Features:**
- Sortable columns (icon in header)
- Row selection checkboxes
- Bulk action toolbar appears when rows selected
- Pagination footer: Showing 1-20 of 150 entries
- Rows per page selector

## Visual Hierarchy

**Card Elevation System:**
- Page background: bg-gray-950
- Primary cards: bg-gray-900 with border-gray-800
- Nested elements: bg-gray-800
- Active/Focus states: bg-gray-800 + blue accent

**Text Hierarchy:**
- Primary text: text-white
- Secondary text: text-gray-300
- Tertiary/metadata: text-gray-400
- Disabled: text-gray-600
- Links: text-blue-400 hover:text-blue-300

## Additional Features

**Top Action Bar:**
- Right-aligned buttons: Export, Add Purchase, Settings
- Search/Filter dropdown for table (left side)
- All use secondary button style

**Empty State (if no purchases):**
- Centered icon + text: "Нет записей о покупках"
- CTA button: "Добавить первую покупку"

**Loading States:**
- Skeleton loaders matching table structure
- Shimmer effect on gray-800 background

**Accessibility:**
- All form inputs have visible labels (even if visually hidden)
- Proper ARIA labels for icon-only buttons
- Focus indicators: ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950
- Keyboard navigation for table (Tab, Enter to edit, Esc to cancel)

## Russian Language Specifics

**Typography Adjustments:**
- Ensure Inter properly renders Cyrillic characters
- Slightly increased line-height: leading-relaxed for readability
- Date format: DD.MM.YYYY (Russian standard)
- Number format: Space as thousands separator (1 000 000,00)

**UI Labels (Examples):**
- Дата покупки, Поставщик, Количество, Цена закупа, Комментарии
- Сохранить, Отменить, Редактировать, Удалить
- Всего записей, Показано

This design creates a professional, efficient dark-mode admin interface optimized for data entry and review workflows.