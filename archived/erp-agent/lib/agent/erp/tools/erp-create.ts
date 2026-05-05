import { z } from "zod";
import { hasModuleAccess } from "@/lib/authz";
import { buildTool } from "@/lib/agent/core/Tool";
import { createEntityForAgent } from "@/lib/agent/erp/read-models/list";
import { ERP_ENTITY_MODULE, erpWriteOutputSchema } from "@/lib/agent/erp/read-models/types";
import { buildCreatePreview } from "@/lib/agent/erp/tools/generic-helpers";
import { insertCustomerCategorySchema } from "@/lib/schemas/customer-categories";
import { insertCustomerSchema } from "@/lib/schemas/customers";
import { insertManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import { insertPurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import { insertSalesOrderSchema } from "@/lib/schemas/sales-orders";
import { insertSupplierSchema } from "@/lib/schemas/suppliers";

const draftSalesOrderCreateSchema = insertSalesOrderSchema.refine(
  (value) => value.status === "draft",
  {
    message: "erp_create only supports draft sales orders.",
    path: ["status"],
  }
);

const erpCreateInputSchema = z.discriminatedUnion("entityType", [
  z.strictObject({
    entityType: z.literal("customer"),
    values: insertCustomerSchema,
  }),
  z.strictObject({
    entityType: z.literal("customer_category"),
    values: insertCustomerCategorySchema,
  }),
  z.strictObject({
    entityType: z.literal("supplier"),
    values: insertSupplierSchema,
  }),
  z.strictObject({
    entityType: z.literal("sales_order"),
    values: draftSalesOrderCreateSchema,
  }),
  z.strictObject({
    entityType: z.literal("purchase_order"),
    values: insertPurchaseOrderSchema,
  }),
  z.strictObject({
    entityType: z.literal("manufacturing_order"),
    values: insertManufacturingOrderSchema,
  }),
]);

type ErpCreateInput = z.infer<typeof erpCreateInputSchema>;

const DESCRIPTION = `
Use this to create exactly one new ERP record when the create intent is clear. ALWAYS use erp_create for CRUD-shaped records and draft-state orders that can be created without triggering operational side effects. NEVER use this to guess whether a record already exists; use erp_search first if identity is uncertain. This tool is approval-gated and shows a field preview before execution. On success it returns the full created record, not just an id.
`.trim();

export const erpCreateTool = buildTool({
  name: "erp_create",
  description: DESCRIPTION,
  searchHint: "create a new ERP record",
  module: "multiple",
  supportedModules: ["sales", "purchasing", "manufacturing"],
  accessLevel: "operate",
  riskClass: "low_risk_write",
  inputSchema: erpCreateInputSchema,
  outputSchema: erpWriteOutputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  getAccessRequirement(input: ErpCreateInput) {
    return {
      match: "all",
      entries: [
        {
          module: ERP_ENTITY_MODULE[input.entityType],
          level: "operate",
        },
      ],
    };
  },
  validateInput(input: ErpCreateInput, ctx) {
    if (
      input.entityType === "customer_category" &&
      !hasModuleAccess(ctx.actor.assignedRoles, "sales", "admin")
    ) {
      return Promise.resolve({
        result: false as const,
        code: "authorization_denied",
        message: "Creating customer categories requires sales admin access.",
      });
    }

    return Promise.resolve({ result: true as const });
  },
  async canUse(input: ErpCreateInput) {
    return {
      behavior: "ask",
      kind: "permission",
      updatedInput: input,
      message: `Approval required to create ${input.entityType.replaceAll("_", " ")}.`,
      payload: {
        summary: `Create a new ${input.entityType.replaceAll("_", " ")}.`,
        confirmationLabel: "Create record",
        preview: buildCreatePreview(input.values),
      },
    };
  },
  async call(input: ErpCreateInput) {
    return createEntityForAgent(input as never);
  },
  async toToolResult(result) {
    const output = result as Awaited<ReturnType<typeof createEntityForAgent>>;

    return {
      data: {
        action: "created" as const,
        entityType: output.entityType,
        record: output.record,
      },
    };
  },
});
