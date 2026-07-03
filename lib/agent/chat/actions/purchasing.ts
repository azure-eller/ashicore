import "server-only";

import { z } from "zod";
import { getValidatedSupplierInTx } from "@/lib/purchasing/queries/order-write";
import { getValidatedPurchasableItemsInTx } from "@/lib/purchasing/queries/shared";
import type { ProposalField, ProposalLine } from "@/lib/agent/chat/proposals";
import { defineAgentAction } from "@/lib/agent/chat/actions/types";

const lineInput = z.object({
  itemId: z
    .string()
    .min(1)
    .describe("UUID of a purchasable item (inventory.items.id — find it with the query tool)"),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .describe('Quantity to order as a positive decimal string, e.g. "10"'),
  unitCost: z
    .string()
    .nullable()
    .describe("Unit cost as a decimal string; null = use the item's default purchase price"),
});

const purchaseOrderCreateInput = z.object({
  supplierId: z
    .string()
    .min(1)
    .describe("UUID of the supplier (purchasing.suppliers.id — find it with the query tool)"),
  lines: z.array(lineInput).min(1).describe("One line per item on the order"),
  expectedDate: z.string().nullable().describe("Expected delivery date YYYY-MM-DD, or null"),
  notes: z.string().nullable().describe("Free-text note for the order, or null"),
});

function previewLineTotal(quantity: string, unitCost: string): string {
  const total = Number(quantity) * Number(unitCost);
  return Number.isFinite(total) ? total.toFixed(2) : "0.00";
}

export const purchaseOrderCreateAction = defineAgentAction({
  name: "purchase_order.create",
  title: "Create purchase order",
  summary: "Raise a purchase order on a supplier with one or more item lines.",
  module: "purchasing",
  capability: "operate",
  inputSchema: purchaseOrderCreateInput,
  example: {
    supplierId: "00000000-0000-0000-0000-000000000000",
    lines: [{ itemId: "00000000-0000-0000-0000-000000000000", quantity: "10", unitCost: null }],
    expectedDate: null,
    notes: null,
  },
  async build(input, { tx }) {
    const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
    const supplier = await getValidatedSupplierInTx(tx, input.supplierId);
    const itemsById = await getValidatedPurchasableItemsInTx(tx, itemIds);

    let total = 0;
    const previewLines: ProposalLine[] = [];
    const commitLines: Array<{ itemId: string; quantityOrdered: string; unitCost: string }> = [];

    for (const line of input.lines) {
      // getValidatedPurchasableItemsInTx throws when any requested id is missing.
      const item = itemsById.get(line.itemId)!;
      const resolvedCost =
        line.unitCost ?? item.defaultPurchasePrice ?? item.currentStockUnitCost;
      if (resolvedCost == null) {
        throw new Error(
          `No price found for "${item.name}": pass unitCost, or set the item's default purchase price first.`
        );
      }
      const unitCost = String(resolvedCost);
      const lineTotal = previewLineTotal(line.quantity, unitCost);
      total += Number(lineTotal);
      previewLines.push({
        label: item.name,
        sublabel: item.sku ? `${item.sku} · ${item.stockingUnitName}` : item.stockingUnitName,
        quantity: line.quantity,
        unitAmount: unitCost,
        lineTotal,
      });
      commitLines.push({ itemId: item.id, quantityOrdered: line.quantity, unitCost });
    }

    const fields: ProposalField[] = [{ label: "Supplier", value: supplier.name }];
    if (input.expectedDate) fields.push({ label: "Expected", value: input.expectedDate });
    if (input.notes) fields.push({ label: "Notes", value: input.notes });

    return {
      title: `Purchase order — ${supplier.name}`,
      appliedLabel: "Purchase order created",
      commitPath: "/api/purchase-orders",
      method: "POST",
      commitPayload: {
        supplierId: supplier.id,
        expectedDate: input.expectedDate,
        notes: input.notes,
        lines: commitLines,
      },
      fields,
      lineTable: {
        quantityLabel: "Qty",
        unitAmountLabel: "Unit cost",
        totalLabel: "Total",
        lines: previewLines,
        total: total.toFixed(2),
        commitLinesKey: "lines",
        commitQuantityKey: "quantityOrdered",
        commitUnitAmountKey: "unitCost",
      },
    };
  },
});
