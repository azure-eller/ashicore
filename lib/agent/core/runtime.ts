import type { z } from "zod";
import type { defineAgentTask } from "./task";
import type { AgentTool, AgentToolContext, AgentToolError, AgentToolResult } from "./tool";

export type AgentToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type AgentRuntimeMessage =
  | {
      role: "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: AgentToolCall[];
      finalOutput?: unknown;
      /**
       * Raw provider output items for lossless replay (real item ids, encrypted
       * reasoning, compaction items). When present, providers replay these
       * verbatim instead of re-synthesizing input items. Scope: a single run's
       * tool loop — these are not serialized through the chat UI stream, so a
       * follow-up request rebuilds history from text (synthesized assistant
       * messages). Cross-request reasoning persistence is a tracked follow-up.
       */
      providerItems?: unknown[];
    }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: string;
      result: AgentToolResult;
    };

export type AgentStopReason = "completed" | "max_tokens" | "error";

export type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AgentModelTurnRequest = {
  runId: string;
  taskId: string;
  purpose: string;
  systemPrompt: string;
  messages: AgentRuntimeMessage[];
  tools: AgentTool[];
  /** Stable conversation identifier used to improve provider prompt-cache hits. */
  cacheKey?: string;
  /** Optional structured-output schema for the model's final answer (mirrors Codex `Prompt.output_schema`). */
  outputSchema?: z.ZodType<unknown>;
  /** Whether the provider may run tool calls from this turn in parallel (mirrors Codex `Prompt.parallel_tool_calls`). */
  parallelToolCalls: boolean;
  abortSignal: AbortSignal;
};

/**
 * Provider-neutral stream of model output for a single turn, mirroring Codex's
 * `ResponseEvent`. The provider boundary is streaming so the runtime can forward
 * deltas live and dispatch tool calls as they assemble.
 */
export type AgentStreamEvent =
  | { type: "created"; responseId: string }
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  /** A tool call item has started assembling (mirrors Codex `OutputItemAdded`); its input is still streaming. */
  | { type: "tool_call_started"; toolCallId: string; toolName: string }
  | { type: "tool_call"; toolCall: AgentToolCall }
  | {
      type: "completed";
      stopReason: AgentStopReason;
      finalOutput?: unknown;
      usage?: AgentTokenUsage;
      /** Raw provider output items from this turn, for lossless history replay. */
      items?: unknown[];
    }
  | { type: "failed"; error: string };

export type AgentModelProvider = {
  streamTurn(request: AgentModelTurnRequest): AsyncIterable<AgentStreamEvent>;
};

export type AgentFinalValidationResult =
  | { ok: true }
  | {
      ok: false;
      errors: string[];
    };

export type AgentRuntimeEvent =
  | {
      type: "run_started";
      runId: string;
      taskId: string;
    }
  | {
      type: "turn_started";
      runId: string;
      taskId: string;
      turn: number;
    }
  | {
      type: "model_text_delta";
      runId: string;
      taskId: string;
      turn: number;
      delta: string;
    }
  | {
      type: "model_reasoning_delta";
      runId: string;
      taskId: string;
      turn: number;
      delta: string;
    }
  | {
      type: "model_message";
      runId: string;
      taskId: string;
      turn: number;
      message: Extract<AgentRuntimeMessage, { role: "assistant" }>;
      usage?: AgentTokenUsage;
    }
  | {
      type: "tool_call_started";
      runId: string;
      taskId: string;
      turn: number;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_started";
      runId: string;
      taskId: string;
      turn: number;
      toolCall: AgentToolCall;
    }
  | {
      type: "tool_completed";
      runId: string;
      taskId: string;
      turn: number;
      toolCall: AgentToolCall;
      result: Extract<AgentToolResult, { status: "completed" }>;
    }
  | {
      type: "tool_failed";
      runId: string;
      taskId: string;
      turn: number;
      toolCall: AgentToolCall;
      error: AgentToolError;
    }
  | {
      type: "validation_failed";
      runId: string;
      taskId: string;
      turn: number;
      errors: string[];
    }
  | {
      type: "run_completed";
      runId: string;
      taskId: string;
      output: unknown;
      messages: AgentRuntimeMessage[];
    }
  | {
      type: "run_failed";
      runId: string;
      taskId: string;
      error: string;
      messages: AgentRuntimeMessage[];
    };

export type AgentRuntimeOptions = {
  task: ReturnType<typeof defineAgentTask>;
  provider: AgentModelProvider;
  input: string;
  /** Prior conversation turns seeded before `input` (e.g. a chat transcript). */
  history?: AgentRuntimeMessage[];
  run: Omit<AgentToolContext, "artifacts"> & {
    artifacts?: AgentToolContext["artifacts"];
  };
  maxTurns?: number;
  /** Stable conversation identifier used to improve provider prompt-cache hits. */
  cacheKey?: string;
  /** Structured-output schema enforced on the model's final answer and surfaced as `run_completed.output`. */
  outputSchema?: z.ZodType<unknown>;
  /** Allow parallel tool dispatch within a turn. Defaults to true. */
  parallelToolCalls?: boolean;
  validateFinalOutput?: (args: {
    output: unknown;
    message: Extract<AgentRuntimeMessage, { role: "assistant" }>;
    messages: AgentRuntimeMessage[];
  }) => AgentFinalValidationResult | Promise<AgentFinalValidationResult>;
};

function resultContent(result: AgentToolResult, tool?: AgentTool) {
  if (result.status === "failed") {
    return JSON.stringify({ error: result.error });
  }

  if (tool?.toModelContent) {
    return JSON.stringify({
      summary: result.summary,
      content: tool.toModelContent(result.data),
    });
  }

  return JSON.stringify({
    summary: result.summary,
    artifact: result.artifact,
    data: result.artifact ? undefined : result.data,
  });
}

function unknownToolResult(toolName: string): AgentToolResult {
  return {
    status: "failed",
    error: {
      code: "unknown_tool",
      message: `Unknown tool '${toolName}'.`,
    },
  };
}

function validationFeedback(errors: string[]) {
  return [
    "Deterministic validation failed. Correct these issues and return the full corrected result.",
    ...errors.map((error) => `- ${error}`),
  ].join("\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Agent provider stream failed.";
}

// Mirrors Codex's retry shape: 200ms * 2^(attempt-1) with +/-10% jitter.
const MAX_TURN_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 200;

function retryDelayMs(attempt: number) {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.9 + Math.random() * 0.2);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function toolsByName(tools: AgentTool[]) {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function runToolCall(args: {
  toolCall: AgentToolCall;
  tools: Map<string, AgentTool>;
  context: AgentToolContext;
}) {
  const tool = args.tools.get(args.toolCall.name);
  if (!tool) {
    return unknownToolResult(args.toolCall.name);
  }

  return tool.run({
    input: args.toolCall.input,
    context: args.context,
  });
}

/**
 * Dispatch a turn's tool calls. Concurrency-safe calls are launched together
 * (Codex's launch-all-safe model); the rest run sequentially. Results preserve
 * the model's original call order regardless of completion order.
 */
async function runToolCalls(args: {
  toolCalls: AgentToolCall[];
  tools: Map<string, AgentTool>;
  context: AgentToolContext;
  parallel: boolean;
}) {
  const results: Array<{ toolCall: AgentToolCall; result: AgentToolResult }> = new Array(
    args.toolCalls.length,
  );
  const concurrent: number[] = [];
  const sequential: number[] = [];

  args.toolCalls.forEach((toolCall, index) => {
    const tool = args.tools.get(toolCall.name);
    const isSafe = args.parallel && tool?.isConcurrencySafe?.(toolCall.input) === true;
    (isSafe ? concurrent : sequential).push(index);
  });

  await Promise.all(
    concurrent.map(async (index) => {
      const toolCall = args.toolCalls[index]!;
      results[index] = {
        toolCall,
        result: await runToolCall({ toolCall, tools: args.tools, context: args.context }),
      };
    }),
  );

  for (const index of sequential) {
    const toolCall = args.toolCalls[index]!;
    results[index] = {
      toolCall,
      result: await runToolCall({ toolCall, tools: args.tools, context: args.context }),
    };
  }

  return results;
}

export async function* runAgentTask(
  options: AgentRuntimeOptions
): AsyncGenerator<AgentRuntimeEvent, void, void> {
  const maxTurns = options.maxTurns ?? 8;
  const parallelToolCalls = options.parallelToolCalls ?? true;
  const context = await options.task.resolveContext(options.run);
  const messages: AgentRuntimeMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: options.input },
  ];
  const toolRegistry = toolsByName(context.tools);

  // Mirror Codex's `ResponseStream` consumer-dropped cancellation: a linked
  // controller aborts the in-flight provider stream when the run ends or the
  // consumer stops iterating, and relays an external abort through to it.
  const streamAbort = new AbortController();
  const externalSignal = context.abortSignal;
  const relayAbort = () => streamAbort.abort(externalSignal.reason);
  if (externalSignal.aborted) {
    streamAbort.abort(externalSignal.reason);
  } else {
    externalSignal.addEventListener("abort", relayAbort, { once: true });
  }

  try {
    yield {
      type: "run_started",
      runId: context.runId,
      taskId: context.taskId,
    };

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      yield {
        type: "turn_started",
        runId: context.runId,
        taskId: context.taskId,
        turn,
      };

      let content = "";
      const toolCalls: AgentToolCall[] = [];
      let stopReason: AgentStopReason = "completed";
      let finalOutput: unknown;
      let usage: AgentTokenUsage | undefined;
      let providerItems: unknown[] | undefined;
      let streamError: string | null = null;

      for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt += 1) {
        // Only pristine failures retry: once any delta or tool call reached the
        // consumer, retrying would duplicate visible output. Reset every
        // accumulator so a retried attempt never inherits the failed one's
        // partial content, tool calls, or items.
        let forwarded = false;
        streamError = null;
        content = "";
        toolCalls.length = 0;
        stopReason = "completed";
        finalOutput = undefined;
        usage = undefined;
        providerItems = undefined;

        try {
          for await (const event of options.provider.streamTurn({
            runId: context.runId,
            taskId: context.taskId,
            purpose: context.purpose,
            systemPrompt: context.systemPrompt,
            messages: [...messages],
            tools: context.tools,
            cacheKey: options.cacheKey,
            outputSchema: options.outputSchema,
            parallelToolCalls,
            abortSignal: streamAbort.signal,
          })) {
            switch (event.type) {
              case "text_delta":
                forwarded = true;
                content += event.delta;
                yield {
                  type: "model_text_delta",
                  runId: context.runId,
                  taskId: context.taskId,
                  turn,
                  delta: event.delta,
                };
                break;
              case "reasoning_delta":
                forwarded = true;
                yield {
                  type: "model_reasoning_delta",
                  runId: context.runId,
                  taskId: context.taskId,
                  turn,
                  delta: event.delta,
                };
                break;
              case "tool_call_started":
                forwarded = true;
                yield {
                  type: "tool_call_started",
                  runId: context.runId,
                  taskId: context.taskId,
                  turn,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                };
                break;
              case "tool_call":
                toolCalls.push(event.toolCall);
                break;
              case "completed":
                stopReason = event.stopReason;
                finalOutput = event.finalOutput;
                usage = event.usage;
                providerItems = event.items;
                break;
              case "failed":
                streamError = event.error;
                break;
              case "created":
                break;
            }
          }
        } catch (error) {
          streamError = streamAbort.signal.aborted ? "Agent run aborted." : errorMessage(error);
        }

        if (!streamError) break;
        const retryable =
          !forwarded &&
          toolCalls.length === 0 &&
          !streamAbort.signal.aborted &&
          attempt < MAX_TURN_ATTEMPTS;
        if (!retryable) break;
        await sleep(retryDelayMs(attempt), streamAbort.signal);
        if (streamAbort.signal.aborted) break;
      }

      const message: Extract<AgentRuntimeMessage, { role: "assistant" }> = {
        role: "assistant",
        content,
        toolCalls,
        finalOutput,
        providerItems,
      };
      const producedTurn =
        content.length > 0 || toolCalls.length > 0 || providerItems != null;

      // A pristine failure (every retry died before any output) produced no
      // turn — skip the empty assistant message so consumers don't see a ghost
      // turn before run_failed. A partial-stream failure kept real content, so
      // preserve that turn first.
      if (streamError && !producedTurn) {
        yield {
          type: "run_failed",
          runId: context.runId,
          taskId: context.taskId,
          error: streamError,
          messages,
        };
        return;
      }

      messages.push(message);
      yield {
        type: "model_message",
        runId: context.runId,
        taskId: context.taskId,
        turn,
        message,
        usage,
      };

      if (streamError) {
        yield {
          type: "run_failed",
          runId: context.runId,
          taskId: context.taskId,
          error: streamError,
          messages,
        };
        return;
      }

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          yield {
            type: "tool_started",
            runId: context.runId,
            taskId: context.taskId,
            turn,
            toolCall,
          };
        }

        const toolResults = await runToolCalls({
          toolCalls,
          tools: toolRegistry,
          context,
          parallel: parallelToolCalls,
        });

        for (const { toolCall, result } of toolResults) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: resultContent(result, toolRegistry.get(toolCall.name)),
            result,
          });

          if (result.status === "failed") {
            yield {
              type: "tool_failed",
              runId: context.runId,
              taskId: context.taskId,
              turn,
              toolCall,
              error: result.error,
            };
            continue;
          }

          yield {
            type: "tool_completed",
            runId: context.runId,
            taskId: context.taskId,
            turn,
            toolCall,
            result,
          };
        }
        continue;
      }

      if (stopReason === "max_tokens" || stopReason === "error") {
        yield {
          type: "run_failed",
          runId: context.runId,
          taskId: context.taskId,
          error: `Model turn stopped with ${stopReason}.`,
          messages,
        };
        return;
      }

      const output = message.finalOutput ?? message.content;
      const validation = options.validateFinalOutput
        ? await options.validateFinalOutput({
            output,
            message,
            messages: [...messages],
          })
        : { ok: true as const };

      if (!validation.ok) {
        yield {
          type: "validation_failed",
          runId: context.runId,
          taskId: context.taskId,
          turn,
          errors: validation.errors,
        };
        messages.push({
          role: "user",
          content: validationFeedback(validation.errors),
        });
        continue;
      }

      yield {
        type: "run_completed",
        runId: context.runId,
        taskId: context.taskId,
        output,
        messages,
      };
      return;
    }

    yield {
      type: "run_failed",
      runId: context.runId,
      taskId: context.taskId,
      error: `Agent run exceeded ${maxTurns} turns.`,
      messages,
    };
  } finally {
    externalSignal.removeEventListener("abort", relayAbort);
    streamAbort.abort();
  }
}
