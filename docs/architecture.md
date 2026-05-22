---
read_when:
  - Planning a new feature or module
  - Understanding the data flow or layer rules
  - Deciding where to put new code
  - Onboarding to the codebase for the first time
---

# Architecture

## Module Map

The ERP is built module by module. Current and planned domains:

| Module | Status | Description |
|--------|--------|-------------|
| Materials | Active | Raw inputs — purchased items tracked by lot, UOM, and SKU |
| Products | Active | Manufactured outputs — defined by a BOM of materials |
| BOM (Bill of Materials) | Active | Lines linking a product to its component materials with quantities |
| Manufacturing Orders | Active | Draft/release/complete workflow with BOM snapshots, expected-qty recompute, FIFO consumption, and produced lots |
| Sales Orders | Active | Multi-line customer orders with snapshots, soft delete, and committed-qty updates on confirmation |
| Customers | Active | Sales customer master data |
| Purchase Orders | Active | Draft/order/receive workflow for material purchasing with lot-backed receiving |
| Suppliers | Active | Purchasing supplier master data |
| Stocktakes | Active | Inventory-native snapshot/reconciliation workflow with count entry and stocktake adjustment movements |

> When pulling logic from the old repo (`/home/aeller/Projects/soil-erp`), take only the data model and business logic. Rewrite all UI to match current patterns.

## Data Flow

```
Page component
  → TanStack Query (useQuery / useMutation)
    → fetch to API route (app/api/...)
      → apiHandler wrapper (lib/api/handler.ts)
        → DAL query function (app/(dashboard)/inventory/queries.ts)
          → withAuthedOrgContext (lib/dal/auth.ts)
            → withOrgContext sets RLS (lib/db/with-org-context.ts)
              → Drizzle ORM query
                → Neon Postgres
```

**Read path**: page → useQuery → GET route → DAL → DB
**Write path**: form submit → useMutation → POST/PATCH/DELETE route → apiHandler → DAL → DB → invalidate query

## Layer Rules

| Layer | Can import from | Cannot import from |
|-------|----------------|--------------------|
| Pages / components | hooks, lib/schemas, lib/utils | lib/db, lib/dal directly |
| API routes | lib/api/handler, lib/schemas, DAL queries | lib/db directly |
| DAL query functions | lib/db (via withAuthedOrgContext tx) | — |
| lib/schemas | lib/db/schema (for createInsertSchema) | DAL, API |

## Key File Locations

| Concern | Path |
|---------|------|
| API routes | `app/api/` |
| DAL queries (inventory) | `app/(dashboard)/inventory/queries.ts` |
| DAL queries (sales) | `app/(dashboard)/sales/queries.ts` |
| DAL queries (manufacturing) | `app/(dashboard)/manufacturing/queries.ts` |
| DAL queries (purchasing) | `app/(dashboard)/purchasing/queries.ts` |
| DAL queries (stocktakes) | `app/(dashboard)/inventory/stocktakes/queries.ts` |
| DAL auth wrapper | `lib/dal/auth.ts` |
| RLS org context setter | `lib/db/with-org-context.ts` |
| Drizzle schemas | `lib/db/schema/` |
| Zod schemas | `lib/schemas/` |
| API handler wrapper | `lib/api/handler.ts` |
| shadcn component config | `components.json` |
| Canonical form example | `app/(dashboard)/inventory/materials/material-form.tsx` |
| Canonical table example | `app/(dashboard)/inventory/data-table.tsx` |
| Sales form example | `app/(dashboard)/sales/order-form.tsx` |
| Sales table example | `app/(dashboard)/sales/orders-table.tsx` |
| Manufacturing form example | `app/(dashboard)/manufacturing/manufacturing-order-form.tsx` |
| Manufacturing table example | `app/(dashboard)/manufacturing/orders-table.tsx` |
| Purchasing card example | `app/(dashboard)/purchasing/purchase-order-card.tsx` |
| Purchasing table example | `app/(dashboard)/purchasing/orders-table.tsx` |

## Variant Families

Variant products use one identity model:

- `inventory.item_families` owns the family/card name, category, description, and unit.
- `inventory.variant_options` and `inventory.variant_option_values` define the option set.
- `inventory.item_variant_values` assigns concrete option values to operational `items.id` rows.
- user-facing variant titles are derived from the family name plus normalized option labels.

Do not expose a freeform variant name in create or edit flows. Operational references keep using concrete `items.id` values.
