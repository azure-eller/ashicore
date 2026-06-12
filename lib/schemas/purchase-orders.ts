import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { purchaseOrders } from "@/lib/db/schema";
import {
  isNonNegativeNumberString,
  isPositiveNumberString,
  isValidIsoDate,
  nullableString,
  nullableStringPreserveUndefined,
} from "./shared";

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partial",
  "received",
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
  taxRateId: nullableStringPreserveUndefined,
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
  supplierId: nullableString.optional(),
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
      const taxRateId = line.taxRateId?.trim() ?? "";

      if (!itemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Item is required",
          path: [index, "itemId"],
        });
      } else if (seen.has(itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This item is already on the purchase order",
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
        if (!isPositiveNumberString(quantityOrdered)) {
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
        if (!isNonNegativeNumberString(unitCost)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unit cost must be 0 or greater",
            path: [index, "unitCost"],
          });
        }
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

const cleanedAdditionalCostsSchema = z
  .array(rawAdditionalCostSchema)
  .default([])
  .transform((costs) => costs.filter((cost) => !isBlankAdditionalCost(cost)))
  .superRefine((costs, ctx) => {
    costs.forEach((cost, index) => {
      const amount = cost.amount?.trim() ?? "";
      const supplierId =
        cost.supplierId?.trim() ?? "";
      if (
        supplierId &&
        !z.string().uuid().safeParse(supplierId).success
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid supplier",
          path: [index, "supplierId"],
        });
      }

      if (!amount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Amount is required",
          path: [index, "amount"],
        });
        return;
      }

      if (!isNonNegativeNumberString(amount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Amount must be 0 or greater",
          path: [index, "amount"],
        });
      }
    });
  });

const basePurchaseOrderSchema = createInsertSchema(purchaseOrders, {
  orderNumber: z
    .string()
    .trim()
    .min(1, "Purchase order number is required")
    .max(32, "Purchase order number must be 32 characters or fewer")
    .optional()
    .nullable(),
  supplierId: z.string().min(1, "Supplier is required"),
  expectedDate: nullableString.refine(
    (value) => value == null || isValidIsoDate(value),
    "Expected date must be a real date in YYYY-MM-DD format",
  ),
  shippingCost: nullableString.superRefine((value, ctx) => {
    const normalized = value?.trim() ?? "";
    if (!normalized) return;
    if (!isNonNegativeNumberString(normalized)) {
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
  supplierName: true,
  parentPurchaseOrderId: true,
  type: true,
  status: true,
  subtotalAmount: true,
  taxAmount: true,
  totalAmount: true,
  orderedAt: true,
  receivedAt: true,
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
    // Receiving location; omitted = default (mobile sends no locationId).
    locationId: z.string().uuid().nullish(),
  })
  .transform(({ lines, confirmOverReceipt, locationId }) => ({
    confirmOverReceipt: confirmOverReceipt ?? false,
    locationId: locationId ?? null,
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
      if (!isPositiveNumberString(line.quantityReceived)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Received quantity must be greater than 0",
          path: ["lines", index, "quantityReceived"],
        });
      }
    });
  });

export type ReceivePurchaseOrder = z.infer<typeof receivePurchaseOrderSchema>;

const purchaseBillGroupSchema = z.object({
  groupKey: z.string().trim().min(1),
  include: z.boolean().optional(),
  invoiceNumber: z.string().trim().optional(),
  accountingPurchaseAccountCode: z.string().trim().optional(),
  additionalCostIds: z.array(z.uuid()).optional(),
}).superRefine((group, ctx) => {
  if (group.include === false) return;
  if (!group.invoiceNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Supplier invoice number is required",
      path: ["invoiceNumber"],
    });
  }
  if (!group.accountingPurchaseAccountCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Account is required",
      path: ["accountingPurchaseAccountCode"],
    });
  }
});

const createPurchaseBillBaseObjectSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Supplier invoice number is required"),
  billDate: z.string().refine(isValidIsoDate, "Bill date must be a real date in YYYY-MM-DD format"),
  dueDate: z.string().refine(isValidIsoDate, "Due date must be a real date in YYYY-MM-DD format"),
  reference: nullableString,
  accountingPurchaseAccountCode: z.string().trim().min(1, "Account is required"),
  confirmAdditionalCostsOmitted: z.boolean().optional(),
}).strict();

function refinePurchaseBillDates(
  data: { billDate: string; dueDate: string },
  ctx: z.RefinementCtx,
) {
    if (data.dueDate < data.billDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Due date cannot be before bill date",
        path: ["dueDate"],
      });
    }
}

const createPurchaseBillBaseSchema =
  createPurchaseBillBaseObjectSchema.superRefine(refinePurchaseBillDates);

export const createPurchaseBillSchema = z
  .union([
    createPurchaseBillBaseObjectSchema
      .extend({
        groups: z.array(purchaseBillGroupSchema).min(1),
      })
      .superRefine((data, ctx) => {
        refinePurchaseBillDates(data, ctx);
        const invoiceNumbers = new Map<string, number>();
        data.groups.forEach((group, index) => {
          if (group.include === false || !group.invoiceNumber) return;
          const normalized = group.invoiceNumber.trim().toLowerCase();
          const firstIndex = invoiceNumbers.get(normalized);
          if (firstIndex == null) {
            invoiceNumbers.set(normalized, index);
            return;
          }
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invoice numbers must be unique per bill group",
            path: ["groups", index, "invoiceNumber"],
          });
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invoice numbers must be unique per bill group",
            path: ["groups", firstIndex, "invoiceNumber"],
          });
        });
      }),
    createPurchaseBillBaseSchema,
  ])
  .transform((data) =>
    "groups" in data
      ? { ...data, legacySingleBillInput: false as const }
      : {
          ...data,
          legacySingleBillInput: true as const,
          groups: [
            {
              groupKey: "default",
              include: true,
              invoiceNumber: data.invoiceNumber,
              accountingPurchaseAccountCode: data.accountingPurchaseAccountCode,
            },
          ],
        },
  );

export type CreatePurchaseBill = z.infer<typeof createPurchaseBillSchema>;

const purchaseOrderEmailBaseComposerSchema = z.object({
  groupKey: z.string().trim().min(1).optional(),
  include: z.boolean().optional(),
  resend: z.boolean().optional(),
  includePdf: z.boolean().optional(),
  to: z.string().trim().optional(),
  replyTo: z.email("Reply-to must be a valid email address").optional().nullable(),
  bcc: z.email("Bcc must be a valid email address").optional().nullable(),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional().nullable(),
  attachmentFileIds: z.array(z.string().uuid()).optional(),
});

const purchaseOrderEmailGroupSchema =
  purchaseOrderEmailBaseComposerSchema.superRefine((group, ctx) => {
    if (group.include === false) return;
    if (!group.to || !z.email().safeParse(group.to).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Supplier email must be a valid email address",
        path: ["to"],
      });
    }
    if (!group.subject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Subject is required",
        path: ["subject"],
      });
    }
    if (
      group.includePdf === false &&
      (group.attachmentFileIds?.length ?? 0) === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one document to send",
        path: ["attachmentFileIds"],
      });
    }
  });

const purchaseOrderEmailComposerSchema =
  purchaseOrderEmailBaseComposerSchema.extend({
    to: z.email("Supplier email must be a valid email address"),
    subject: z.string().trim().min(1, "Subject is required").max(200),
  }).superRefine((input, ctx) => {
    if (
      input.includePdf === false &&
      (input.attachmentFileIds?.length ?? 0) === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one document to send",
        path: ["attachmentFileIds"],
      });
    }
  });

export const sendPurchaseOrderEmailSchema = z
  .union([
    z.object({
      groups: z.array(purchaseOrderEmailGroupSchema).min(1),
    }),
    purchaseOrderEmailComposerSchema,
  ])
  .transform((data) =>
    "groups" in data
      ? { groups: data.groups }
      : { groups: [{ ...data, groupKey: data.groupKey ?? "default" }] },
  );

export type SendPurchaseOrderEmail = z.infer<typeof sendPurchaseOrderEmailSchema>;

export const purchaseOrderDefaultValues: InsertPurchaseOrder = {
  orderNumber: null,
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
      taxRateId: null,
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
