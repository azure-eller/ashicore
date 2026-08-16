import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  ADJUSTMENT_REASONS,
  stocktakeItems,
  stocktakeLotItems,
  stocktakes,
} from "@/lib/db/schema";
import { getValidatedUnitDefinitionInTx } from "@/lib/inventory/queries/units";
import { getItemDisplayNamesByIdInTx } from "@/lib/inventory/item-display";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";
import type { Tx } from "@/lib/db/with-org-context";
import type { ProposalField } from "@/lib/agent/chat/proposals";
import { defineAgentAction } from "@/lib/agent/chat/actions/types";
import { nonNegativeQuantityString } from "@/lib/schemas/shared";

async function getValidatedItemNameInTx(tx: Tx, itemId: string): Promise<string> {
  const names = await getItemDisplayNamesByIdInTx(tx, [itemId]);
  const name = names.get(itemId);
  if (!name) {
    throw new Error(`Item ${itemId} was not found in this organization.`);
  }
  return name;
}

const itemCreateInput = z.object({
  name: z.string().min(1).describe("Item name"),
  itemType: z.enum(["product", "material"]).describe("product = sold/made, material = purchased input"),
  unitDefinitionId: z
    .string()
    .min(1)
    .describe(
      "UUID of the stocking unit (inventory.unit_definitions.id — find it with the query tool)"
    ),
  sku: z.string().nullable().describe("SKU, or null"),
  category: z.string().nullable().describe("Category label, or null"),
  description: z.string().nullable().describe("Free-text description, or null"),
  sellable: z.boolean().nullable().describe("Whether it can be sold; null = false"),
  defaultSellingPrice: z
    .string()
    .nullable()
    .describe("Default selling price as a decimal string, or null"),
  defaultPurchasePrice: z
    .string()
    .nullable()
    .describe("Default purchase price as a decimal string, or null"),
  openingStock: nonNegativeQuantityString("Opening stock")
    .nullable()
    .describe("Opening stock quantity as a decimal string, or null for none"),
  openingStockUnitCost: z
    .string()
    .nullable()
    .describe("Unit cost for the opening stock as a decimal string; required if openingStock is set for an item without a purchase price"),
});

export const itemCreateAction = defineAgentAction({
  name: "item.create",
  title: "Create item",
  summary: "Add a new product or material item, optionally with opening stock.",
  module: "inventory",
  capability: "operate",
  inputSchema: itemCreateInput,
  example: {
    name: "Pine bark mulch",
    itemType: "material",
    unitDefinitionId: "00000000-0000-0000-0000-000000000000",
    sku: null,
    category: null,
    description: null,
    sellable: null,
    defaultSellingPrice: null,
    defaultPurchasePrice: "3.25",
    openingStock: null,
    openingStockUnitCost: null,
  },
  async build(input, { tx }) {
    const unit = await getValidatedUnitDefinitionInTx(tx, input.unitDefinitionId);

    const fields: ProposalField[] = [
      { label: "Type", value: input.itemType },
      { label: "Unit", value: unit.name },
    ];
    if (input.sku) fields.push({ label: "SKU", value: input.sku });
    if (input.category) fields.push({ label: "Category", value: input.category });
    if (input.sellable) fields.push({ label: "Sellable", value: "yes" });
    if (input.defaultSellingPrice)
      fields.push({ label: "Selling price", value: input.defaultSellingPrice });
    if (input.defaultPurchasePrice)
      fields.push({ label: "Purchase price", value: input.defaultPurchasePrice });
    if (input.openingStock)
      fields.push({ label: "Opening stock", value: `${input.openingStock} ${unit.name}` });
    if (input.openingStockUnitCost)
      fields.push({ label: "Opening unit cost", value: input.openingStockUnitCost });

    return {
      title: `New item — ${input.name}`,
      appliedLabel: "Item created",
      commitPath: "/api/items",
      method: "POST",
      commitPayload: {
        name: input.name,
        itemType: input.itemType,
        unitDefinitionId: unit.id,
        sku: input.sku,
        category: input.category,
        description: input.description,
        sellable: input.sellable ?? false,
        safetyStock: "0",
        defaultSellingPrice: input.defaultSellingPrice,
        defaultPurchasePrice: input.defaultPurchasePrice,
        ...(input.openingStock ? { stock: input.openingStock } : {}),
        ...(input.openingStockUnitCost
          ? { currentStockUnitCost: input.openingStockUnitCost }
          : {}),
      },
      fields,
    };
  },
});

const itemUpdateInput = z.object({
  itemId: z
    .string()
    .min(1)
    .describe("UUID of the item to update (inventory.items.id — find it with the query tool)"),
  name: z.string().nullable().optional().describe("New name; omit to leave unchanged"),
  category: z
    .string()
    .nullable()
    .optional()
    .describe("New category; null clears it; omit to leave unchanged"),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("New description; null clears it; omit to leave unchanged"),
});

export const itemUpdateAction = defineAgentAction({
  name: "item.update",
  title: "Update item",
  summary: "Rename an item or change its category/description; only the fields you pass change.",
  module: "inventory",
  capability: "operate",
  inputSchema: itemUpdateInput,
  example: { itemId: "00000000-0000-0000-0000-000000000000", category: "Resins" },
  async build(input, { tx }) {
    const itemName = await getValidatedItemNameInTx(tx, input.itemId);

    const fields: ProposalField[] = [];
    const commitPayload: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (input.name == null) throw new Error("The item name cannot be cleared.");
      commitPayload.name = input.name;
      fields.push({ label: "Name", value: input.name });
    }
    if (input.category !== undefined) {
      commitPayload.category = input.category;
      fields.push({ label: "Category", value: input.category ?? "(cleared)" });
    }
    if (input.description !== undefined) {
      commitPayload.description = input.description;
      fields.push({ label: "Description", value: input.description ?? "(cleared)" });
    }
    if (fields.length === 0) {
      throw new Error("Pass at least one field to change.");
    }

    return {
      title: `Update item — ${itemName}`,
      appliedLabel: "Item updated",
      commitPath: `/api/item-cards/${input.itemId}`,
      method: "PATCH",
      commitPayload,
      fields,
    };
  },
});

const adjustmentLotInput = z.object({
  lotId: z.string().nullable().describe("UUID of an existing lot, or null when using lotNumber"),
  lotNumber: z
    .string()
    .nullable()
    .describe("Lot number (existing, or new for found stock), or null when using lotId"),
  newQuantity: nonNegativeQuantityString()
    .describe("The lot's new absolute quantity as a non-negative decimal string"),
});

const stockAdjustmentCreateInput = z.object({
  itemId: z
    .string()
    .min(1)
    .describe("UUID of the item to adjust (inventory.items.id — find it with the query tool)"),
  reason: z
    .enum(ADJUSTMENT_REASONS)
    .describe("Why the stock is being adjusted"),
  newQuantity: nonNegativeQuantityString().nullable()
    .describe(
      "New absolute on-hand quantity for an UNTRACKED item as a non-negative decimal string; null for lot-tracked items (use lots instead)"
    ),
  lots: z
    .array(adjustmentLotInput)
    .nullable()
    .describe(
      "Per-lot new quantities for a LOT-TRACKED item (query the item's lots first); null for untracked items"
    ),
  note: z.string().nullable().describe("Optional note, or null"),
});

export const stockAdjustmentCreateAction = defineAgentAction({
  name: "stock_adjustment.create",
  title: "Adjust stock",
  summary:
    "Set an item's on-hand quantity (untracked items) or per-lot quantities (lot-tracked items).",
  module: "inventory",
  capability: "operate",
  inputSchema: stockAdjustmentCreateInput,
  example: {
    itemId: "00000000-0000-0000-0000-000000000000",
    reason: "cycle_count",
    newQuantity: "7",
    lots: null,
    note: null,
  },
  async build(input, { tx }) {
    const itemName = await getValidatedItemNameInTx(tx, input.itemId);
    const trackingMode = await getItemLotTrackingModeInTx(tx, input.itemId);

    const fields: ProposalField[] = [
      { label: "Item", value: itemName },
      { label: "Reason", value: input.reason.replace(/_/g, " ") },
    ];

    if (trackingMode === "tracked") {
      if (!input.lots || input.lots.length === 0) {
        throw new Error(
          `"${itemName}" is lot-tracked: pass lots with a new quantity per lot (query the item's lots first).`
        );
      }
      for (const lot of input.lots) {
        if (!lot.lotId && !lot.lotNumber) {
          throw new Error("Each lot needs a lotId or a lotNumber.");
        }
        fields.push({
          label: `Lot ${lot.lotNumber ?? lot.lotId}`,
          value: `→ ${lot.newQuantity}`,
        });
      }
    } else {
      if (input.newQuantity == null) {
        throw new Error(`"${itemName}" is untracked: pass newQuantity.`);
      }
      fields.push({ label: "New quantity", value: input.newQuantity });
    }
    if (input.note) fields.push({ label: "Note", value: input.note });

    return {
      title: `Stock adjustment — ${itemName}`,
      appliedLabel: "Stock adjusted",
      commitPath: `/api/items/${input.itemId}/stock-adjustments`,
      method: "POST",
      commitPayload: {
        reason: input.reason,
        ...(input.note ? { note: input.note } : {}),
        ...(trackingMode === "tracked"
          ? {
              // The route accepts exactly one lot identifier; prefer the id when
              // the agent provides both.
              lots: input.lots!.map((lot) => ({
                ...(lot.lotId
                  ? { lotId: lot.lotId }
                  : { lotNumber: lot.lotNumber ?? undefined }),
                newQuantity: lot.newQuantity,
              })),
            }
          : { newQuantity: input.newQuantity }),
      },
      fields,
    };
  },
});

const stocktakeCreateInput = z.object({
  name: z.string().min(1).describe("Stocktake name"),
  reason: z.string().min(1).describe("Why the stocktake is being run"),
  scope: z
    .enum(["all", "in_stock", "material", "product"])
    .describe("Which items to count: all, only in-stock, or one item type"),
  itemIds: z
    .array(z.string())
    .nullable()
    .describe("Explicit item UUIDs to count instead of the scope filter, or null"),
  notes: z.string().nullable().describe("Optional notes, or null"),
});

export const stocktakeCreateAction = defineAgentAction({
  name: "stocktake.create",
  title: "Create stocktake",
  summary: "Start a draft stocktake over a scope of items (counts are recorded separately).",
  module: "inventory",
  capability: "operate",
  inputSchema: stocktakeCreateInput,
  example: {
    name: "Q3 resin count",
    reason: "quarterly audit",
    scope: "in_stock",
    itemIds: null,
    notes: null,
  },
  async build(input, { tx }) {
    const fields: ProposalField[] = [
      { label: "Scope", value: input.scope.replace(/_/g, " ") },
      { label: "Reason", value: input.reason },
    ];

    if (input.itemIds && input.itemIds.length > 0) {
      const names = await getItemDisplayNamesByIdInTx(tx, input.itemIds);
      const missing = input.itemIds.filter((id) => !names.has(id));
      if (missing.length > 0) {
        throw new Error(`Items not found in this organization: ${missing.join(", ")}.`);
      }
      fields.push({ label: "Items", value: [...names.values()].join(", ") });
    }
    if (input.notes) fields.push({ label: "Notes", value: input.notes });

    return {
      title: `Stocktake — ${input.name}`,
      appliedLabel: "Stocktake created",
      commitPath: "/api/stocktakes",
      method: "POST",
      commitPayload: {
        name: input.name,
        reason: input.reason,
        scope: input.scope,
        notes: input.notes,
        ...(input.itemIds && input.itemIds.length > 0 ? { itemIds: input.itemIds } : {}),
      },
      fields,
    };
  },
});

const stocktakeRecordCountsInput = z.object({
  stocktakeId: z
    .string()
    .min(1)
    .describe("UUID of the draft stocktake (inventory.stocktakes.id — find it with the query tool)"),
  counts: z
    .array(
      z.object({
        lineId: z
          .string()
          .min(1)
          .describe("UUID of the stocktake line (inventory.stocktake_items.id)"),
        countedQty: nonNegativeQuantityString("Counted quantity")
          .describe("Counted quantity as a non-negative decimal string"),
      })
    )
    .min(1)
    .describe("Counted quantities per stocktake line"),
});

export const stocktakeRecordCountsAction = defineAgentAction({
  name: "stocktake.record_counts",
  title: "Record stocktake counts",
  summary:
    "Record counted quantities against lines of a draft stocktake. Lines counted per lot can't be staged here — those counts go in the stocktake page.",
  module: "inventory",
  capability: "operate",
  inputSchema: stocktakeRecordCountsInput,
  example: {
    stocktakeId: "00000000-0000-0000-0000-000000000000",
    counts: [{ lineId: "00000000-0000-0000-0000-000000000000", countedQty: "12" }],
  },
  async build(input, { tx }) {
    const [stocktake] = await tx
      .select({ id: stocktakes.id, name: stocktakes.name, status: stocktakes.status })
      .from(stocktakes)
      .where(eq(stocktakes.id, input.stocktakeId));
    if (!stocktake) {
      throw new Error("Stocktake not found.");
    }
    if (stocktake.status !== "draft") {
      throw new Error(`Counts can only be recorded on a draft stocktake (this one is ${stocktake.status}).`);
    }

    const lineIds = input.counts.map((count) => count.lineId);
    const lines = await tx
      .select({ id: stocktakeItems.id, itemName: stocktakeItems.itemName })
      .from(stocktakeItems)
      .where(
        and(eq(stocktakeItems.stocktakeId, stocktake.id), inArray(stocktakeItems.id, lineIds))
      );
    const linesById = new Map(lines.map((line) => [line.id, line] as const));
    // Completion ignores the line-level count once a line has lot rows — it
    // reconciles per-lot counts only. Reject those lines instead of staging a
    // count that would silently not apply.
    const lotLines = await tx
      .select({ stocktakeItemId: stocktakeLotItems.stocktakeItemId })
      .from(stocktakeLotItems)
      .where(inArray(stocktakeLotItems.stocktakeItemId, lineIds));
    const lotCountedLineIds = new Set(lotLines.map((lot) => lot.stocktakeItemId));

    const fields: ProposalField[] = [];
    for (const count of input.counts) {
      const line = linesById.get(count.lineId);
      if (!line) {
        throw new Error(`Line ${count.lineId} is not part of this stocktake.`);
      }
      if (lotCountedLineIds.has(count.lineId)) {
        throw new Error(
          `"${line.itemName}" is counted per lot in this stocktake; record its lot counts in the stocktake page instead.`
        );
      }
      fields.push({ label: line.itemName, value: `→ ${count.countedQty}` });
    }

    return {
      title: `Counts — ${stocktake.name}`,
      appliedLabel: "Counts recorded",
      commitPath: `/api/stocktakes/${stocktake.id}`,
      method: "PUT",
      commitPayload: {
        lines: input.counts.map((count) => ({
          lineId: count.lineId,
          countedQty: count.countedQty,
        })),
      },
      fields,
    };
  },
});
