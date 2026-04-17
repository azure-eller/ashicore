import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { hasModuleAccess } from "@/lib/authz";
import { upsertCustomerCategoryForAgent } from "@/app/(dashboard)/sales/agent-queries";

const upsertCustomerCategoryInputSchema = z.strictObject({
  id: z.string().uuid().nullable().optional().describe("Existing category id when updating an existing category."),
  name: z.string().trim().min(1).describe("Customer category name."),
  description: z.string().nullable().optional().describe("Optional category description."),
});

type UpsertCustomerCategoryInput = z.infer<typeof upsertCustomerCategoryInputSchema>;

export const upsertCustomerCategoryTool = buildTool({
  name: "UpsertCustomerCategory",
  description: "Create or update a customer category through the ERP DAL.",
  inputSchema: upsertCustomerCategoryInputSchema,
  async canUse(input: UpsertCustomerCategoryInput, ctx) {
    if (!hasModuleAccess(ctx.actor.assignedRoles, "sales", "admin")) {
      return {
        behavior: "deny",
        message: "Creating or updating customer categories requires sales admin access.",
      };
    }

    return {
      behavior: "allow",
      updatedInput: input,
    };
  },
  async call(input: UpsertCustomerCategoryInput) {
    return upsertCustomerCategoryForAgent({
      id: input.id ?? null,
      name: input.name,
      description: input.description ?? null,
    });
  },
});
