import { randomUUID } from "node:crypto";
import { appendTextPart, createAgentMessage, type AgentMessage } from "@/lib/agent/core/messages";
import type { AgentProvider } from "@/lib/agent/core/api/provider";
import { runToolCalls, type ToolCallRequest } from "@/lib/agent/core/toolOrchestration";
import type { AnyAgentTool, ToolUseContext } from "@/lib/agent/core/Tool";
import type { PromptSection } from "@/lib/agent/core/promptSections";
import type { ToolAuditHooks, ToolExecutionResult } from "@/lib/agent/core/toolExecution";

export type QueryEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      summary: string;
      output: unknown;
      isError?: boolean;
    };

export type QueryOutcome =
  | {
      status: "completed";
      messages: AgentMessage[];
    }
  | {
      status: "awaiting_user";
      messages: AgentMessage[];
      pendingRequest: Extract<ToolExecutionResult, { type: "pending" }>;
    };

export async function* query(args: {
  provider: AgentProvider;
  model: string;
  systemSections: PromptSection[];
  attachmentMessages: AgentMessage[];
  messages: AgentMessage[];
  tools: AnyAgentTool[];
  ctx: ToolUseContext;
  audit?: ToolAuditHooks;
  maxTurns?: number;
}): AsyncGenerator<QueryEvent, QueryOutcome, void> {
  const maxTurns = args.maxTurns ?? 8;
  const workingMessages = args.ctx.transcript;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const assistantMessage = createAgentMessage({
      id: randomUUID(),
      role: "assistant",
      createdAt: args.ctx.now,
      parts: [],
    });
    const toolCalls: ToolCallRequest[] = [];

    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" = "end_turn";
    const providerResult = args.provider.stream({
      sessionId: args.ctx.sessionId,
      model: args.model,
      systemSections: args.systemSections,
      attachmentMessages: args.attachmentMessages,
      transcript: workingMessages,
      tools: args.tools,
      signal: args.ctx.abortSignal,
      fileStore: args.ctx.fileStore,
    });

    // Manual iteration keeps access to the provider's terminal value.
    while (true) {
      const next = await providerResult.next();
      if (next.done) {
        stopReason = next.value.stopReason;
        break;
      }

      const event = next.value;
      if (event.type === "text_delta") {
        appendTextPart(assistantMessage, event.text);
        yield {
          type: "assistant_delta",
          text: event.text,
        };
        continue;
      }

      if (event.type === "tool_use") {
        assistantMessage.parts.push({
          type: "tool_use",
          id: event.id,
          name: event.name,
          input: event.input,
        });
        toolCalls.push({
          id: event.id,
          name: event.name,
          input: event.input,
        });
      }
    }

    if (assistantMessage.parts.length > 0) {
      workingMessages.push(assistantMessage);
    }

    if (toolCalls.length === 0 || stopReason === "end_turn") {
      return {
        status: "completed",
        messages: workingMessages,
      };
    }

    for (const toolCall of toolCalls) {
      yield {
        type: "tool_start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.input,
      };
    }

    const toolResults = await runToolCalls({
      toolCalls,
      tools: args.tools,
      ctx: args.ctx,
      audit: args.audit,
    });

    for (const result of toolResults) {
      if (result.type === "pending") {
        return {
          status: "awaiting_user",
          messages: workingMessages,
          pendingRequest: result,
        };
      }

      yield {
        type: "tool_result",
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        summary: result.summary,
        output: result.inlineOutput,
        isError: result.isError,
      };

      workingMessages.push({
        id: randomUUID(),
        role: "user",
        createdAt: args.ctx.now,
        parts: [
          {
            type: "tool_result",
            toolUseId: result.toolCallId,
            isError: result.isError,
            content: {
              toolName: result.toolName,
              summary: result.summary,
              output: result.inlineOutput,
            },
          },
        ],
      });

      if (result.newMessages && result.newMessages.length > 0) {
        workingMessages.push(...result.newMessages);
      }
    }
  }

  return {
    status: "completed",
    messages: workingMessages,
  };
}
