import { hasModuleAccess } from "@/lib/authz";
import { ToolExecutionError, type AgentActor, type ToolPermissionPreview } from "@/lib/agent/core/Tool";
import type { AgentMessage } from "@/lib/agent/core/messages";
import { getEntityForAgent } from "@/lib/agent/erp/read-models/list";
import {
  ERP_ENTITY_MODULE,
  ERP_ENTITY_TYPES,
  ERP_WRITE_ENTITY_TYPES,
  type ErpEntityType,
  type ErpRecord,
  type ErpWriteEntityType,
} from "@/lib/agent/erp/read-models/types";

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 100;

export function clampLimit(limit: number | undefined) {
  if (!limit) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIST_LIMIT, limit));
}

export function normalizeOffset(offset: number | undefined) {
  return Math.max(0, offset ?? 0);
}

export function getReadableEntityTypesForActor(actor: AgentActor): ErpEntityType[] {
  return ERP_ENTITY_TYPES.filter((entityType) =>
    hasModuleAccess(actor.assignedRoles, ERP_ENTITY_MODULE[entityType], "read")
  );
}

export function getWritableEntityTypesForActor(actor: AgentActor): ErpWriteEntityType[] {
  return ERP_WRITE_ENTITY_TYPES.filter((entityType) =>
    hasModuleAccess(actor.assignedRoles, ERP_ENTITY_MODULE[entityType], "operate")
  );
}

function getToolResultOutput(part: AgentMessage["parts"][number]) {
  if (part.type !== "tool_result" || part.isError) {
    return null;
  }

  if (typeof part.content !== "object" || part.content == null) {
    return null;
  }

  const content = part.content as Record<string, unknown>;
  if (typeof content.toolName !== "string") {
    return null;
  }

  return content;
}

export function getLastReadMarker(args: {
  transcript: AgentMessage[];
  entityType: ErpEntityType;
  id: string;
}) {
  const acceptedToolNames = new Set(["erp_get", "erp_create", "erp_update"]);

  for (const message of [...args.transcript].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const content = getToolResultOutput(part);
      if (
        !content ||
        typeof content.toolName !== "string" ||
        !acceptedToolNames.has(content.toolName)
      ) {
        continue;
      }

      const output = content.output;
      if (typeof output !== "object" || output == null) {
        continue;
      }

      const recordEnvelope = output as Record<string, unknown>;
      if (recordEnvelope.entityType !== args.entityType) {
        continue;
      }

      const record = recordEnvelope.record;
      if (typeof record !== "object" || record == null) {
        continue;
      }

      const typedRecord = record as Record<string, unknown>;
      if (typedRecord.id !== args.id || typeof typedRecord.updatedAt !== "string") {
        continue;
      }

      return {
        updatedAt: typedRecord.updatedAt,
      };
    }
  }

  return null;
}

export async function validatePriorRead(args: {
  transcript: AgentMessage[];
  entityType: ErpWriteEntityType;
  id: string;
}) {
  const readMarker = getLastReadMarker({
    transcript: args.transcript,
    entityType: args.entityType,
    id: args.id,
  });

  if (!readMarker) {
    return {
      result: false as const,
      code: "needs_prior_read",
      message: "Read the record before updating it.",
      suggestion: `Use erp_get with entityType '${args.entityType}' and this id, review the current state, then retry erp_update.`,
    };
  }

  const current = await getEntityForAgent({
    entityType: args.entityType,
    id: args.id,
  });

  if (!current) {
    return {
      result: false as const,
      code: "not_found",
      message: "The record no longer exists.",
    };
  }

  if (current.record.updatedAt !== readMarker.updatedAt) {
    return {
      result: false as const,
      code: "read_stale",
      message: "Record state has changed since you read it.",
      suggestion: `Re-read with erp_get for entityType '${args.entityType}', review the current state, then retry erp_update.`,
    };
  }

  return {
    result: true as const,
    currentRecord: current.record,
  };
}

export function buildCreatePreview(values: Record<string, unknown>): ToolPermissionPreview {
  return {
    kind: "create",
    fields: Object.entries(values).map(([name, after]) => ({
      name,
      before: null,
      after,
    })),
  };
}

export function buildDiffPreview(record: ErpRecord, values: Record<string, unknown>): ToolPermissionPreview {
  return {
    kind: "diff",
    fields: Object.entries(values).map(([name, after]) => ({
      name,
      before: record.fields[name] ?? null,
      after,
    })),
  };
}

export function ensureRecord<T>(record: T | null, entityType: ErpEntityType, id: string): T {
  if (record) {
    return record;
  }

  throw new ToolExecutionError(`No ${entityType} record was found for id '${id}'.`, "not_found");
}
