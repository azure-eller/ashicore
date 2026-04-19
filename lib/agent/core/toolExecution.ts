import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthorizationError, hasModuleAccess } from "@/lib/authz";
import { persistLargeResult } from "@/lib/agent/core/resultArtifacts";
import { ToolExecutionError } from "@/lib/agent/core/Tool";
import type {
  AgentTool,
  AnyAgentTool,
  ToolAccessRequirement,
  ToolErrorOutput,
  ToolPermissionConfirmPayload,
  ToolPermissionDecision,
  ToolQuestionPayload,
  ToolResult,
  ToolUseContext,
  ValidationResult,
} from "@/lib/agent/core/Tool";
import type { AgentMessage } from "@/lib/agent/core/messages";
import { DomainError } from "@/lib/errors/domain-error";

export type ToolAuditHooks = {
  onStart?: (args: {
    id: string;
    toolName: string;
    input: unknown;
  }) => Promise<void>;
  onFinish?: (args: {
    id: string;
    toolName: string;
    status: "completed" | "failed" | "awaiting_user";
    input: unknown;
    outputSummary?: string;
    outputArtifactKey?: string | null;
  }) => Promise<void>;
};

export type ExecutedToolResult = {
  type: "result";
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  inlineOutput: unknown;
  summary: string;
  artifactKey: string | null;
  newMessages?: AgentMessage[];
  isError?: boolean;
};

export type PendingToolRequest =
  | {
      type: "pending";
      toolCallId: string;
      toolName: string;
      input: unknown;
      kind: "question";
      message: string;
      payload: ToolQuestionPayload;
    }
  | {
      type: "pending";
      toolCallId: string;
      toolName: string;
      input: unknown;
      kind: "permission";
      message: string;
      payload: ToolPermissionConfirmPayload;
    };

export type ToolExecutionResult = ExecutedToolResult | PendingToolRequest;

function buildErrorOutput(args: {
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}): ToolErrorOutput {
  return {
    error: {
      code: args.code,
      message: args.message,
      field: args.field,
      suggestion: args.suggestion,
    },
  };
}

function toErrorResult(args: {
  toolCallId: string;
  toolName: string;
  input: unknown;
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}): ExecutedToolResult {
  const output = buildErrorOutput({
    code: args.code,
    message: args.message,
    field: args.field,
    suggestion: args.suggestion,
  });
  return {
    type: "result",
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    input: args.input,
    output,
    inlineOutput: output,
    summary: args.message,
    artifactKey: null,
    isError: true,
  };
}

async function runValidation<TInput>(
  tool: AgentTool<TInput, unknown>,
  input: TInput,
  ctx: ToolUseContext
): Promise<ValidationResult> {
  if (!tool.validateInput) {
    return { result: true };
  }

  return tool.validateInput(input, ctx);
}

async function getPermissionDecision<TInput>(
  tool: AgentTool<TInput, unknown, unknown>,
  input: TInput,
  ctx: ToolUseContext
): Promise<ToolPermissionDecision<TInput>> {
  if (!tool.canUse) {
    return {
      behavior: "allow",
      updatedInput: input,
    };
  }

  return tool.canUse(input, ctx);
}

function resolveAccessRequirement<TInput>(
  tool: AgentTool<TInput, unknown, unknown>,
  input: TInput
): ToolAccessRequirement | null {
  const explicitRequirement = tool.getAccessRequirement?.(input);
  if (explicitRequirement) {
    return explicitRequirement;
  }

  if (!tool.module || !tool.accessLevel) {
    return null;
  }

  if (tool.module === "multiple") {
    if (!tool.supportedModules || tool.supportedModules.length === 0) {
      return null;
    }

    return {
      match: "any",
      entries: tool.supportedModules.map((module) => ({
        module,
        level: tool.accessLevel!,
      })),
    };
  }

  return {
    match: "all",
    entries: [
      {
        module: tool.module,
        level: tool.accessLevel,
      },
    ],
  };
}

function hasRequiredModuleAccess(
  assignedRoles: string[],
  requirement: ToolAccessRequirement
) {
  const predicate = (entry: ToolAccessRequirement["entries"][number]) =>
    hasModuleAccess(assignedRoles, entry.module, entry.level);

  return requirement.match === "all"
    ? requirement.entries.every(predicate)
    : requirement.entries.some(predicate);
}

function normalizeThrownToolError(error: unknown) {
  if (error instanceof ToolExecutionError) {
    return {
      code: error.code,
      message: error.message,
      field: error.options?.field,
      suggestion: error.options?.suggestion,
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      code: "authorization_denied",
      message: error.message,
    };
  }

  if (error instanceof DomainError) {
    const firstField = error.errors ? Object.keys(error.errors)[0] : undefined;
    const firstFieldMessage =
      firstField && error.errors ? error.errors[firstField]?.[0] : undefined;

    if (error.status === 404) {
      return {
        code: "not_found",
        message: error.message,
      };
    }

    if (error.message.toLowerCase().includes("already exists")) {
      return {
        code: "duplicate_value",
        message: error.message,
        field: firstField,
      };
    }

    return {
      code: error.status === 409 ? "invalid_state_transition" : "validation_error",
      message: firstFieldMessage ?? error.message,
      field: firstField,
    };
  }

  if (error instanceof Error) {
    return {
      code: "tool_execution_failed",
      message: error.message,
    };
  }

  return {
    code: "tool_execution_failed",
    message: "Tool execution failed.",
  };
}

export async function executeToolUse(args: {
  tool: AnyAgentTool;
  input: unknown;
  ctx: ToolUseContext;
  audit?: ToolAuditHooks;
  toolCallId?: string;
  permissionOverride?: {
    updatedInput: unknown;
  };
}): Promise<ToolExecutionResult> {
  const toolCallId = args.toolCallId ?? randomUUID();
  await args.audit?.onStart?.({
    id: toolCallId,
    toolName: args.tool.name,
    input: args.input,
  });

  const parsed = args.tool.inputSchema.safeParse(args.input);
  if (!parsed.success) {
    const errorResult = toErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: args.input,
      code: "validation_error",
      message: z.prettifyError(parsed.error),
    });
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "failed",
      input: args.input,
      outputSummary: errorResult.summary,
      outputArtifactKey: null,
    });
    return errorResult;
  }

  const validation = await runValidation(args.tool, parsed.data, args.ctx);
  if (!validation.result) {
    const errorResult = toErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: parsed.data,
      code: validation.code ?? "validation_error",
      message: validation.message,
      field: validation.field,
      suggestion: validation.suggestion,
    });
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "failed",
      input: parsed.data,
      outputSummary: errorResult.summary,
      outputArtifactKey: null,
    });
    return errorResult;
  }

  const accessRequirement = resolveAccessRequirement(args.tool, parsed.data);
  if (
    accessRequirement &&
    !hasRequiredModuleAccess(args.ctx.actor.assignedRoles, accessRequirement)
  ) {
    const errorResult = toErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: parsed.data,
      code: "module_access_denied",
      message: "You do not have permission to use this tool.",
    });
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "failed",
      input: parsed.data,
      outputSummary: errorResult.summary,
      outputArtifactKey: null,
    });
    return errorResult;
  }

  const permission = args.permissionOverride
    ? {
        behavior: "allow" as const,
        updatedInput: args.permissionOverride.updatedInput,
      }
    : await getPermissionDecision(args.tool, parsed.data, args.ctx);
  if (permission.behavior === "deny") {
    const errorResult = toErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: parsed.data,
      code: permission.payload?.code ?? "authorization_denied",
      message: permission.message,
      suggestion: permission.payload?.suggestion,
    });
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "failed",
      input: parsed.data,
      outputSummary: errorResult.summary,
      outputArtifactKey: null,
    });
    return errorResult;
  }

  if (permission.behavior === "ask") {
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "awaiting_user",
      input: permission.updatedInput,
      outputSummary: permission.message,
      outputArtifactKey: null,
    });
    if (permission.kind === "question") {
      return {
        type: "pending",
        toolCallId,
        toolName: args.tool.name,
        input: permission.updatedInput,
        kind: "question",
        message: permission.message,
        payload: permission.payload,
      };
    }

    return {
      type: "pending",
      toolCallId,
      toolName: args.tool.name,
      input: permission.updatedInput,
      kind: "permission",
      message: permission.message,
      payload: permission.payload,
    };
  }

  try {
    const result = await args.tool.call(permission.updatedInput, args.ctx);
    const toolOutput: ToolResult<unknown> = args.tool.toToolResult
      ? await args.tool.toToolResult(result, args.ctx)
      : { data: result };

    const parsedOutput = args.tool.outputSchema
      ? args.tool.outputSchema.safeParse(toolOutput.data)
      : { success: true as const, data: toolOutput.data };
    if (!parsedOutput.success) {
      const errorResult = toErrorResult({
        toolCallId,
        toolName: args.tool.name,
        input: permission.updatedInput,
        code: "validation_error",
        message: z.prettifyError(parsedOutput.error),
      });
      await args.audit?.onFinish?.({
        id: toolCallId,
        toolName: args.tool.name,
        status: "failed",
        input: permission.updatedInput,
        outputSummary: errorResult.summary,
        outputArtifactKey: null,
      });
      return errorResult;
    }

    const persisted = await persistLargeResult({
      content: parsedOutput.data,
      maxResultSizeChars: args.tool.maxResultSizeChars ?? 20_000,
      sessionId: args.ctx.sessionId,
      filename: `${args.tool.name}-${toolCallId}.json`,
      fileStore: args.ctx.fileStore,
    });

    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "completed",
      input: permission.updatedInput,
      outputSummary: persisted.summary,
      outputArtifactKey: persisted.artifact?.key ?? null,
    });

    return {
      type: "result",
      toolCallId,
      toolName: args.tool.name,
      input: permission.updatedInput,
      output: parsedOutput.data,
      inlineOutput: persisted.inlineContent,
      summary: persisted.summary,
      artifactKey: persisted.artifact?.key ?? null,
      newMessages: toolOutput.newMessages,
    };
  } catch (error) {
    const normalizedError = normalizeThrownToolError(error);
    const errorResult = toErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: permission.updatedInput,
      code: normalizedError.code,
      message: normalizedError.message,
      field: normalizedError.field,
      suggestion: normalizedError.suggestion,
    });
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "failed",
      input: permission.updatedInput,
      outputSummary: normalizedError.message,
      outputArtifactKey: null,
    });
    return errorResult;
  }
}
