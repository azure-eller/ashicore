import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { purchaseOrders } from "@/lib/db/schema";
import { isValidIsoDate, nullableString } from "./shared";

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partial",
  "received",
  "cancelled",
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_ADDITIONAL_COST_TYPES = [
  "shipping",
  "customs",
  "other",
] as const;

export const PURCHASE_ORDER_ADDITIONAL_COST_DISTRIBUTION_METHODS = [
  "by_value",
  "not_distributed",
] as const;

export type PurchaseOrderAdditionalCostType =
  (typeof PURCHASE_ORDER_ADDITIONAL_COST_TYPES)[number];
export type PurchaseOrderAdditionalCostDistributionMethod =
  (typeof PURCHASE_ORDER_ADDITIONAL_COST_DISTRIBUTION_METHODS)[number];

const rawLineSchema = z.object({
  itemId: z.string().default(""),
  quantityOrdered: nullableString,
  unitCost: nullableString,
  accountingPurchaseAccountCode: nullableString,
  shipAddressEntryId: nullableString,
  shipContactName: nullableString,
  shipContactPhone: nullableString,
  shipLine1: nullableString,
  shipLine2: nullableString,
  shipCity: nullableString,
  shipRegion: nullableString,
  shipPostcode: nullableString,
  shipCountry: nullableString,
  shipDeliveryInstructions: nullableString,
});

const rawAdditionalCostSchema = z.object({
  costType: z.enum(PURCHASE_ORDER_ADDITIONAL_COST_TYPES).default("shipping"),
  reference: nullableString,
  distributionMethod: z
    .enum(PURCHASE_ORDER_ADDITIONAL_COST_DISTRIBUTION_METHODS)
    .default("by_value"),
  accountingPurchaseAccountCode: nullableString,
  amount: nullableString,
});

type RawLine = z.input<typeof rawLineSchema>;
type RawAdditionalCost = z.input<typeof rawAdditionalCostSchema>;

function isBlankLine(line: RawLine) {
  const itemId = typeof line.itemId === "string" ? line.itemId.trim() : "";
  const quantityOrdered = line.quantityOrdered?.trim() ?? "";
  const unitCost = line.unitCost?.trim() ?? "";
  return itemId === "" && quantityOrdered === "" && unitCost === "";
}

function isBlankAdditionalCost(cost: RawAdditionalCost) {
  const reference = cost.reference?.trim() ?? "";
  const amount = cost.amount?.trim() ?? "";
  return reference === "" && amount === "";
}

const cleanedLinesSchema = z
  .array(rawLineSchema)
  .transform((lines) => lines.filter((line) => !isBlankLine(line)))
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const itemId = line.itemId.trim();
      const quantityOrdered = line.quantityOrdered?.trim() ?? "";
      const unitCost = line.unitCost?.trim() ?? "";

      if (!itemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Material is required",
          path: [index, "itemId"],
        });
      } else if (seen.has(itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This material is already on the purchase order",
          path: [index, "itemId"],
        });
      } else {
        seen.add(itemId);
      }

      if (!quantityOrdered) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity is required",
          path: [index, "quantityOrdered"],
        });
      } else {
        const parsed = Number(quantityOrdered);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Quantity must be greater than 0",
            path: [index, "quantityOrdered"],
          });
        }
      }

      if (!unitCost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unit cost is required",
          path: [index, "unitCost"],
        });
      } else {
        const parsed = Number(unitCost);
        if (!Number.isFinite(parsed) || parsed < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unit cost must be 0 or greater",
            path: [index, "unitCost"],
          });
        }
      }
    });
  });

const cleanedAdditionalCostsSchema = z
  .array(rawAdditionalCostSchema)
  .default([])
  .transform((costs) => costs.filter((cost) => !isBlankAdditionalCost(cost)))
  .superRefine((costs, ctx) => {
    costs.forEach((cost, index) => {
      const amount = cost.amount?.trim() ?? "";
      if (!amount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Amount is required",
          path: [index, "amount"],
        });
        return;
      }

      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Amount must be 0 or greater",
          path: [index, "amount"],
        });
      }
    });
  });

const basePurchaseOrderSchema = createInsertSchema(purchaseOrders, {
  supplierId: z.string().min(1, "Supplier is required"),
  expectedDate: nullableString.refine(
    (value) => value == null || isValidIsoDate(value),
    "Expected date must be a real date in YYYY-MM-DD format",
  ),
  shippingCost: nullableString.superRefine((value, ctx) => {
    const normalized = value?.trim() ?? "";
    if (!normalized) return;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Shipping cost must be 0 or greater",
      });
    }
  }),
  notes: nullableString,
  accountingPurchaseAccountCode: nullableString,
  shipLine1: nullableString,
  shipLine2: nullableString,
  shipCity: nullableString,
  shipRegion: nullableString,
  shipPostcode: nullableString,
  shipCountry: nullableString,
}).omit({
  id: true,
  organizationId: true,
  orderNumber: true,
  supplierName: true,
  status: true,
  totalAmount: true,
  orderedAt: true,
  receivedAt: true,
  cancelledAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  lines: cleanedLinesSchema,
  additionalCosts: cleanedAdditionalCostsSchema,
});

export const insertPurchaseOrderSchema = basePurchaseOrderSchema;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;

export const updatePurchaseOrderSchema = basePurchaseOrderSchema;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;

const rawReceiveLineSchema = z.object({
  lineId: z.string().min(1),
  quantityReceived: nullableString,
  disposition: z.enum(["available", "blocked"]).default("available"),
});

export const receivePurchaseOrderSchema = z
  .object({
    lines: z.array(rawReceiveLineSchema).min(1),
    confirmOverReceipt: z.boolean().optional(),
  })
  .transform(({ lines, confirmOverReceipt }) => ({
    confirmOverReceipt: confirmOverReceipt ?? false,
    lines: lines
      .map((line) => ({
        lineId: line.lineId,
        quantityReceived: line.quantityReceived?.trim() ?? "",
        disposition: line.disposition ?? "available",
      }))
      .filter((line) => line.quantityReceived !== ""),
  }))
  .superRefine((data, ctx) => {
    if (data.lines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter at least one received quantity",
        path: ["lines"],
      });
      return;
    }

    data.lines.forEach((line, index) => {
      const parsed = Number(line.quantityReceived);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Received quantity must be greater than 0",
          path: ["lines", index, "quantityReceived"],
        });
      }
    });
  });

export type ReceivePurchaseOrder = z.infer<typeof receivePurchaseOrderSchema>;

export const createPurchaseBillSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1, "Supplier invoice number is required"),
    billDate: z.string().refine(isValidIsoDate, "Bill date must be a real date in YYYY-MM-DD format"),
    dueDate: z.string().refine(isValidIsoDate, "Due date must be a real date in YYYY-MM-DD format"),
    reference: nullableString,
    confirmAdditionalCostsOmitted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.dueDate < data.billDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Due date cannot be before bill date",
        path: ["dueDate"],
      });
    }
  });

export type CreatePurchaseBill = z.infer<typeof createPurchaseBillSchema>;

export const purchaseOrderDefaultValues: InsertPurchaseOrder = {
  supplierId: "",
  expectedDate: null,
  shippingCost: "0",
  notes: null,
  accountingPurchaseAccountCode: null,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipRegion: null,
  shipPostcode: null,
  shipCountry: null,
  lines: [
    {
      itemId: "",
      quantityOrdered: null,
      unitCost: null,
      accountingPurchaseAccountCode: null,
      shipAddressEntryId: null,
      shipContactName: null,
      shipContactPhone: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      shipDeliveryInstructions: null,
    },
  ],
  additionalCosts: [],
};
