import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { unitDefinitions } from "@/lib/db/schema";
import { getUomOptions } from "@/lib/units-of-measure";
import { positiveQuantityString } from "./shared";

const validUomValues = getUomOptions().flatMap((g) => g.options.map((o) => o.value));

export const insertUnitDefinitionSchema = createInsertSchema(unitDefinitions, {
  name: z.string().min(1, "Name is required"),
  size: positiveQuantityString("Size"),
  uom: z.enum(validUomValues as [string, ...string[]], {
    message: "Invalid unit of measure",
  }),
}).omit({
  id: true,
  organizationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUnitDefinition = z.infer<typeof insertUnitDefinitionSchema>;
