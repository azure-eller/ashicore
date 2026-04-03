import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
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
  address: nullableString,
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
  address: null,
  notes: null,
};
