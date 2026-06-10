import { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import type { Reasoning } from "openai/resources/shared";
import type {
  ResponseCreateParams,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseStreamEvent,
  Tool,
} from "openai/resources/responses/responses";
import type { ResponseStreamParams } from "openai/lib/responses/ResponseStream";
import type {
  AgentModelProvider,
  AgentModelTurnRequest,
  AgentRuntimeMessage,
  AgentStopReason,
  AgentTokenUsage,
  AgentTool,
  AgentToolCall,
} from "@/lib/agent/core";

export type OpenAIResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
} | null;

export type OpenAIResponsesFinalResponse = {
  status?: string | null;
  error: unknown;
  incomplete_details: unknown;
  usage?: OpenAIResponsesUsage;
  output_parsed?: unknown;
};

export type OpenAIResponsesStream = AsyncIterable<ResponseStreamEvent> & {
  finalResponse(): Promise<OpenAIResponsesFinalResponse>;
};

export type OpenAIResponsesClient = {
  stream(body: ResponseStreamParams, options?: { signal?: AbortSignal }): OpenAIResponsesStream;
};

export type OpenAIResponsesAgentAdapterOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoning?: Reasoning;
  /** Server-side compaction entries (e.g. `[{ type: "compaction", compact_threshold: n }]`). */
  contextManagement?: ResponseCreateParams.ContextManagement[];
};

function parseToolArguments(toolCall: ResponseFunctionToolCall) {
  if ("parsed_arguments" in toolCall && toolCall.parsed_arguments != null) {
    return toolCall.parsed_arguments;
  }

  try {
    return JSON.parse(toolCall.arguments);
  } catch {
    return {};
  }
}

function responseToolCallToAgentToolCall(toolCall: ResponseFunctionToolCall): AgentToolCall {
  return {
    id: toolCall.call_id,
    name: toolCall.name,
    input: parseToolArguments(toolCall),
  };
}

function contentList(content: string) {
  return [{ type: "input_text" as const, text: content }];
}

// Synthesized fallback for assistant turns without raw provider items (e.g.
// history replayed from the client). Must not carry a fabricated item id —
// the Responses API only accepts real `msg_` ids.
function assistantMessageItem(
  message: Extract<AgentRuntimeMessage, { role: "assistant" }>,
) {
  if (!message.content) return null;

  return {
    type: "message" as const,
    role: "assistant" as const,
    content: message.content,
  } satisfies ResponseInputItem;
}

function assistantToolCallItems(message: Extract<AgentRuntimeMessage, { role: "assistant" }>) {
  return (message.toolCalls ?? []).map(
    (toolCall) =>
      ({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.input ?? {}),
      }) satisfies ResponseInputItem,
  );
}

function runtimeMessageToResponseInputItems(
  message: AgentRuntimeMessage,
): ResponseInputItem[] {
  if (message.role === "user") {
    return [
      {
        type: "message",
        role: "user",
        content: contentList(message.content),
      },
    ];
  }

  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      },
    ];
  }

  // Lossless replay: raw output items carry real ids, encrypted reasoning,
  // and compaction items, and already include this turn's function calls.
  if (message.providerItems?.length) {
    return message.providerItems as ResponseInputItem[];
  }

  const messageItem = assistantMessageItem(message);
  const toolCallItems = assistantToolCallItems(message);

  return messageItem ? [messageItem, ...toolCallItems] : toolCallItems;
}

function runtimeMessagesToResponseInput(messages: AgentRuntimeMessage[]) {
  return messages.flatMap((message) => runtimeMessageToResponseInputItems(message));
}

function agentToolToOpenAITool(tool: AgentTool): Tool {
  return zodResponsesFunction({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }) as Tool;
}

function mapUsage(usage: OpenAIResponsesUsage | undefined): AgentTokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
  };
}

function responseErrorMessage(response: unknown): string {
  const error = (response as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === "string" ? error.message : "Model response failed.";
}

function streamErrorMessage(event: unknown): string {
  const message = (event as { message?: unknown }).message;
  return typeof message === "string" ? message : "Model stream error.";
}

function finalStopReason(final: OpenAIResponsesFinalResponse): AgentStopReason {
  if (final.error) return "error";
  if (final.incomplete_details || final.status === "incomplete") return "max_tokens";
  return "completed";
}

export function createOpenAIResponsesAgentAdapter(
  options: OpenAIResponsesAgentAdapterOptions,
): AgentModelProvider {
  return {
    async *streamTurn(request: AgentModelTurnRequest) {
      const body: ResponseStreamParams = {
        model: options.model,
        instructions: request.systemPrompt,
        input: runtimeMessagesToResponseInput(request.messages),
        tools: request.tools.map(agentToolToOpenAITool),
        parallel_tool_calls: request.parallelToolCalls,
        // Stateless replay: nothing is stored server-side, and reasoning comes
        // back encrypted so it can be replayed across the model turns WITHIN one
        // run (think → tool → answer). Across separate chat requests the history
        // is rebuilt from UI text, so encrypted reasoning does not persist
        // between user turns — see the providerItems note in runtime.ts.
        store: false,
        ...(options.reasoning
          ? { reasoning: options.reasoning, include: ["reasoning.encrypted_content" as const] }
          : {}),
        ...(options.contextManagement
          ? { context_management: options.contextManagement }
          : {}),
        ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
        ...(request.outputSchema
          ? { text: { format: zodTextFormat(request.outputSchema, "agent_final_output") } }
          : {}),
      };

      const stream = options.client.stream(body, { signal: request.abortSignal });
      const rawItems: unknown[] = [];
      let failed = false;

      for await (const event of stream) {
        switch (event.type) {
          case "response.created":
            yield { type: "created", responseId: event.response.id };
            break;
          case "response.output_text.delta":
            yield { type: "text_delta", delta: event.delta };
            break;
          case "response.reasoning_summary_text.delta":
            yield { type: "reasoning_delta", delta: event.delta };
            break;
          case "response.output_item.added":
            if (event.item.type === "function_call") {
              yield {
                type: "tool_call_started",
                toolCallId: event.item.call_id,
                toolName: event.item.name,
              };
            }
            break;
          case "response.output_item.done":
            rawItems.push(event.item);
            if (event.item.type === "function_call") {
              yield { type: "tool_call", toolCall: responseToolCallToAgentToolCall(event.item) };
            }
            break;
          case "response.failed":
            failed = true;
            yield { type: "failed", error: responseErrorMessage(event.response) };
            break;
          case "error":
            failed = true;
            yield { type: "failed", error: streamErrorMessage(event) };
            break;
          default:
            break;
        }
      }

      // A failed stream's finalResponse() can reject; the failure was already
      // surfaced above, so don't overwrite it.
      if (failed) return;

      let final: OpenAIResponsesFinalResponse;
      try {
        final = await stream.finalResponse();
      } catch (error) {
        yield {
          type: "failed",
          error: error instanceof Error ? error.message : "Model response failed.",
        };
        return;
      }

      yield {
        type: "completed",
        stopReason: finalStopReason(final),
        finalOutput: final.output_parsed,
        usage: mapUsage(final.usage),
        items: rawItems,
      };
    },
  };
}
