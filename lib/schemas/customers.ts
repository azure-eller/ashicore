import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import { customers } from "@/lib/db/schema";
import { nullableString } from "./shared";

const customerCategoryIdSchema = nullableString.refine(
  (value) => value == null || z.string().uuid().safeParse(value).success,
  "Invalid customer category"
);

const baseCustomerSchema = createInsertSchema(customers, {
  name: z.string().trim().min(1, "Name is required"),
  customerCategoryId: customerCategoryIdSchema,
  email: nullableString,
  phone: nullableString,
  billingLine1: nullableString,
  billingLine2: nullableString,
  billingCity: nullableString,
  billingRegion: nullableString,
  billingPostcode: nullableString,
  billingCountry: nullableString,
  shipLine1: nullableString,
  shipLine2: nullableString,
  shipCity: nullableString,
  shipRegion: nullableString,
  shipPostcode: nullableString,
  shipCountry: nullableString,
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCustomerSchema = baseCustomerSchema;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

export const updateCustomerSchema = baseCustomerSchema;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;

export const customerDefaultValues: InsertCustomer = {
  name: "",
  customerCategoryId: null,
  email: null,
  phone: null,
  billingLine1: null,
  billingLine2: null,
  billingCity: null,
  billingRegion: null,
  billingPostcode: null,
  billingCountry: DEFAULT_COUNTRY,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipRegion: null,
  shipPostcode: null,
  shipCountry: DEFAULT_COUNTRY,
  notes: null,
};
