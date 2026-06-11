import "server-only";

import { z } from "zod";
import {
  getValidatedCustomerInTx,
  getValidatedSalesItemsInTx,
} from "@/lib/sales/queries/validation";
import type { ProposalField, ProposalLine } from "@/lib/agent/chat/proposals";
import { defineAgentAction } from "@/lib/agent/chat/actions/types";

const lineInput = z.object({
  itemId: z
    .string()
    .min(1)
    .describe("UUID of a sellable item (inventory.items.id — find it with the query tool)"),
  quantity: z.string().min(1).describe('Quantity as a positive decimal string, e.g. "10"'),
  unitPrice: z
    .string()
    .nullable()
    .describe("Unit price as a decimal string; null = use the item's default selling price"),
});

const salesOrderCreateInput = z.object({
  customerId: z
    .string()
    .min(1)
    .describe("UUID of the customer (sales.customers.id — find it with the query tool)"),
  lines: z.array(lineInput).min(1).describe("One line per product on the order"),
  orderDate: z.string().nullable().describe("Order date YYYY-MM-DD; null = today"),
  requestedDate: z.string().nullable().describe("Customer requested date YYYY-MM-DD, or null"),
  shipDate: z.string().nullable().describe("Planned ship date YYYY-MM-DD, or null"),
  notes: z.string().nullable().describe("Free-text note for the order, or null"),
});

/** Preview line total. Authoritative totals + tax are recomputed by the commit route. */
function previewLineTotal(quantity: string, unitPrice: string): string {
  const total = Number(quantity) * Number(unitPrice);
  return Number.isFinite(total) ? total.toFixed(2) : "0.00";
}

export const salesOrderCreateAction = defineAgentAction({
  name: "sales_order.create",
  title: "Create sales order",
  summary: "Raise a new sales order for a customer with one or more product lines.",
  module: "sales",
  capability: "operate",
  inputSchema: salesOrderCreateInput,
  example: {
    customerId: "00000000-0000-0000-0000-000000000000",
    lines: [{ itemId: "00000000-0000-0000-0000-000000000000", quantity: "10", unitPrice: null }],
    orderDate: null,
    requestedDate: null,
    shipDate: null,
    notes: null,
  },
  async build(input, { tx }) {
    const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
    const customer = await getValidatedCustomerInTx(tx, input.customerId);
    const itemsById = await getValidatedSalesItemsInTx(tx, itemIds);

    let total = 0;
    const previewLines: ProposalLine[] = [];
    const commitLines: Array<{ itemId: string; quantity: string; unitPrice: string }> = [];

    for (const line of input.lines) {
      const item = itemsById.get(line.itemId);
      if (!item) {
        throw new Error(`Item ${line.itemId} is not a sellable item in this organization.`);
      }
      const unitPrice = String(line.unitPrice ?? item.defaultSellingPrice ?? "0");
      const lineTotal = previewLineTotal(line.quantity, unitPrice);
      total += Number(lineTotal);
      previewLines.push({
        label: item.displayName,
        sublabel: item.sku ? `${item.sku} · ${item.unitName}` : item.unitName,
        quantity: line.quantity,
        unitAmount: unitPrice,
        lineTotal,
      });
      commitLines.push({ itemId: item.id, quantity: line.quantity, unitPrice });
    }

    const fields: ProposalField[] = [{ label: "Customer", value: customer.name }];
    if (input.orderDate) fields.push({ label: "Order date", value: input.orderDate });
    if (input.requestedDate) fields.push({ label: "Requested", value: input.requestedDate });
    if (input.shipDate) fields.push({ label: "Ship date", value: input.shipDate });
    if (input.notes) fields.push({ label: "Notes", value: input.notes });

    return {
      title: `Sales order — ${customer.name}`,
      appliedLabel: "Sales order created",
      commitPath: "/api/sales-orders",
      method: "POST",
      commitPayload: {
        customerId: customer.id,
        ...(input.orderDate ? { orderDate: input.orderDate } : {}),
        requestedDate: input.requestedDate,
        shipDate: input.shipDate,
        notes: input.notes,
        status: "open",
        lines: commitLines,
      },
      fields,
      lineTable: {
        quantityLabel: "Qty",
        unitAmountLabel: "Unit price",
        totalLabel: "Total",
        lines: previewLines,
        total: total.toFixed(2),
        commitLinesKey: "lines",
        commitQuantityKey: "quantity",
        commitUnitAmountKey: "unitPrice",
      },
    };
  },
});
