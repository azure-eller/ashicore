import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { salesOrders } from "@/lib/db/schema";
import { isValidIsoDate, nullableString } from "./shared";

export const SALES_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

const rawOrderLineSchema = z.object({
  itemId: z.string().default(""),
  quantity: nullableString,
  unitPrice: nullableString,
});

type RawOrderLine = z.input<typeof rawOrderLineSchema>;

function isBlankLine(line: RawOrderLine) {
  const itemId = typeof line.itemId === "string" ? line.itemId.trim() : "";
  const quantity = line.quantity?.trim() ?? "";
  const unitPrice = line.unitPrice?.trim() ?? "";
  return itemId === "" && quantity === "" && unitPrice === "";
}

const cleanedLinesSchema = z
  .array(rawOrderLineSchema)
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
      const quantity = line.quantity?.trim() ?? "";
      const unitPrice = line.unitPrice?.trim() ?? "";

      if (!itemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Product is required",
          path: [index, "itemId"],
        });
      }

      if (!quantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity is required",
          path: [index, "quantity"],
        });
      } else {
        const parsed = Number(quantity);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Quantity must be greater than 0",
            path: [index, "quantity"],
          });
        }
      }

      if (!unitPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unit price is required",
          path: [index, "unitPrice"],
        });
      } else {
        const parsed = Number(unitPrice);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unit price must be greater than 0",
            path: [index, "unitPrice"],
          });
        }
      }

      if (itemId) {
        if (seen.has(itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "This product is already on the order",
            path: [index, "itemId"],
          });
        }
        seen.add(itemId);
      }
    });
  });

const baseSalesOrderSchema = createInsertSchema(salesOrders, {
  customerId: z.string().min(1, "Customer is required"),
  status: z.enum(["draft", "confirmed"]),
  requestedDate: nullableString.refine((value) => {
    if (value == null) return true;
    return isValidIsoDate(value);
  }, "Requested date must be a real date in YYYY-MM-DD format"),
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  orderNumber: true,
  customerName: true,
  fulfilledAt: true,
  totalAmount: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  lines: cleanedLinesSchema,
  confirmOversell: z.boolean().optional(),
});

export const insertSalesOrderSchema = baseSalesOrderSchema;

export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;

const draftUpdateSchema = baseSalesOrderSchema;

const cancelSalesOrderSchema = z.object({
  status: z.literal("cancelled"),
});

export const updateSalesOrderSchema = z.union([draftUpdateSchema, cancelSalesOrderSchema]);
export type UpdateSalesOrder = z.infer<typeof updateSalesOrderSchema>;

export const salesOrderDefaultValues: InsertSalesOrder = {
  customerId: "",
  status: "draft",
  requestedDate: null,
  notes: null,
  lines: [
    {
      itemId: "",
      quantity: null,
      unitPrice: null,
    },
  ],
  confirmOversell: false,
};
