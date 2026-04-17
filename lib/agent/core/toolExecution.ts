import { randomUUID } from "node:crypto";
import { z } from "zod";
import { persistLargeResult } from "@/lib/agent/core/resultArtifacts";
import type {
  AgentTool,
  AnyAgentTool,
  ToolPermissionDecision,
  ToolUseContext,
  ValidationResult,
} from "@/lib/agent/core/Tool";

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
  isError?: boolean;
};

export type PendingToolRequest = {
  type: "pending";
  toolCallId: string;
  toolName: string;
  input: unknown;
  kind: "question" | "permission";
  message: string;
  payload: unknown;
};

export type ToolExecutionResult = ExecutedToolResult | PendingToolRequest;

function toValidationErrorResult(args: {
  toolCallId: string;
  toolName: string;
  input: unknown;
  message: string;
}): ExecutedToolResult {
  return {
    type: "result",
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    input: args.input,
    output: { error: args.message, toolName: args.toolName },
    inlineOutput: { error: args.message, toolName: args.toolName },
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
  tool: AgentTool<TInput, unknown>,
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
    const errorResult = toValidationErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: args.input,
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
    const errorResult = toValidationErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: parsed.data,
      message: validation.message,
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
    const errorResult = toValidationErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: parsed.data,
      message: permission.message,
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
    return {
      type: "pending",
      toolCallId,
      toolName: args.tool.name,
      input: permission.updatedInput,
      kind: permission.kind,
      message: permission.message,
      payload: permission.payload,
    };
  }

  try {
    const result = await args.tool.call(permission.updatedInput, args.ctx);
    const toolOutput = args.tool.toToolResult
      ? await args.tool.toToolResult(result, args.ctx)
      : result;
    const persisted = await persistLargeResult({
      content: toolOutput,
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
      output: toolOutput,
      inlineOutput: persisted.inlineContent,
      summary: persisted.summary,
      artifactKey: persisted.artifact?.key ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    const errorResult = toValidationErrorResult({
      toolCallId,
      toolName: args.tool.name,
      input: permission.updatedInput,
      message,
    });
    await args.audit?.onFinish?.({
      id: toolCallId,
      toolName: args.tool.name,
      status: "failed",
      input: permission.updatedInput,
      outputSummary: message,
      outputArtifactKey: null,
    });
    return errorResult;
  }
}
