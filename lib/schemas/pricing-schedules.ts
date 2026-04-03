import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pricingSchedules } from "@/lib/db/schema";
import { nullableString, positiveDecimalString } from "./shared";

const customerCategoryIdSchema = nullableString.refine(
  (value) => value == null || z.string().uuid().safeParse(value).success,
  "Invalid customer category"
);

const quantitySchema = positiveDecimalString("Quantity");

const maxQuantitySchema = nullableString.refine((value) => {
  if (value == null) return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}, "Maximum quantity must be greater than 0");

const discountPercentSchema = z
  .string()
  .trim()
  .min(1, "Discount percent is required")
  .refine((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0;
  }, "Discount percent must be 0 or greater")
  .refine((value) => Number(value) <= 100, "Discount percent cannot exceed 100");

const pricingScheduleBreakSchema = z
  .object({
    minQuantity: quantitySchema,
    maxQuantity: maxQuantitySchema,
    discountPercent: discountPercentSchema,
  })
  .superRefine((value, ctx) => {
    if (value.maxQuantity == null) return;

    if (Number(value.maxQuantity) < Number(value.minQuantity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Maximum quantity must be greater than or equal to the minimum quantity",
        path: ["maxQuantity"],
      });
    }
  });

const pricingScheduleBreaksSchema = z
  .array(pricingScheduleBreakSchema)
  .min(1, "At least one quantity break is required")
  .superRefine((breaks, ctx) => {
    for (let index = 1; index < breaks.length; index += 1) {
      const previous = breaks[index - 1];
      const current = breaks[index];

      if (previous.maxQuantity == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Open-ended quantity breaks must be the last row",
          path: [index - 1, "maxQuantity"],
        });
        return;
      }

      if (Number(current.minQuantity) <= Number(previous.maxQuantity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity breaks cannot overlap and must stay in ascending order",
          path: [index, "minQuantity"],
        });
      }
    }
  });

const basePricingScheduleSchema = createInsertSchema(pricingSchedules, {
  name: z.string().trim().min(1, "Name is required"),
  customerCategoryId: customerCategoryIdSchema,
  unitDefinitionId: z.string().min(1, "Unit is required"),
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  breaks: pricingScheduleBreaksSchema,
});

export const insertPricingScheduleSchema = basePricingScheduleSchema;
export type InsertPricingSchedule = z.infer<typeof insertPricingScheduleSchema>;

export const updatePricingScheduleSchema = basePricingScheduleSchema;
export type UpdatePricingSchedule = z.infer<typeof updatePricingScheduleSchema>;

export const resolveSalesLinePricingSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  itemId: z.string().min(1, "Product is required"),
  quantity: nullableString,
});
export type ResolveSalesLinePricingInput = z.infer<
  typeof resolveSalesLinePricingSchema
>;

export const pricingScheduleDefaultValues: InsertPricingSchedule = {
  name: "",
  customerCategoryId: null,
  unitDefinitionId: "",
  notes: null,
  breaks: [
    {
      minQuantity: "1",
      maxQuantity: null,
      discountPercent: "0",
    },
  ],
};
