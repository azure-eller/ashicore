import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import { salesOrders } from "@/lib/db/schema";
import { normalizeMoney } from "@/lib/format";
import {
  isNonNegativeNumberString,
  isPositiveNumberString,
  isValidIsoDate,
  nullableString,
  nullableStringStrict,
  nullableStringPreserveUndefined,
  optionalMoneyString,
  positiveMoneyString,
} from "./shared";
import { PRICING_SOURCE_TYPES } from "./pricing-schedules";

export const SALES_ORDER_STATUSES = ["open", "done"] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const SALES_SHIPMENT_STATUSES = ["planned", "shipped"] as const;
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
  listUnitPrice: nullableString.optional(),
  unitPrice: nullableString,
  taxRateId: nullableStringPreserveUndefined,
  discountPercent: nullableString.optional(),
  suggestedUnitPrice: nullableString.optional(),
  pricingSourceType: z.enum(PRICING_SOURCE_TYPES).nullable().optional(),
  pricingScheduleName: nullableString.optional(),
  pricingBreakLabel: nullableString.optional(),
  isPriceOverridden: z.boolean().optional(),
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
      const taxRateId = line.taxRateId?.trim() ?? "";

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
        if (!isPositiveNumberString(quantity)) {
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
        if (!isPositiveNumberString(unitPrice)) {
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

      if (taxRateId && !z.string().uuid().safeParse(taxRateId).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid tax rate",
          path: [index, "taxRateId"],
        });
      }
    });
  });

const rawOrderShipmentLineSchema = z.object({
  itemId: z.string().default(""),
  quantity: nullableString,
});

type RawOrderShipmentLine = z.input<typeof rawOrderShipmentLineSchema>;

const rawOrderShipmentSchema = z.object({
  fulfillmentType: z.enum(SALES_SHIPMENT_FULFILLMENT_TYPES).default("delivery"),
  scheduledDate: nullableString,
  deliveryDate: nullableString,
  notes: nullableString,
  lines: z.array(rawOrderShipmentLineSchema).default([]),
});

type RawOrderShipment = z.input<typeof rawOrderShipmentSchema>;

function isBlankShipmentLine(line: RawOrderShipmentLine) {
  const itemId = typeof line.itemId === "string" ? line.itemId.trim() : "";
  const quantity = line.quantity?.trim() ?? "";
  return itemId === "" && quantity === "";
}

function isBlankShipment(shipment: RawOrderShipment) {
  const scheduledDate = shipment.scheduledDate?.trim() ?? "";
  const deliveryDate = shipment.deliveryDate?.trim() ?? "";
  const notes = shipment.notes?.trim() ?? "";
  const lines = shipment.lines ?? [];
  return (
    scheduledDate === "" &&
    deliveryDate === "" &&
    notes === "" &&
    lines.every(isBlankShipmentLine)
  );
}

const cleanedOrderShipmentsSchema = z
  .array(rawOrderShipmentSchema)
  .default([])
  .transform((shipments) =>
    shipments
      .filter((shipment) => !isBlankShipment(shipment))
      .map((shipment) => ({
        ...shipment,
        deliveryDate: shipment.scheduledDate,
        lines: shipment.lines.filter((line) => !isBlankShipmentLine(line)),
      }))
  )
  .superRefine((shipments, ctx) => {
    shipments.forEach((shipment, index) => {
      if (!shipment.scheduledDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ship date is required",
          path: [index, "scheduledDate"],
        });
      } else if (!isValidIsoDate(shipment.scheduledDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ship date must be a real date in YYYY-MM-DD format",
          path: [index, "scheduledDate"],
        });
      }

      if (shipment.lines.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one shipment quantity is required",
          path: [index, "lines"],
        });
      }

      const seen = new Set<string>();
      shipment.lines.forEach((line, lineIndex) => {
        const itemId = line.itemId.trim();
        const quantity = line.quantity?.trim() ?? "";

        if (!itemId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Item is required",
            path: [index, "lines", lineIndex, "itemId"],
          });
        } else if (seen.has(itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "This item is already included",
            path: [index, "lines", lineIndex, "itemId"],
          });
        }
        seen.add(itemId);

        if (!isPositiveNumberString(quantity)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Quantity must be greater than 0",
            path: [index, "lines", lineIndex, "quantity"],
          });
        }
      });
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
  requestedDate: nullableString,
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
  billingLine1: nullableString,
  billingLine2: nullableString,
  billingCity: nullableString,
  billingRegion: nullableString,
  billingPostcode: nullableString,
  billingCountry: nullableString,
  shippingFeeDescription: nullableString,
  shippingFeeAmount: optionalMoneyString(),
  shippingFeeTaxAmount: optionalMoneyString(),
}).omit({
  id: true,
  organizationId: true,
  customerName: true,
  shippedAt: true,
  priorityRank: true,
  subtotalAmount: true,
  taxAmount: true,
  totalAmount: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    lines: cleanedLinesSchema,
    shipments: cleanedOrderShipmentsSchema.default([]),
    confirmOversell: z.boolean().optional(),
  })
  .superRefine((values, ctx) => {
    const orderQtyByItemId = new Map<string, number>();
    values.lines.forEach((line) => {
      orderQtyByItemId.set(line.itemId, Number(line.quantity));
    });

    const shipmentQtyByItemId = new Map<string, number>();
    values.shipments.forEach((shipment, shipmentIndex) => {
      shipment.lines.forEach((line, lineIndex) => {
        if (!orderQtyByItemId.has(line.itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Shipment item must be on the order",
            path: ["shipments", shipmentIndex, "lines", lineIndex, "itemId"],
          });
          return;
        }

        shipmentQtyByItemId.set(
          line.itemId,
          (shipmentQtyByItemId.get(line.itemId) ?? 0) + Number(line.quantity)
        );
      });
    });

    shipmentQtyByItemId.forEach((quantity, itemId) => {
      const orderQty = orderQtyByItemId.get(itemId) ?? 0;
      if (quantity <= orderQty) return;

      values.shipments.forEach((shipment, shipmentIndex) => {
        const lineIndex = shipment.lines.findIndex((line) => line.itemId === itemId);
        if (lineIndex < 0) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Shipment quantities cannot exceed ordered quantity",
          path: ["shipments", shipmentIndex, "lines", lineIndex, "quantity"],
        });
      });
    });
  });

export const insertSalesOrderSchema = baseSalesOrderSchema;

export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;

export const updateSalesOrderSchema = baseSalesOrderSchema;
export type UpdateSalesOrder = z.infer<typeof updateSalesOrderSchema>;

const patchNullableString = nullableStringStrict.optional();
const patchMoneyString = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value == null) return null;
    return value.trim() || null;
  })
  .refine((value) => {
    if (value == null) return true;
    return isNonNegativeNumberString(value);
  }, "Amount must be a non-negative number")
  .transform((value) => {
    if (value == null) return value;
    return normalizeMoney(Number(value));
  })
  .optional();

/**
 * Partial header-only patch for the inline-edit flow on the new Calm Matrix
 * Sales Order page. Mirrors the Item Detail PATCH pattern: every field is
 * optional, lines and shipments are NOT touched, no idempotency-replay of the
 * full order. Use this for per-field saves; use `updateSalesOrderSchema` for
 * the legacy full-document PUT.
 */
export const patchSalesOrderHeaderSchema = z
  .object({
    orderNumber: patchNullableString
      .refine(
        (value) => value == null || value.length <= 32,
        "Order number must be 32 characters or fewer"
      ),
    customerId: z.string().min(1, "Customer is required").optional(),
    customerProjectId: patchNullableString
      .refine(
        (value) => value == null || z.string().uuid().safeParse(value).success,
        "Invalid project"
      ),
    orderDate: z
      .string()
      .refine(
        (value) => isValidIsoDate(value),
        "Order date must be a real date in YYYY-MM-DD format"
      )
      .optional(),
    shipDate: patchNullableString
      .refine(
        (value) => value == null || isValidIsoDate(value),
        "Shipping date must be a real date in YYYY-MM-DD format"
      ),
    requestedDate: patchNullableString,
    notes: patchNullableString,
    shipLine1: patchNullableString,
    shipLine2: patchNullableString,
    shipCity: patchNullableString,
    shipRegion: patchNullableString,
    shipPostcode: patchNullableString,
    shipCountry: patchNullableString,
    billingLine1: patchNullableString,
    billingLine2: patchNullableString,
    billingCity: patchNullableString,
    billingRegion: patchNullableString,
    billingPostcode: patchNullableString,
    billingCountry: patchNullableString,
    shippingFeeDescription: patchNullableString,
    shippingFeeAmount: patchMoneyString,
    shippingFeeTaxAmount: patchMoneyString,
  })
  .strict();
export type PatchSalesOrderHeader = z.infer<typeof patchSalesOrderHeaderSchema>;

/**
 * Per-line patch for inline-edit cells in the line items table (§2). Touches
 * only `sales_order_lines`; does not recreate shipments or release
 * reservations. Use {@link updateSalesOrderSchema} via PUT for line add/remove
 * or item changes, which still need the full-order recreation flow.
 */
export const patchSalesOrderLineSchema = z
  .object({
    quantity: positiveMoneyString().optional(),
    unitPrice: positiveMoneyString().optional(),
    taxRateId: nullableStringStrict
      .refine(
        (value) => value == null || z.string().uuid().safeParse(value).success,
        "Invalid tax rate",
      )
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Patch must include at least one field",
  );
export type PatchSalesOrderLine = z.infer<typeof patchSalesOrderLineSchema>;

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
      if (!isPositiveNumberString(quantity)) {
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
  }, "Ship date must be a real date in YYYY-MM-DD format"),
  deliveryDate: nullableString,
  notes: nullableString,
  splitFromShipmentId: z.string().uuid().nullable().optional(),
  lines: shipmentLinesSchema,
});
export type SalesShipmentInput = z.infer<typeof salesShipmentInputSchema>;

export const salesFulfillmentPlanInputSchema = z.object({
  shipDate: nullableString.refine((value) => {
    if (value == null) return true;
    return isValidIsoDate(value);
  }, "Ship date must be a real date in YYYY-MM-DD format"),
  deliveryDate: nullableString,
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

export const shipSalesOrderSchema = z.object({
  syncAccounting: z.boolean().optional(),
  confirmNegativeStock: z.boolean().optional(),
  completeLinkedManufacturing: z.boolean().optional(),
  lines: shipmentLinesSchema.optional(),
});
export type ShipSalesOrder = z.infer<typeof shipSalesOrderSchema>;

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
  billingLine1: null,
  billingLine2: null,
  billingCity: null,
  billingRegion: null,
  billingPostcode: null,
  billingCountry: null,
  shippingFeeDescription: null,
  shippingFeeAmount: null,
  shippingFeeTaxAmount: null,
  lines: [
    {
      itemId: "",
      quantity: null,
      unitPrice: null,
      taxRateId: null,
    },
  ],
  shipments: [],
  confirmOversell: false,
};
