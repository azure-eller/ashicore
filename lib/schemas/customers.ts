import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import { customers } from "@/lib/db/schema";
import { nullableString, nullableStringStrict } from "./shared";

export const CUSTOMER_ACCOUNT_STATES = [
  "active",
  "growth",
  "at_risk",
  "former",
] as const;
export type CustomerAccountState = (typeof CUSTOMER_ACCOUNT_STATES)[number];

export const CUSTOMER_ACCOUNT_PRIORITIES = [
  "strategic",
  "high",
  "standard",
  "low",
] as const;
export type CustomerAccountPriority =
  (typeof CUSTOMER_ACCOUNT_PRIORITIES)[number];

const customerCategoryIdSchema = nullableString.refine(
  (value) => value == null || z.string().uuid().safeParse(value).success,
  "Invalid customer category"
);
const baseCustomerSchema = createInsertSchema(customers, {
  name: z.string().trim().min(1, "Name is required"),
  customerCategoryId: customerCategoryIdSchema,
  accountState: z.enum(CUSTOMER_ACCOUNT_STATES).default("active"),
  accountPriority: z.enum(CUSTOMER_ACCOUNT_PRIORITIES).default("standard"),
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

export const patchCustomerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").optional(),
    customerCategoryId: customerCategoryIdSchema.optional(),
    accountState: z.enum(CUSTOMER_ACCOUNT_STATES).optional(),
    accountPriority: z.enum(CUSTOMER_ACCOUNT_PRIORITIES).optional(),
    email: nullableStringStrict.optional(),
    phone: nullableStringStrict.optional(),
    billingLine1: nullableStringStrict.optional(),
    billingLine2: nullableStringStrict.optional(),
    billingCity: nullableStringStrict.optional(),
    billingRegion: nullableStringStrict.optional(),
    billingPostcode: nullableStringStrict.optional(),
    billingCountry: nullableStringStrict.optional(),
    shipLine1: nullableStringStrict.optional(),
    shipLine2: nullableStringStrict.optional(),
    shipCity: nullableStringStrict.optional(),
    shipRegion: nullableStringStrict.optional(),
    shipPostcode: nullableStringStrict.optional(),
    shipCountry: nullableStringStrict.optional(),
  })
  .refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
  );
export type PatchCustomer = z.infer<typeof patchCustomerSchema>;

export const customerDefaultValues: InsertCustomer = {
  name: "",
  customerCategoryId: null,
  accountState: "active",
  accountPriority: "standard",
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
};
