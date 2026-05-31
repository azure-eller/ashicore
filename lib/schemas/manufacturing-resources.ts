import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  MANUFACTURING_RESOURCE_TYPES,
  manufacturingResources,
} from "@/lib/db/schema";
import { normalizeNumericScale } from "@/lib/format";
import {
  isNonNegativeNumberString,
  nullableString,
} from "@/lib/schemas/shared";

const loadedCostPerHourSchema = z
  .string()
  .trim()
  .min(1, "Loaded cost per hour is required")
  .refine(isNonNegativeNumberString, "Loaded cost per hour must be a non-negative number")
  .transform((value) => normalizeNumericScale(Number(value), 6));

const baseManufacturingResourceSchema = createInsertSchema(manufacturingResources, {
  name: z.string().trim().min(1, "Name is required"),
  description: nullableString,
  resourceType: z.enum(MANUFACTURING_RESOURCE_TYPES),
  loadedCostPerHour: loadedCostPerHourSchema,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertManufacturingResourceSchema = baseManufacturingResourceSchema;
export type InsertManufacturingResource = z.infer<
  typeof insertManufacturingResourceSchema
>;

export const updateManufacturingResourceSchema = baseManufacturingResourceSchema;
export type UpdateManufacturingResource = z.infer<
  typeof updateManufacturingResourceSchema
>;
