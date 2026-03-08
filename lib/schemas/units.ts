import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { unitDefinitions } from "@/lib/db/schema";

export const insertUnitDefinitionSchema = createInsertSchema(unitDefinitions, {
  name: z.string().min(1, "Name is required"),
  size: z.string().min(1, "Size is required").regex(/^\d+\.?\d*$/, "Must be a number"),
  uom: z.string().min(1, "Unit of measure is required"),
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUnitDefinition = z.infer<typeof insertUnitDefinitionSchema>;
