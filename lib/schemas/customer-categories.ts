import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { customerCategories } from "@/lib/db/schema";
import { nullableString } from "./shared";

const baseCustomerCategorySchema = createInsertSchema(customerCategories, {
  name: z.string().trim().min(1, "Name is required"),
  description: nullableString,
}).omit({
  id: true,
  organizationId: true,
  sortOrder: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCustomerCategorySchema = baseCustomerCategorySchema;
export type InsertCustomerCategory = z.infer<typeof insertCustomerCategorySchema>;

export const updateCustomerCategorySchema = baseCustomerCategorySchema;
export type UpdateCustomerCategory = z.infer<typeof updateCustomerCategorySchema>;

export const customerCategoryDefaultValues: InsertCustomerCategory = {
  name: "",
  description: null,
};
