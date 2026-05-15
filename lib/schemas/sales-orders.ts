import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import { salesOrders } from "@/lib/db/schema";
import {
  isValidIsoDate,
  nullableString,
  optionalMoneyString,
  positiveMoneyString,
} from "./shared";

export const SALES_ORDER_STATUSES = ["open", "done"] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const SALES_SHIPMENT_STATUSES = ["draft", "shipped", "cancelled"] as const;
export type SalesShipmentStatus = (typeof SALES_SHIPMENT_STATUSES)[number];

export const SALES_SHIPMENT_FULFILLMENT_TYPES = ["delivery", "pickup"] as const;
export type SalesShipmentFulfillmentType =
  (typeof SALES_SHIPMENT_FULFILLMENT_TYPES)[number];

export const SALES_SHIPMENT_COST_TYPES = [
  "freight",
  "delivery_labor",
  "fuel",
  "packaging",
  "accessorial",
  "other",
] as const;
export type SalesShipmentCostType = (typeof SALES_SHIPMENT_COST_TYPES)[number];

export const SALES_SHIPMENT_COST_STATUSES = ["estimated", "actual"] as const;
export type SalesShipmentCostStatus =
  (typeof SALES_SHIPMENT_COST_STATUSES)[number];

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
    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const itemId = line.itemId.trim();
      const quantity = line.quantity?.trim() ?? "";
      const unitPrice = line.unitPrice?.trim() ?? "";

      if (!itemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Item is required",
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
            message: "This item is already on the order",
            path: [index, "itemId"],
          });
        }
        seen.add(itemId);
      }
    });
  });

const baseSalesOrderSchema = createInsertSchema(salesOrders, {
  orderNumber: nullableString.refine(
    (value) => value == null || value.length <= 32,
    "Order number must be 32 characters or fewer"
  ),
  customerId: z.string().min(1, "Customer is required"),
  customerProjectId: nullableString.refine(
    (value) => value == null || z.string().uuid().safeParse(value).success,
    "Invalid project"
  ),
  status: z
    .enum(["open", "done"])
    .optional()
    .transform(() => "open" as const),
  orderDate: z
    .string()
    .optional()
    .transform((value) => value ?? new Date().toISOString().slice(0, 10))
    .refine((value) => {
      return isValidIsoDate(value);
    }, "Order date must be a real date in YYYY-MM-DD format"),
  requestedDate: nullableString.refine((value) => {
    if (value == null) return true;
    return isValidIsoDate(value);
  }, "Delivery date must be a real date in YYYY-MM-DD format"),
  shipDate: nullableString.refine((value) => {
    if (value == null) return true;
    return isValidIsoDate(value);
  }, "Shipping date must be a real date in YYYY-MM-DD format"),
  notes: nullableString,
  shipLine1: nullableString,
  shipLine2: nullableString,
  shipCity: nullableString,
  shipRegion: nullableString,
  shipPostcode: nullableString,
  shipCountry: nullableString,
}).omit({
  id: true,
  organizationId: true,
  customerName: true,
  shippedAt: true,
  priorityRank: true,
  totalAmount: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    lines: cleanedLinesSchema,
    confirmOversell: z.boolean().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.status === "open" && values.lines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sales order must have at least one line item",
        path: ["lines"],
      });
    }

    if (values.status === "open" && !values.shipDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ship date is required to create a sales order",
        path: ["shipDate"],
      });
    }

    if (values.shipDate && values.orderDate && values.shipDate < values.orderDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ship date cannot be before order date",
        path: ["shipDate"],
      });
    }

    if (
      values.shipDate &&
      values.requestedDate &&
      values.requestedDate < values.shipDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery date cannot be before shipping date",
        path: ["requestedDate"],
      });
    }
  });

export const insertSalesOrderSchema = baseSalesOrderSchema;

export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;

export const updateSalesOrderSchema = baseSalesOrderSchema;
export type UpdateSalesOrder = z.infer<typeof updateSalesOrderSchema>;

export const confirmSalesOrderSchema = z.object({
  confirmOversell: z.boolean().optional(),
});
export type ConfirmSalesOrder = z.infer<typeof confirmSalesOrderSchema>;

export const reorderSalesOrderPriorityRanksSchema = z.object({
  orderIds: z
    .array(z.string().uuid("Sales order is required"))
    .min(1, "At least one sales order is required")
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();

      ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Sales order appears more than once",
            path: [index],
          });
        }
        seen.add(id);
      });
    }),
});
export type ReorderSalesOrderPriorityRanks = z.infer<
  typeof reorderSalesOrderPriorityRanksSchema
>;

export const bulkConfirmSalesOrdersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  confirmOversell: z.boolean().optional(),
});
export type BulkConfirmSalesOrders = z.infer<typeof bulkConfirmSalesOrdersSchema>;

const rawShipmentLineSchema = z.object({
  salesOrderLineId: z.string().min(1, "Line is required"),
  quantity: nullableString,
});

const shipmentLinesSchema = z
  .array(rawShipmentLineSchema)
  .transform((lines) =>
    lines.filter((line) => (line.quantity?.trim() ?? "") !== "")
  )
  .superRefine((lines, ctx) => {
    if (lines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one shipment line is required",
        path: [],
      });
      return;
    }

    const seen = new Set<string>();
    lines.forEach((line, index) => {
      if (seen.has(line.salesOrderLineId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This order line is already included",
          path: [index, "quantity"],
        });
      }
      seen.add(line.salesOrderLineId);

      const quantity = line.quantity?.trim() ?? "";
      const parsed = Number(quantity);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity must be greater than 0",
          path: [index, "quantity"],
        });
      }
    });
  });

export const salesShipmentInputSchema = z.object({
  fulfillmentType: z.enum(SALES_SHIPMENT_FULFILLMENT_TYPES).default("delivery"),
  scheduledDate: nullableString.refine((value) => {
    if (value == null) return true;
    return isValidIsoDate(value);
  }, "Scheduled date must be a real date in YYYY-MM-DD format"),
  notes: nullableString,
  lines: shipmentLinesSchema,
});
export type SalesShipmentInput = z.infer<typeof salesShipmentInputSchema>;

export const salesFulfillmentPlanInputSchema = z.object({
  deliveryDate: z
    .string()
    .min(1, "Delivery date is required")
    .refine(
      (value) => isValidIsoDate(value),
      "Delivery date must be a real date in YYYY-MM-DD format"
    ),
  fulfillmentType: z.enum(SALES_SHIPMENT_FULFILLMENT_TYPES).default("delivery"),
  shipmentId: z.string().uuid().nullable().optional(),
  shipmentNotes: nullableString,
  shipmentLines: shipmentLinesSchema,
});
export type SalesFulfillmentPlanInput = z.infer<
  typeof salesFulfillmentPlanInputSchema
>;

export const shipSalesShipmentSchema = z.object({
  syncAccounting: z.boolean().optional(),
  confirmNegativeStock: z.boolean().optional(),
});
export type ShipSalesShipment = z.infer<typeof shipSalesShipmentSchema>;

export const salesShipmentCostsInputSchema = z.object({
  customerFreightChargeAmount: optionalMoneyString(),
  costs: z.array(
    z.object({
      costType: z.enum(SALES_SHIPMENT_COST_TYPES),
      costStatus: z.enum(SALES_SHIPMENT_COST_STATUSES),
      amount: positiveMoneyString(),
      vendorName: nullableString,
      referenceNumber: nullableString,
      incurredDate: nullableString.refine((value) => {
        if (value == null) return true;
        return isValidIsoDate(value);
      }, "Incurred date must be a real date in YYYY-MM-DD format"),
      notes: nullableString,
    })
  ),
});
export type SalesShipmentCostsInput = z.infer<
  typeof salesShipmentCostsInputSchema
>;

export const salesOrderDefaultValues: InsertSalesOrder = {
  orderNumber: null,
  customerId: "",
  customerProjectId: null,
  status: "open",
  orderDate: new Date().toISOString().slice(0, 10),
  shipDate: null,
  requestedDate: null,
  notes: null,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipRegion: null,
  shipPostcode: null,
  shipCountry: DEFAULT_COUNTRY,
  lines: [
    {
      itemId: "",
      quantity: null,
      unitPrice: null,
    },
  ],
  confirmOversell: false,
};
