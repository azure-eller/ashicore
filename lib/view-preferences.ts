import { z } from "zod";
import type { GridState } from "ag-grid-community";
import type { ModuleKey } from "@/lib/authz";

export type ViewGridState = Partial<
  Pick<
    GridState,
    | "columnOrder"
    | "columnPinning"
    | "columnSizing"
    | "columnVisibility"
    | "sort"
  >
>;

const gridStateSchema = z
  .custom<ViewGridState>(
    (value) => typeof value === "object" && value != null && !Array.isArray(value)
  )
  .default({});

export const salesOrdersAllocatorPreferenceSchema = z.object({
  version: z.literal(1).default(1),
  updatedAt: z.string().datetime().optional(),
  hiddenProductIds: z.array(z.string().uuid()).default([]),
  collapsedWeeks: z.array(z.string()).default([]),
  unplannedOpen: z.boolean().default(true),
  manufacturingOpen: z.boolean().default(true),
  grid: gridStateSchema.optional(),
});

export type SalesOrdersAllocatorPreference = z.infer<
  typeof salesOrdersAllocatorPreferenceSchema
>;

const viewPreferenceDefinitions = {
  "sales.orders.allocator": {
    module: "sales",
    schema: salesOrdersAllocatorPreferenceSchema,
  },
} satisfies Record<
  string,
  {
    module: ModuleKey;
    schema: z.ZodType<Record<string, unknown>>;
  }
>;

export type ViewPreferenceKey = keyof typeof viewPreferenceDefinitions;

export function getViewPreferenceDefinition(viewKey: string) {
  return viewPreferenceDefinitions[viewKey as ViewPreferenceKey];
}
