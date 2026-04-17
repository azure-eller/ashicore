import type { AnyAgentTool, ToolUseContext } from "@/lib/agent/core/Tool";
import { executeToolUse, type ToolAuditHooks, type ToolExecutionResult } from "@/lib/agent/core/toolExecution";

export type ToolCallRequest = {
  id: string;
  name: string;
  input: unknown;
};

type ToolRegistry = Map<string, AnyAgentTool>;

function partitionToolCalls(toolCalls: ToolCallRequest[], toolsByName: ToolRegistry) {
  return toolCalls.reduce<Array<{ concurrencySafe: boolean; calls: ToolCallRequest[] }>>(
    (batches, toolCall) => {
      const tool = toolsByName.get(toolCall.name);
      const concurrencySafe = tool?.isConcurrencySafe
        ? tool.isConcurrencySafe(toolCall.input)
        : false;
      const currentBatch = batches.at(-1);

      if (currentBatch && currentBatch.concurrencySafe === concurrencySafe) {
        currentBatch.calls.push(toolCall);
        return batches;
      }

      batches.push({
        concurrencySafe,
        calls: [toolCall],
      });
      return batches;
    },
    []
  );
}

export async function runToolCalls(args: {
  toolCalls: ToolCallRequest[];
  tools: AnyAgentTool[];
  ctx: ToolUseContext;
  audit?: ToolAuditHooks;
}) {
  const toolsByName = new Map(args.tools.map((tool) => [tool.name, tool]));
  const results: ToolExecutionResult[] = [];

  for (const batch of partitionToolCalls(args.toolCalls, toolsByName)) {
    if (batch.concurrencySafe) {
      const batchResults = await Promise.all(
        batch.calls.map(async (toolCall) => {
          const tool = toolsByName.get(toolCall.name);
          if (!tool) {
            return {
              type: "result",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.input,
              output: { error: `Unknown tool '${toolCall.name}'.`, toolName: toolCall.name },
              inlineOutput: { error: `Unknown tool '${toolCall.name}'.`, toolName: toolCall.name },
              summary: `Unknown tool '${toolCall.name}'.`,
              artifactKey: null,
              isError: true,
            } satisfies ToolExecutionResult;
          }

          return executeToolUse({
            tool,
            input: toolCall.input,
            ctx: args.ctx,
            audit: args.audit,
            toolCallId: toolCall.id,
          });
        })
      );
      results.push(...batchResults);
      if (batchResults.some((result) => result.type === "pending")) {
        break;
      }
      continue;
    }

    for (const toolCall of batch.calls) {
      const tool = toolsByName.get(toolCall.name);
      if (!tool) {
        results.push({
          type: "result",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.input,
          output: { error: `Unknown tool '${toolCall.name}'.`, toolName: toolCall.name },
          inlineOutput: { error: `Unknown tool '${toolCall.name}'.`, toolName: toolCall.name },
          summary: `Unknown tool '${toolCall.name}'.`,
          artifactKey: null,
          isError: true,
        });
        continue;
      }

      const result = await executeToolUse({
        tool,
        input: toolCall.input,
        ctx: args.ctx,
        audit: args.audit,
        toolCallId: toolCall.id,
      });
      results.push(result);

      if (result.type === "pending") {
        return results;
      }
    }
  }

  return results;
}
