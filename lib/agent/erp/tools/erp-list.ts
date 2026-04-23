import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { ERP_ENTITY_MODULE, ERP_READ_MODULES, erpListOutputSchema } from "@/lib/agent/erp/read-models/types";
import { listEntityForAgent } from "@/lib/agent/erp/read-models/list";
import { clampLimit, MAX_LIST_LIMIT, normalizeOffset } from "@/lib/agent/erp/tools/generic-helpers";
import { SALES_ORDER_STATUSES } from "@/lib/schemas/sales-orders";
import { PURCHASE_ORDER_STATUSES } from "@/lib/schemas/purchase-orders";
import { MANUFACTURING_ORDER_STATUSES } from "@/lib/schemas/manufacturing-orders";
import { STOCKTAKE_STATUSES } from "@/lib/schemas/stocktakes";
import { isValidIsoDate } from "@/lib/schemas/shared";

const isoDateString = z
  .string()
  .refine(isValidIsoDate, "Date must be a real calendar date in YYYY-MM-DD format")
  .optional();

const paginationSchema = {
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
};

const erpListInputSchema = z.discriminatedUnion("entityType", [
  z.strictObject({
    entityType: z.literal("customer"),
    search: z.string().trim().optional(),
    activeOnly: z.boolean().optional(),
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("customer_category"),
    search: z.string().trim().optional(),
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("supplier"),
    search: z.string().trim().optional(),
    activeOnly: z.boolean().optional(),
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("item"),
    search: z.string().trim().optional(),
    itemType: z.enum(["material", "product"]).optional(),
    view: z.enum(["products", "sub-assemblies"]).optional(),
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("sales_order"),
    search: z.string().trim().optional(),
    status: z.array(z.enum(SALES_ORDER_STATUSES)).optional(),
    customerId: z.string().uuid().optional(),
    dateFrom: isoDateString,
    dateTo: isoDateString,
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("purchase_order"),
    search: z.string().trim().optional(),
    status: z.array(z.enum(PURCHASE_ORDER_STATUSES)).optional(),
    supplierId: z.string().uuid().optional(),
    dateFrom: isoDateString,
    dateTo: isoDateString,
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("manufacturing_order"),
    search: z.string().trim().optional(),
    status: z.array(z.enum(MANUFACTURING_ORDER_STATUSES)).optional(),
    productId: z.string().uuid().optional(),
    ...paginationSchema,
  }),
  z.strictObject({
    entityType: z.literal("stocktake"),
    search: z.string().trim().optional(),
    status: z.array(z.enum(STOCKTAKE_STATUSES)).optional(),
    ...paginationSchema,
  }),
]);

type ErpListInput = z.infer<typeof erpListInputSchema>;

const DESCRIPTION = `
Use this for structured listing when you already know the entity type you want to inspect. ALWAYS use erp_list instead of erp_search when you need filters such as status, customer, supplier, product, or date ranges. NEVER use this for fuzzy cross-entity discovery; erp_search is better for that. This tool returns compact list rows, not full detail for one record. Use erp_get after you identify the exact record you want to inspect. Results are paginated with limit and offset. Default limit is 25 and maximum limit is 100.
`.trim();

export const erpListTool = buildTool({
  name: "erp_list",
  description: DESCRIPTION,
  searchHint: "list ERP records for a known entity type with filters",
  module: "multiple",
  supportedModules: [...ERP_READ_MODULES],
  accessLevel: "read",
  riskClass: "read",
  inputSchema: erpListInputSchema,
  outputSchema: erpListOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  getAccessRequirement(input: ErpListInput) {
    return {
      match: "all",
      entries: [
        {
          module: ERP_ENTITY_MODULE[input.entityType],
          level: "read",
        },
      ],
    };
  },
  async call(input: ErpListInput) {
    return listEntityForAgent({
      ...input,
      limit: clampLimit(input.limit),
      offset: normalizeOffset(input.offset),
    } as never);
  },
});
