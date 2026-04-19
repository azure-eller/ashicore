import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { crossEntitySearchForAgent } from "@/lib/agent/erp/read-models/search";
import { ERP_READ_MODULES, ERP_ENTITY_MODULE, erpEntityTypeSchema, erpSearchOutputSchema } from "@/lib/agent/erp/read-models/types";
import {
  clampLimit,
  getReadableEntityTypesForActor,
  MAX_LIST_LIMIT,
  normalizeOffset,
} from "@/lib/agent/erp/tools/generic-helpers";

const erpSearchInputSchema = z.strictObject({
  query: z.string().trim().min(1),
  entityTypes: z.array(erpEntityTypeSchema).min(1).optional(),
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
});

type ErpSearchInput = z.infer<typeof erpSearchInputSchema>;

const DESCRIPTION = `
Use this for broad discovery when you do not yet know the exact record to inspect. ALWAYS use erp.search for fuzzy lookups like names, order numbers, SKUs, or partial phrases that may refer to more than one ERP entity. NEVER use this when you already know the exact entity type and id. This tool returns compact hits only, not full record state. Use erp.get for the authoritative detail of one exact record. Use erp.list when you already know the entity type and need structured filters instead of broad discovery. Results are paginated with limit and offset. Default limit is 25 and maximum limit is 100.
`.trim();

export const erpSearchTool = buildTool({
  name: "erp.search",
  description: DESCRIPTION,
  searchHint: "search ERP records across entities by fuzzy text",
  module: "multiple",
  supportedModules: [...ERP_READ_MODULES],
  accessLevel: "read",
  riskClass: "read",
  inputSchema: erpSearchInputSchema,
  outputSchema: erpSearchOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  getAccessRequirement(input: ErpSearchInput) {
    const modules = [...new Set((input.entityTypes ?? []).map((entityType) => ERP_ENTITY_MODULE[entityType]))];

    return {
      match: "any",
      entries: (modules.length > 0 ? modules : [...ERP_READ_MODULES]).map((module) => ({
        module,
        level: "read" as const,
      })),
    };
  },
  async validateInput(input: ErpSearchInput, ctx) {
    if (!input.entityTypes) {
      return { result: true };
    }

    const allowedTypes = new Set(getReadableEntityTypesForActor(ctx.actor));
    const disallowed = input.entityTypes.find((entityType) => !allowedTypes.has(entityType));

    if (disallowed) {
      return {
        result: false,
        code: "module_access_denied",
        message: `You do not have access to search '${disallowed}'.`,
      };
    }

    return { result: true };
  },
  async call(input: ErpSearchInput, ctx) {
    const requestedEntityTypes =
      input.entityTypes && input.entityTypes.length > 0
        ? input.entityTypes
        : getReadableEntityTypesForActor(ctx.actor);

    return crossEntitySearchForAgent({
      entityTypes: requestedEntityTypes,
      query: input.query,
      limit: clampLimit(input.limit),
      offset: normalizeOffset(input.offset),
    });
  },
});

