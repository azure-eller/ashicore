import { z } from "zod";
import { buildTool, ToolExecutionError } from "@/lib/agent/core/Tool";
import { getEntityForAgent } from "@/lib/agent/erp/read-models/list";
import { ERP_ENTITY_MODULE, ERP_READ_MODULES, erpEntityTypeSchema, erpGetOutputSchema } from "@/lib/agent/erp/read-models/types";

const erpGetInputSchema = z.strictObject({
  entityType: erpEntityTypeSchema,
  id: z.string().uuid(),
});

type ErpGetInput = z.infer<typeof erpGetInputSchema>;

const DESCRIPTION = `
Use this when you already know the exact entity type and id and need the authoritative current state of one ERP record. ALWAYS use erp_get before erp_update so the agent has the current record and updatedAt value. NEVER use this for fuzzy discovery by name, code, or partial text; use erp_search for that. This tool returns one record and has no pagination. If you need structured listing or filtering for a known entity type, use erp_list instead.
`.trim();

export const erpGetTool = buildTool({
  name: "erp_get",
  description: DESCRIPTION,
  searchHint: "get full ERP record by entity type and id",
  module: "multiple",
  supportedModules: [...ERP_READ_MODULES],
  accessLevel: "read",
  riskClass: "read",
  inputSchema: erpGetInputSchema,
  outputSchema: erpGetOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  getAccessRequirement(input: ErpGetInput) {
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
  async call(input: ErpGetInput) {
    const record = await getEntityForAgent(input);
    if (!record) {
      throw new ToolExecutionError(
        `No ${input.entityType} record was found for id '${input.id}'.`,
        "not_found"
      );
    }

    return record;
  },
});
