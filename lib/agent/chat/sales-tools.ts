import "server-only";

import { z } from "zod";
import { getSalesOrders } from "@/lib/sales/queries/orders-read";
import type { SalesOrderListRow } from "@/lib/sales/types";
import { buildAgentTool } from "@/lib/agent/core";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { formatCurrency } from "@/lib/format";

// Optional fields are also nullable: OpenAI strict function schemas require
// every property, so the model expresses "unset" as null.
const listSalesOrdersInputSchema = z.object({
  status: z.enum(["open", "done"]).default("open"),
  risk: z.enum(["blocked", "late", "due_soon"]).nullable().optional(),
  customerId: z.string().nullable().optional(),
  dueBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

type ListSalesOrdersInput = z.infer<typeof listSalesOrdersInputSchema>;

export type AgentSalesOrderRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  status: "open" | "done";
  totalAmount: string;
  formattedTotal: string;
  shipDate: string | null;
  requestedDate: string | null;
  dueDate: string | null;
  itemSummary: string;
  fulfillmentLabel: string;
  shortQty: string;
  riskFlags: string[];
  href: string;
};

export type ListSalesOrdersOutput = {
  query: ListSalesOrdersInput;
  totalMatched: number;
  rows: AgentSalesOrderRow[];
};

function orderDueDate(order: SalesOrderListRow) {
  return order.shipDate ?? order.requestedDate;
}

function daysUntil(date: string, now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((Date.parse(`${date}T00:00:00.000Z`) - today) / 86_400_000);
}

function riskFlags(order: SalesOrderListRow, now: Date) {
  const flags: string[] = [];
  const dueDate = orderDueDate(order);
  const shortQty = Number(order.fulfillmentSummary.shortQty);

  if (
    order.shippingReadiness.state === "insufficient_stock" ||
    order.fulfillmentSummary.productionState === "blocked" ||
    (Number.isFinite(shortQty) && shortQty > 0)
  ) {
    flags.push("blocked");
  }

  if (order.status === "open" && dueDate) {
    const days = daysUntil(dueDate, now);
    if (days < 0) flags.push("late");
    if (days >= 0 && days <= 7) flags.push("due_soon");
  }

  return flags;
}

function toAgentSalesOrderRow(order: SalesOrderListRow, now: Date): AgentSalesOrderRow {
  const dueDate = orderDueDate(order);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    totalAmount: order.totalAmount,
    formattedTotal: formatCurrency(order.totalAmount) ?? order.totalAmount,
    shipDate: order.shipDate,
    requestedDate: order.requestedDate,
    dueDate,
    itemSummary: order.itemSummary,
    fulfillmentLabel: order.fulfillmentSummary.label,
    shortQty: order.fulfillmentSummary.shortQty,
    riskFlags: riskFlags(order, now),
    href: `/sales/order/${order.id}`,
  };
}

function matchesRisk(order: SalesOrderListRow, risk: ListSalesOrdersInput["risk"], now: Date) {
  if (!risk) return true;
  return riskFlags(order, now).includes(risk);
}

export const listSalesOrdersTool = buildAgentTool({
  name: "list_sales_orders",
  description:
    "Query sales orders for the current organization. Always filter; default limit 10, max 25.",
  inputSchema: listSalesOrdersInputSchema,
  execute: async (input, context): Promise<ListSalesOrdersOutput> => {
    if (!context.member || !hasModuleAccess(context.member.assignedRoles, "sales", "read")) {
      throw new AuthorizationError("You do not have access to sales orders.", 403);
    }

    const now = new Date(context.now);
    const allOrders = await getSalesOrders();
    const filtered = allOrders.filter((order) => {
      if (order.status !== input.status) return false;
      if (input.customerId && order.customerId !== input.customerId) return false;
      const dueDate = orderDueDate(order);
      if (input.dueBefore && (!dueDate || dueDate > input.dueBefore)) return false;
      return matchesRisk(order, input.risk, now);
    });

    return {
      query: input,
      totalMatched: filtered.length,
      rows: filtered.slice(0, input.limit).map((order) => toAgentSalesOrderRow(order, now)),
    };
  },
  summarize: (output) => {
    const blocked = output.rows.filter((order) => order.riskFlags.includes("blocked")).length;
    return `${output.totalMatched} matching orders; ${blocked} shown blocked`;
  },
  toModelContent: (output) =>
    output.rows
      .map((order) =>
        [
          order.orderNumber,
          order.customerName,
          order.formattedTotal,
          order.dueDate ? `due ${order.dueDate}` : "no due date",
          order.riskFlags.length > 0 ? `[${order.riskFlags.join(", ")}]` : "[no flags]",
        ].join(" ")
      )
      .join("\n"),
  isConcurrencySafe: () => true,
});

export const dashboardChatTools = [listSalesOrdersTool];
