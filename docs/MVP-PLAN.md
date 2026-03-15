# MVP ERP Rebuild Plan

## Current State

**What's built:**
- Materials CRUD (table, form, create/edit/delete, detail view with lots & stock movements)
- Unified `items` table (materials + products differentiated by `itemType`)
- Unit definitions with inline creation
- Stock tracking via lots + FIFO stock movements
- Auth + org isolation (Better Auth + RLS)
- BOM schema (`bom_components` table — no UI yet)
- Products table page (lists products, reuses `DataTable` — no form/detail yet)

**Architecture established:**
- Drizzle schema → Zod schema (drizzle-zod) → API route (apiHandler) → React Hook Form + TanStack Query
- `withAuthedOrgContext` for all data access (RLS handles org isolation)
- shadcn/ui field system (`Field`/`FieldLabel`/`FieldError`/`FieldGroup`)
- TanStack Table with sorting, search, pagination, bulk delete
- Soft deletes on master data, hard deletes on line items (BOM, order lines)

---

## Design Principles (Enforced Throughout)

### 1. One Pattern Per Concern
Every new feature follows the same file structure and patterns. No special cases.

```
Feature checklist (copy for every new entity):
□ Schema:     lib/db/schema/{entity}.ts (with RLS)
□ Migration:  pnpm drizzle-kit generate && pnpm drizzle-kit migrate
□ Zod:        lib/schemas/{entity}.ts (createInsertSchema + omit/extend)
□ Queries:    app/(dashboard)/{module}/queries.ts (withAuthedOrgContext)
□ API:        app/api/{entity}/route.ts (GET, POST) + [id]/route.ts (PUT, DELETE)
□ Table:      app/(dashboard)/{module}/columns.tsx + data-table.tsx (or reuse shared)
□ Form:       app/(dashboard)/{module}/{entity}/{entity}-form.tsx
□ Pages:      page.tsx (list), new/page.tsx (create), [id]/page.tsx (detail), [id]/edit/page.tsx (edit)
```

### 2. Reuse Before Create
Before writing anything new, check if the current codebase already handles it:
- `items` table already holds materials AND products — extend, don't duplicate
- `DataTable` component already handles sorting/search/pagination — reuse it
- `material-form.tsx` is the form pattern template — copy its structure exactly
- `apiHandler`, `withAuthedOrgContext`, field components — always reuse

### 3. Simplify Aggressively (vs. Old Repo)
What we're **NOT** bringing over:
- **No variants** (master/variant self-reference was the #1 complexity source)
- **No batch recipes** (isBatchRecipe, expectedYield — post-MVP)
- **No maintenance module** (separate concern entirely)
- **No integrations** (Xero/QB — manual CSV import is sufficient)
- **No mobile app** (responsive web covers 80% of field use)
- **No AI features** (chat, sync agent — post-MVP)
- **No pricing tiers** (simple flat pricing per product)
- **No BOM constraints** (lot age filtering — post-MVP)
- **No stocktakes** (physical count workflow — post-MVP)
- **No vertical configuration** (hardcode for soil vertical)
- **No multi-schema DB design** (single `inventory` schema + `system` for auth)

### 4. Flat Over Nested
- No inheritance hierarchies (variant → parent, linked operations)
- No sub-assemblies in manufacturing orders
- Tables reference each other directly — no intermediate mapping tables unless truly needed

### 5. Consistent Error Handling
- API: `{ errors: { fieldName: ["messages"] } }` for validation, `{ error: "message" }` for other
- Forms: inline field errors via `<FieldError>`, no toasts for validation
- Mutations: `isPending` for loading, no optimistic updates

---

## Implementation Phases

### Phase 1: Complete Inventory Foundation
**Goal:** Products CRUD + BOM editor — complete the inventory module.

#### Step 1.1 — Product Form
Products already live in the `items` table with `itemType: "product"`. The products table page already works. We need:

- **`product-form.tsx`** — copy `material-form.tsx` structure, adjust fields:
  - Same fields: name, SKU, category (combobox), unit, stock, description
  - Add: `defaultSellingPrice` (materials have `defaultPurchasePrice`, products have both)
  - Unit field: same Select with inline creation
- **`products/new/page.tsx`** — create page (mirrors `materials/new/page.tsx`)
- **`products/[id]/page.tsx`** — detail page (mirrors `materials/[id]/page.tsx`)
- **`products/[id]/edit/page.tsx`** — edit page (mirrors `materials/[id]/edit/page.tsx`)
- **No new schema/API needed** — products use the same `items` table and `/api/items` endpoints

**Complexity check:** This step should feel almost copy-paste. If it doesn't, something is wrong.

#### Step 1.2 — BOM Editor
The `bom_components` table exists. We need UI to manage it.

- **`app/api/bom/route.ts`** — GET (by parentItemId), POST (create component)
- **`app/api/bom/[id]/route.ts`** — PUT (update qty/percentage), DELETE (hard delete)
- **`lib/schemas/bom.ts`** — Zod schema for bom_components
- **BOM queries in `inventory/queries.ts`** — `getBomComponents(parentItemId)`, `createBomComponent()`, etc.
- **BOM section on product detail page** — table of components with inline add/edit/remove
  - Each row: component name (select from all items), quantity OR percentage, unit, sort order
  - Add row button, delete per row
  - No drag-to-reorder needed — sort order as numeric field is fine

**Key simplification vs old repo:** BOM is flat (no sub-assemblies, no constraints, no packaging type). A product has components. Each component is an item (material or product) with a quantity. That's it.

#### Step 1.3 — Inventory Header & Navigation Polish
- **Sidebar navigation** — ensure Inventory section has: Materials, Products as sub-links
- **`inventory-header.tsx`** — tab-style navigation between Materials and Products (already partially exists)
- **Breadcrumbs** on detail/edit pages for context

---

### Phase 2: Sales Module
**Goal:** Customers + Sales Orders — the core revenue workflow.

#### Step 2.1 — Customers
New entity, new schema. Follow the pattern exactly.

**Schema (`lib/db/schema/customers.ts`):**
```
customers table:
  id, organizationId, name, phone, email, address, city, state, zip,
  notes, paymentTermsDays, taxExempt, deletedAt, createdAt, updatedAt
```
- RLS policy on organizationId
- Soft delete

**Files to create:**
- `lib/db/schema/customers.ts` — table + RLS
- `lib/schemas/customers.ts` — Zod insert/update schemas
- `app/api/customers/route.ts` — GET (list), POST (create)
- `app/api/customers/[id]/route.ts` — GET (detail), PUT, DELETE (soft)
- `app/(dashboard)/sales/customers/page.tsx` — list
- `app/(dashboard)/sales/customers/new/page.tsx` — create
- `app/(dashboard)/sales/customers/[id]/page.tsx` — detail
- `app/(dashboard)/sales/customers/[id]/edit/page.tsx` — edit
- `app/(dashboard)/sales/customers/customer-form.tsx` — shared form
- `app/(dashboard)/sales/customers/queries.ts` — data access
- `app/(dashboard)/sales/customers/columns.tsx` — table columns
- `app/(dashboard)/sales/customers/data-table.tsx` — or reuse shared component

**Key simplification:** No pricing tiers per customer. No tax exempt validation. Just contact info + payment terms.

#### Step 2.2 — Sales Orders
This is the most complex feature. Keep it simple.

**Schema (`lib/db/schema/sales-orders.ts`):**
```
salesOrders table:
  id, organizationId, orderNumber (auto-generated), customerId (FK),
  status (quote | confirmed | fulfilled | cancelled),
  fulfillmentDate, fulfillmentNotes,
  totalAmount, deletedAt, createdAt, updatedAt

salesOrderItems table:
  id, salesOrderId (FK, cascade), itemId (FK → items),
  quantity, unitPrice, lineTotal,
  createdAt, updatedAt
```
- RLS on salesOrders via organizationId
- RLS on salesOrderItems via subquery on parent salesOrder
- Hard delete on salesOrderItems (line items)
- Auto-increment order number per org

**Files to create:**
- Schema, Zod schemas, API routes, pages, form, queries, columns — same pattern as customers
- **Order form** is the complex part:
  - Customer select (combobox from customers list)
  - Line items: dynamic array of rows (item select, quantity, unit price, line total)
  - Use `useFieldArray` from react-hook-form for line items
  - Auto-calculate `lineTotal = quantity × unitPrice` and `totalAmount = sum(lineTotals)`
  - Status field (select)
  - Fulfillment date (date input) + notes (textarea)

**Key simplifications vs old repo:**
- No fulfillment distance/pricing calculation
- No labor cost tracking
- No margin calculation
- No fulfillment records (picking/loading workflow) — just a status change
- No weight tickets or delivery manifests
- No variant support on line items
- Line totals are simple: qty × price. No discount tiers.

#### Step 2.3 — Sales Dashboard Summary
- Add a `/dashboard` page or section showing:
  - Open orders count
  - Total revenue (confirmed + fulfilled orders)
  - Recent orders list (last 10)
- Keep it minimal — no charts, no real-time updates

---

### Phase 3: Purchasing Module
**Goal:** Suppliers + Purchase Orders — the core procurement workflow.

#### Step 3.1 — Suppliers
Mirror the customers pattern exactly.

**Schema (`lib/db/schema/suppliers.ts`):**
```
suppliers table:
  id, organizationId, name, contactName, email, phone,
  address, city, state, zip, notes, paymentTermsDays,
  deletedAt, createdAt, updatedAt
```

Same file structure as customers. Copy, rename, adjust fields.

#### Step 3.2 — Purchase Orders
Mirror the sales orders pattern but for inbound.

**Schema (`lib/db/schema/purchase-orders.ts`):**
```
purchaseOrders table:
  id, organizationId, poNumber (auto-generated), supplierId (FK),
  status (draft | ordered | received | cancelled),
  orderDate, expectedDate,
  totalAmount, deletedAt, createdAt, updatedAt

purchaseOrderItems table:
  id, purchaseOrderId (FK, cascade), itemId (FK → items),
  quantityOrdered, quantityReceived, unitCost,
  createdAt, updatedAt
```

**Key addition:** When a PO is marked as received:
- For each PO item, create a lot in the `lots` table (reuse existing lot system)
- Create stock movements (reuse existing `adjustStockInTx` pattern)
- This connects purchasing to inventory automatically

**Key simplifications vs old repo:**
- No receiving queue (separate table) — receiving is a status change on the PO
- No partial receiving workflow — receive all at once (partial can be added later)
- No payment tracking fields — just status
- No material variant support

---

### Phase 4: Manufacturing Module
**Goal:** Simple manufacturing orders — turn materials into products.

#### Step 4.1 — Manufacturing Orders (Basic)
**Schema (`lib/db/schema/manufacturing-orders.ts`):**
```
manufacturingOrders table:
  id, organizationId, moNumber (auto-generated), productId (FK → items),
  salesOrderId (FK → salesOrders, nullable),
  status (draft | in_progress | completed | cancelled),
  plannedQuantity, actualQuantity,
  plannedStartDate, completedAt,
  notes, deletedAt, createdAt, updatedAt

moIngredients table:
  id, manufacturingOrderId (FK, cascade), itemId (FK → items),
  plannedQuantity, actualQuantity,
  createdAt, updatedAt
```

**Workflow:**
1. Create MO → select product → auto-populate ingredients from BOM
2. Start MO → status changes to `in_progress`
3. Complete MO → deduct materials from stock (create stock movements), add finished product to stock
4. Cancel MO → no stock changes

**Key simplifications vs old repo:**
- No batches within an MO (single batch per order)
- No operations/work steps (just materials in → product out)
- No sub-assemblies
- No resource assignment
- No yield tracking or waste calculation
- No pick status per ingredient
- Ingredients auto-populated from BOM, editable before starting

#### Step 4.2 — MO ↔ Sales Order Link
- When creating an MO, optionally link to a sales order
- Display linked MOs on sales order detail page
- No auto-creation of MOs from sales orders (manual only)

---

### Phase 5: Polish & Usability
**Goal:** Make it feel complete and usable.

#### Step 5.1 — Dashboard
- `/dashboard` as the landing page after login
- Cards showing: total materials, total products, open sales orders, open POs, active MOs
- Each card links to the respective list page
- Keep it simple — counts and recent activity, no charts

#### Step 5.2 — Sidebar Navigation
Finalize the navigation structure:
```
Dashboard
Inventory
  ├── Materials
  └── Products
Sales
  ├── Orders
  └── Customers
Purchasing
  ├── Orders
  └── Suppliers
Manufacturing
  └── Orders
```

#### Step 5.3 — Cross-Entity Links
- Product detail → shows BOM components
- Product detail → shows MOs that produce this product
- Customer detail → shows their sales orders
- Supplier detail → shows their purchase orders
- Sales order detail → shows linked MOs
- Material/product detail → shows lots and stock movements (already done)

#### Step 5.4 — CSV Import/Export
- Export any table to CSV (generic utility)
- Import materials, products, customers, suppliers from CSV
- Simple mapping UI or fixed column format
- Reuse the Zod schemas for validation during import

---

## Entity Dependency Order

This is the order entities must be built — each step depends on the previous.

```
1. Products       (uses existing items table — no new deps)
2. BOM            (depends on: items/products)
3. Customers      (standalone)
4. Sales Orders   (depends on: customers, items)
5. Suppliers      (standalone)
6. Purchase Orders (depends on: suppliers, items, lots)
7. Manufacturing   (depends on: items, BOM, lots, optionally sales orders)
8. Dashboard       (depends on: all above for counts/summaries)
```

Steps 3+5 (Customers + Suppliers) are independent and can be built in parallel.

---

## What Each Phase Adds to the Data Model

```
Phase 1 (Inventory):    [existing tables] + BOM UI
Phase 2 (Sales):        + customers, salesOrders, salesOrderItems
Phase 3 (Purchasing):   + suppliers, purchaseOrders, purchaseOrderItems
Phase 4 (Manufacturing):+ manufacturingOrders, moIngredients
Phase 5 (Polish):       no new tables — UI/UX only
```

**Total new tables: 8** (vs. 49 in the old repo)

---

## Architectural Guardrails

### Before starting any step, verify:
1. **Does the schema follow the RLS pattern?** Check against `lib/db/schema/items.ts`
2. **Is the Zod schema derived from Drizzle?** Use `createInsertSchema()` from drizzle-zod
3. **Does the API route use `apiHandler`?** All mutation routes must
4. **Does the form match the material-form pattern?** Same field system, same submission flow
5. **Are query keys consistent?** Follow `["entity", filterOrId]` pattern
6. **Is the table reusing `DataTable` or following its pattern?** No custom table implementations
7. **Are there any hardcoded colors?** Only shadcn semantic tokens
8. **Is the icon from HugeIcons?** Never Lucide

### After completing any step, verify:
1. `pnpm build` passes (catches type errors)
2. Create, read, update, soft-delete all work end-to-end
3. Data is org-isolated (test with RLS — no cross-org leaks)
4. Form validation shows inline errors on invalid input
5. Table sorting, search, and pagination work
6. Navigation between list ↔ detail ↔ edit flows smoothly

---

## Post-MVP Roadmap (Not In Scope)

These features are intentionally deferred. Do not build them during MVP phases.

| Feature | Why Deferred | When to Add |
|---------|-------------|-------------|
| Product variants | #1 complexity source in old repo | When a customer explicitly needs it |
| Batch recipes & yield | Manufacturing complexity | When basic MO is proven |
| Maintenance module | Separate domain entirely | When equipment tracking is requested |
| Xero/QB integration | Manual data entry works for MVP | When volume justifies automation |
| Mobile app | Responsive web covers field use | When offline-first is needed |
| Pricing tiers | Flat pricing per product is sufficient | When customers need volume discounts |
| Stocktakes | Manual adjustments work for now | When inventory accuracy is critical |
| BOM constraints | Lot age filtering is niche | When QC requirements emerge |
| Operations/resources | Simple MO is materials-in, product-out | When production scheduling is needed |
| Audit log | created/updated timestamps are enough | When compliance requires it |
| Role permissions | Admin/user is enough for MVP | When team size exceeds ~5 |
| AI features | Not core ERP | When differentiation matters |
| Fulfillment workflow | Status change on SO is enough | When delivery tracking is needed |
| Sub-assembly MOs | Flat manufacturing is sufficient | When multi-step production exists |
| Reports/analytics | SQL queries or CSV export cover it | When recurring reports are needed |
