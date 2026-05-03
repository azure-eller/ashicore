import { z } from "zod";
import { hasModuleAccess } from "@/lib/authz";
import { buildTool, ToolExecutionError } from "@/lib/agent/core/Tool";
import { getEntityForAgent, updateEntityForAgent } from "@/lib/agent/erp/read-models/list";
import { ERP_ENTITY_MODULE, erpWriteOutputSchema } from "@/lib/agent/erp/read-models/types";
import {
  buildDiffPreview,
  validatePriorRead,
} from "@/lib/agent/erp/tools/generic-helpers";
import { updateCustomerCategorySchema } from "@/lib/schemas/customer-categories";
import { updateCustomerSchema } from "@/lib/schemas/customers";
import { updateManufacturingOrderSchema } from "@/lib/schemas/manufacturing-orders";
import { updatePurchaseOrderSchema } from "@/lib/schemas/purchase-orders";
import { insertSalesOrderSchema } from "@/lib/schemas/sales-orders";
import { updateSupplierSchema } from "@/lib/schemas/suppliers";

const draftSalesOrderUpdateSchema = insertSalesOrderSchema.refine(
  (value) => value.status === "draft",
  {
    message: "erp_update only supports draft sales orders.",
    path: ["status"],
  }
);

const erpUpdateInputSchema = z.discriminatedUnion("entityType", [
  z.strictObject({
    entityType: z.literal("customer"),
    id: z.string().uuid(),
    values: updateCustomerSchema,
  }),
  z.strictObject({
    entityType: z.literal("customer_category"),
    id: z.string().uuid(),
    values: updateCustomerCategorySchema,
  }),
  z.strictObject({
    entityType: z.literal("supplier"),
    id: z.string().uuid(),
    values: updateSupplierSchema,
  }),
  z.strictObject({
    entityType: z.literal("sales_order"),
    id: z.string().uuid(),
    values: draftSalesOrderUpdateSchema,
  }),
  z.strictObject({
    entityType: z.literal("purchase_order"),
    id: z.string().uuid(),
    values: updatePurchaseOrderSchema,
  }),
  z.strictObject({
    entityType: z.literal("manufacturing_order"),
    id: z.string().uuid(),
    values: updateManufacturingOrderSchema,
  }),
]);

type ErpUpdateInput = z.infer<typeof erpUpdateInputSchema>;

const DESCRIPTION = `
Use this to update exactly one known ERP record after you have already read that same record with erp_get in the current session. ALWAYS read first, then update. NEVER use this to guess whether a record exists or to overwrite a record you have not inspected. If the record changed after your read, this tool fails with read_stale; re-read with erp_get, review the current state, then retry. This tool is approval-gated and shows a field-level diff before execution. On success it returns the full updated record.
`.trim();

export const erpUpdateTool = buildTool({
  name: "erp_update",
  description: DESCRIPTION,
  searchHint: "update an existing ERP record by entity type and id",
  module: "multiple",
  supportedModules: ["sales", "purchasing", "manufacturing"],
  accessLevel: "operate",
  riskClass: "low_risk_write",
  inputSchema: erpUpdateInputSchema,
  outputSchema: erpWriteOutputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  getAccessRequirement(input: ErpUpdateInput) {
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
  async validateInput(input: ErpUpdateInput, ctx) {
    if (
      input.entityType === "customer_category" &&
      !hasModuleAccess(ctx.actor.assignedRoles, "sales", "admin")
    ) {
      return {
        result: false,
        code: "authorization_denied",
        message: "Updating customer categories requires sales admin access.",
      };
    }

    const priorRead = await validatePriorRead({
      transcript: ctx.transcript,
      entityType: input.entityType,
      id: input.id,
    });

    if (!priorRead.result) {
      return priorRead;
    }

    if (
      (input.entityType === "sales_order" ||
        input.entityType === "purchase_order" ||
        input.entityType === "manufacturing_order") &&
      priorRead.currentRecord.status !== "draft"
    ) {
      return {
        result: false,
        code: "invalid_state_transition",
        message: `erp_update only supports draft ${input.entityType.replaceAll("_", " ")} records.`,
      };
    }

    return { result: true };
  },
  async canUse(input: ErpUpdateInput) {
    const current = await getEntityForAgent({
      entityType: input.entityType,
      id: input.id,
    });
    if (!current) {
      throw new ToolExecutionError(
        `No ${input.entityType} record was found for id '${input.id}'.`,
        "not_found"
      );
    }

    return {
      behavior: "ask",
      kind: "permission",
      updatedInput: input,
      message: `Approval required to update ${input.entityType.replaceAll("_", " ")}.`,
      payload: {
        summary: `Update ${input.entityType.replaceAll("_", " ")} '${current.record.title}'.`,
        confirmationLabel: "Update record",
        preview: buildDiffPreview(current.record, input.values),
      },
    };
  },
  async call(input: ErpUpdateInput) {
    const result = await updateEntityForAgent(input as never);
    if (!result) {
      throw new ToolExecutionError(
        `No ${input.entityType} record was found for id '${input.id}'.`,
        "not_found"
      );
    }

    return result;
  },
  async toToolResult(result) {
    const output = result as NonNullable<Awaited<ReturnType<typeof updateEntityForAgent>>>;

    return {
      data: {
        action: "updated" as const,
        entityType: output.entityType,
        record: output.record,
      },
    };
  },
});
