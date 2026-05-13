import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { addressEntries } from "@/lib/db/schema";
import { nullableString } from "./shared";

const labelString = z
  .string()
  .min(1, "Label is required")
  .max(120, "Label must be 120 characters or fewer")
  .transform((value) => value.trim());

const baseAddressEntrySchema = createInsertSchema(addressEntries, {
  label: labelString,
  contactName: nullableString,
  contactPhone: nullableString,
  line1: nullableString,
  line2: nullableString,
  city: nullableString,
  region: nullableString,
  postcode: nullableString,
  country: nullableString,
  deliveryInstructions: nullableString,
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const createAddressEntrySchema = baseAddressEntrySchema;
export type CreateAddressEntry = z.infer<typeof createAddressEntrySchema>;

export const updateAddressEntrySchema = baseAddressEntrySchema;
export type UpdateAddressEntry = z.infer<typeof updateAddressEntrySchema>;
