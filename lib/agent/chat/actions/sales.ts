import "server-only";

import { z } from "zod";
import {
  getValidatedCustomerInTx,
  getValidatedSalesItemsInTx,
} from "@/lib/sales/queries/validation";
import type { ProposalField, ProposalLine } from "@/lib/agent/chat/proposals";
import { defineAgentAction } from "@/lib/agent/chat/actions/types";

const customerFields = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  billingLine1: "Billing line 1",
  billingLine2: "Billing line 2",
  billingCity: "Billing city",
  billingRegion: "Billing region",
  billingPostcode: "Billing postcode",
  billingCountry: "Billing country",
  shipLine1: "Shipping line 1",
  shipLine2: "Shipping line 2",
  shipCity: "Shipping city",
  shipRegion: "Shipping region",
  shipPostcode: "Shipping postcode",
  shipCountry: "Shipping country",
} as const;

type CustomerFieldKey = keyof typeof customerFields;

const lineInput = z.object({
  itemId: z
    .string()
    .min(1)
    .describe("UUID of a sellable item (inventory.items.id — find it with the query tool)"),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .describe(
      'Quantity in the item\'s configured sales unit, as a positive decimal string, e.g. "10"',
    ),
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
  lines: z.array(lineInput).min(1).describe("One line per sellable item on the order"),
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
  summary: "Raise a new sales order for a customer with one or more sellable item lines.",
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
      const resolvedPrice = line.unitPrice ?? item.defaultSellingPrice;
      if (resolvedPrice == null) {
        throw new Error(
          `No price found for "${item.displayName}": pass unitPrice, or set the item's default selling price first.`
        );
      }
      const unitPrice = String(resolvedPrice);
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
        quantityContractVersion: 2,
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

const customerCreateInput = z.object({
  name: z.string().min(1).describe("Customer name"),
  email: z.string().nullable().describe("Email address, or null"),
  phone: z.string().nullable().describe("Phone number, or null"),
  billingLine1: z.string().nullable().describe("Billing address line 1, or null"),
  billingLine2: z.string().nullable().describe("Billing address line 2, or null"),
  billingCity: z.string().nullable().describe("Billing city, or null"),
  billingRegion: z.string().nullable().describe("Billing state/region, or null"),
  billingPostcode: z.string().nullable().describe("Billing postcode, or null"),
  billingCountry: z.string().nullable().describe("Billing country, or null"),
  shipLine1: z.string().nullable().describe("Shipping address line 1, or null"),
  shipLine2: z.string().nullable().describe("Shipping address line 2, or null"),
  shipCity: z.string().nullable().describe("Shipping city, or null"),
  shipRegion: z.string().nullable().describe("Shipping state/region, or null"),
  shipPostcode: z.string().nullable().describe("Shipping postcode, or null"),
  shipCountry: z.string().nullable().describe("Shipping country, or null"),
});

export const customerCreateAction = defineAgentAction({
  name: "customer.create",
  title: "Create customer",
  summary: "Add a new customer with contact details and addresses.",
  module: "sales",
  capability: "operate",
  inputSchema: customerCreateInput,
  example: {
    name: "Acme Landscaping",
    email: "orders@acme.example.com",
    phone: null,
    billingLine1: null,
    billingLine2: null,
    billingCity: null,
    billingRegion: null,
    billingPostcode: null,
    billingCountry: null,
    shipLine1: null,
    shipLine2: null,
    shipCity: null,
    shipRegion: null,
    shipPostcode: null,
    shipCountry: null,
  },
  async build(input) {
    const fields: ProposalField[] = [];
    for (const key of Object.keys(customerFields) as CustomerFieldKey[]) {
      const value = input[key];
      if (value != null && value !== "") {
        fields.push({ label: customerFields[key], value });
      }
    }

    return {
      title: `New customer — ${input.name}`,
      appliedLabel: "Customer created",
      commitPath: "/api/customers",
      method: "POST",
      commitPayload: { ...input },
      fields,
    };
  },
});

const customerUpdateInput = z.object({
  customerId: z
    .string()
    .min(1)
    .describe("UUID of the customer to update (sales.customers.id — find it with the query tool)"),
  name: z.string().nullable().optional().describe("New name; omit to leave unchanged"),
  email: z
    .string()
    .nullable()
    .optional()
    .describe("New email; null clears it; omit to leave unchanged"),
  phone: z
    .string()
    .nullable()
    .optional()
    .describe("New phone; null clears it; omit to leave unchanged"),
  billingLine1: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  billingLine2: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  billingCity: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  billingRegion: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  billingPostcode: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  billingCountry: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  shipLine1: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  shipLine2: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  shipCity: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  shipRegion: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  shipPostcode: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
  shipCountry: z.string().nullable().optional().describe("Omit to leave unchanged; null clears"),
});

export const customerUpdateAction = defineAgentAction({
  name: "customer.update",
  title: "Update customer",
  summary: "Change a customer's contact details or addresses; only the fields you pass change.",
  module: "sales",
  capability: "operate",
  inputSchema: customerUpdateInput,
  example: { customerId: "00000000-0000-0000-0000-000000000000", phone: "555-0100" },
  async build(input, { tx }) {
    const customer = await getValidatedCustomerInTx(tx, input.customerId);

    const fields: ProposalField[] = [];
    const commitPayload: Record<string, unknown> = {};
    for (const key of Object.keys(customerFields) as CustomerFieldKey[]) {
      const value = input[key];
      if (value === undefined) continue;
      if (key === "name" && value == null) {
        throw new Error("The customer name cannot be cleared.");
      }
      commitPayload[key] = value;
      fields.push({ label: customerFields[key], value: value ?? "(cleared)" });
    }

    if (fields.length === 0) {
      throw new Error("Pass at least one field to change.");
    }

    return {
      title: `Update customer — ${customer.name}`,
      appliedLabel: "Customer updated",
      commitPath: `/api/customers/${customer.id}`,
      method: "PATCH",
      commitPayload,
      fields,
    };
  },
});
