# Stock Adjustments Design

## Problem

The lot tracking feature established lots as the source of truth for stock, but there's no way to change stock levels after initial item creation. Users need to adjust stock up or down for corrections, returns, write-offs, and initial counts — with every change recorded in an audit trail.

## Decisions

- **"Set the truth" model.** Inspired by MRPeasy: the user edits the stock quantity to what it should be. The system computes the delta and reconciles lots automatically. No add/remove toggle, no lot picking.
- **Stock is a field on the edit form.** No separate dialog. The user edits the material, changes the stock value, picks a reason, and saves. The form handles both metadata updates and stock adjustments in one transaction.
- **Positive delta → new lot.** Always creates a new lot. Existing lots are never inflated — they represent discrete receipts. This follows MRPeasy's rule: "lots are technical objects with a discrete source."
- **Negative delta → FIFO write-off.** Deducts from lots ordered by `receivedAt` ascending. Oldest stock consumed first. Lots that hit 0 are kept (historical record, not deleted).
- **Every stock change creates an audit record.** A new `stock_movements` table logs every adjustment. Movements are immutable (append-only).
- **userId tracked on every movement.** `createdBy` column references the authenticated user.
- **Item creation also logs a movement.** `createItemWithLot` is extended to insert a movement with reason `initial` when `initialStock > 0`.
- **Reasons are a closed enum.** `adjustment`, `initial`, `return`, `write_off`. More reasons (e.g. `purchase`, `sales`) added when PO/SO features land.
- **Cost/unit on increases only.** When stock increases, user can enter a cost/unit. If left blank, defaults to the material's `defaultPurchasePrice`. Field hidden when stock decreases (or stays the same).
- **No cached `inStock` column.** Stock continues to be computed from `SUM(lots.quantity)`. No denormalized column to keep in sync.

## Schema

### `stock_movements` table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, default random |
| `organizationId` | text | NOT NULL, RLS |
| `itemId` | UUID | NOT NULL, FK → items |
| `lotId` | UUID | nullable, FK → lots |
| `quantity` | numeric(12,4) | NOT NULL (positive for add, negative for remove) |
| `reason` | varchar(30) | NOT NULL — `adjustment`, `initial`, `return`, `write_off` |
| `costPerUnit` | numeric(10,4) | nullable |
| `notes` | text | nullable |
| `createdBy` | text | NOT NULL — user ID from session |
| `createdAt` | timestamp | NOT NULL, default now() |

**Indexes:**
- Index: `(itemId)` — fast lookup by item for movement history
- Index: `(createdAt)` — chronological ordering
- RLS policy: `organization_id = current_setting('app.current_org_id', true)`

**Not included (deferred):**
- `referenceType` / `referenceId` — for PO/SO links, added when those features land
- `locationId` — for multi-location, added later

### No changes to `lots` or `items` tables

The existing lots schema is sufficient. Adjustments mutate `lots.quantity` directly (for decreases) or create new lots (for increases). Items table is unchanged.

## Data Flow

### Stock edit (via material edit form)

1. User opens the edit form. A read-only "Current Stock" display shows the computed value. An editable "New Stock" field defaults to the current value.
2. User changes the stock value, selects a reason. If increasing, optional cost/unit and notes fields appear.
3. On submit, the API receives both the material metadata updates and stock adjustment fields.
4. Inside a single `withAuthedOrgContext` transaction:
   a. Update item metadata (name, SKU, etc.) — same as today
   b. Compute delta = newStock - currentStock
   c. If delta > 0 (increase):
      - Generate next lot number (`LOT-NNNNNN`)
      - Create new lot: quantity = delta, costPerUnit = user-provided or `defaultPurchasePrice`
      - Insert `stock_movements` row (positive quantity, lotId = new lot)
   d. If delta < 0 (decrease):
      - Get lots ordered by `receivedAt` ASC where `quantity > 0`
      - Walk lots oldest-first, deducting until abs(delta) is consumed
      - If total available < abs(delta): **roll back entire transaction**, return error
      - Insert one `stock_movements` row per lot touched (negative quantity, with each lotId)
   e. If delta = 0: no lot/movement changes, just metadata update
5. Transaction commits atomically. If stock adjustment fails, metadata changes also roll back.

### Item creation (initial stock)

Extend `createItemWithLot` to also insert a movement:
1. (existing) Create item + lot in transaction
2. (new) If `initialStock > 0`, insert `stock_movements` with reason `initial`, quantity = initialStock, lotId = new lot, createdBy = userId

## UI

### Edit form changes

The material edit form gains a "Stock" section (only in edit mode — create form keeps `initialStock` as-is):

```
┌──────────────────────────────────────┐
│  Edit Material                       │
│                                      │
│  Name *            [Concrete Mix  ]  │
│  SKU               [MAT-001      ]  │
│  Category          [Raw Material ▾]  │
│  Purchase Price    [24.50        ]  │
│                                      │
│  ── Stock ──────────────────────     │
│  Current Stock     45.5    ← read-only
│  New Stock *       __________        │
│  Reason *          [Adjustment  ▾]   │  ← only visible when stock changes
│  Cost / Unit       __________        │  ← only visible when increasing
│  Notes             __________        │  ← only visible when stock changes
│                                      │
│                    [Cancel] [Save]    │
└──────────────────────────────────────┘
```

**Behavior:**
- "Current Stock" is a read-only display of the computed `inStock` value
- "New Stock" defaults to current stock value. Editing it reveals reason/notes fields
- If new > current: cost/unit field appears (optional, defaults to purchase price)
- If new < current: cost/unit hidden
- If new = current: reason/notes fields stay hidden
- Reason dropdown: `Adjustment` (default), `Return`, `Write-off`. (`Initial` is system-only, not in the dropdown.)

**Validation:**
- New Stock: required, must be >= 0
- Reason: required when stock changes
- Decrease: total available across lots must be >= decrease amount (server-side, returns form error)

### Stock Movement History

New section on the material detail page, below the existing Lots table.

**Table columns:**
- Date — `createdAt` formatted
- Type — reason badge (`adjustment`, `initial`, `return`, `write_off`)
- Quantity — signed, color-coded (green for positive, red for negative)
- Lot — lot number (or "—" if null)
- Cost / Unit — formatted or "—"
- Notes — truncated if long

Sorted by `createdAt` descending (newest first). Server-side fetched alongside lots and item data.

## API

### Update item route changes

The existing `PATCH /api/items/[id]` (or equivalent update route) is extended:

**Additional fields in request body:**
```typescript
// Added to updateItemSchema
newStock: z.string().optional(),                                    // the target stock value
stockAdjustmentReason: z.enum(["adjustment", "return", "write_off"]).optional(),
stockAdjustmentCostPerUnit: z.string().optional(),
stockAdjustmentNotes: z.string().optional(),
```

If `newStock` is provided and differs from current stock, the backend performs the adjustment within the same transaction as the metadata update. If stock adjustment fails (e.g. insufficient stock), the entire update rolls back.

**Error response (insufficient stock):**
```json
{
  "errors": {
    "newStock": ["Insufficient stock. Available: 5, requested decrease: 10"]
  }
}
```

This uses the same field-level error format as existing Zod validation errors, so the form can display it inline on the "New Stock" field.

## Files

### New

| File | Purpose |
|------|---------|
| `lib/db/schema/stock-movements.ts` | `stock_movements` table schema with RLS |
| `drizzle/NNNN_*.sql` | Migration: create `stock_movements` table |

### Modified

| File | Change |
|------|--------|
| `lib/db/schema/index.ts` | Export `stockMovements` |
| `lib/schemas/items.ts` | Add `newStock`, `stockAdjustmentReason`, `stockAdjustmentCostPerUnit`, `stockAdjustmentNotes` to `updateItemSchema` |
| `app/(dashboard)/inventory/queries.ts` | Add `getStockMovements(itemId)`, add `adjustStock()` helper with FIFO logic, extend `createItemWithLot` to log initial movement, extend item update function to handle stock changes |
| `app/api/items/route.ts` (or `[id]/route.ts`) | Handle stock adjustment fields in update handler |
| `app/(dashboard)/inventory/materials/[id]/page.tsx` | Add stock movement history section, fetch movements |
| `app/(dashboard)/inventory/materials/material-form.tsx` | Add stock section in edit mode (current stock display, new stock input, conditional reason/cost/notes) |

### Not touched

| File | Why |
|------|-----|
| Inventory table / columns | Stock still computed from lots — no changes |
| Create form flow | `initialStock` unchanged (movement logging is backend-only) |
| Lots table UI | Read-only display, no changes |

## What's deferred

- **Targeted lot corrections** — "this specific lot was miscounted". Separate "Lot Correction" feature if needed.
- **`referenceType` / `referenceId` on movements** — added when POs/SOs create movements
- **Bulk adjustments** — adjust multiple materials at once
- **CSV import for stock counts** — initial inventory load
- **Movement reversal/void** — undo a movement by creating a counter-movement
- **Multi-location** — `locationId` on movements
- **Cost recalculation** — weighted average cost across lots
