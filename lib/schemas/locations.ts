import { z } from "zod";

const locationName = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(100, "Name must be 100 characters or fewer");

const locationCode = z
  .string()
  .trim()
  .min(1, "Code is required")
  .max(40, "Code must be 40 characters or fewer");

export const insertLocationSchema = z.object({
  name: locationName,
  code: locationCode,
});

export const updateLocationSchema = z
  .object({
    name: locationName.optional(),
    code: locationCode.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Nothing to update",
  });

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;
