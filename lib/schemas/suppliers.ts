import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { suppliers } from "@/lib/db/schema";
import { nullableString } from "./shared";

const nullableEmail = nullableString.refine(
  (value) => value == null || z.string().email().safeParse(value).success,
  "Email must be a valid email address"
);

const baseSupplierSchema = createInsertSchema(suppliers, {
  name: z.string().trim().min(1, "Name is required"),
  code: nullableString,
  contactName: nullableString,
  email: nullableEmail,
  phone: nullableString,
  billingLine1: nullableString,
  billingLine2: nullableString,
  billingCity: nullableString,
  billingRegion: nullableString,
  billingPostcode: nullableString,
  billingCountry: nullableString,
  paymentTerms: nullableString,
  notes: nullableString,
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupplierSchema = baseSupplierSchema;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;

export const updateSupplierSchema = baseSupplierSchema;
export type UpdateSupplier = z.infer<typeof updateSupplierSchema>;

export const supplierDefaultValues: InsertSupplier = {
  name: "",
  code: null,
  contactName: null,
  email: null,
  phone: null,
  billingLine1: null,
  billingLine2: null,
  billingCity: null,
  billingRegion: null,
  billingPostcode: null,
  billingCountry: null,
  paymentTerms: null,
  notes: null,
};
