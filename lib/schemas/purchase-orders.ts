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

const rawLineSchema = z.object({
  itemId: z.string().default(""),
  quantityOrdered: nullableString,
  unitCost: nullableString,
});

type RawLine = z.input<typeof rawLineSchema>;

function isBlankLine(line: RawLine) {
  const itemId = typeof line.itemId === "string" ? line.itemId.trim() : "";
  const quantityOrdered = line.quantityOrdered?.trim() ?? "";
  const unitCost = line.unitCost?.trim() ?? "";
  return itemId === "" && quantityOrdered === "" && unitCost === "";
}

const cleanedLinesSchema = z
  .array(rawLineSchema)
  .transform((lines) => lines.filter((line) => !isBlankLine(line)))
  .superRefine((lines, ctx) => {
    if (lines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one line is required",
        path: [],
      });
      return;
    }

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

const basePurchaseOrderSchema = createInsertSchema(purchaseOrders, {
  supplierId: z.string().min(1, "Supplier is required"),
  expectedDate: nullableString.refine(
    (value) => value == null || isValidIsoDate(value),
    "Expected date must be a real date in YYYY-MM-DD format"
  ),
  notes: nullableString,
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
});

export const insertPurchaseOrderSchema = basePurchaseOrderSchema;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;

export const updatePurchaseOrderSchema = basePurchaseOrderSchema;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;

const rawReceiveLineSchema = z.object({
  lineId: z.string().min(1),
  quantityReceived: nullableString,
});

export const receivePurchaseOrderSchema = z
  .object({
    lines: z.array(rawReceiveLineSchema).min(1),
  })
  .transform(({ lines }) => ({
    lines: lines
      .map((line) => ({
        lineId: line.lineId,
        quantityReceived: line.quantityReceived?.trim() ?? "",
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

export const purchaseOrderDefaultValues: InsertPurchaseOrder = {
  supplierId: "",
  expectedDate: null,
  notes: null,
  lines: [
    {
      itemId: "",
      quantityOrdered: null,
      unitCost: null,
    },
  ],
};

