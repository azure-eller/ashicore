import { z } from "zod";

export type AgentToolArtifact = {
  key: string;
  label: string;
  mediaType: string;
  byteSize: number;
};

export type AgentToolArtifactStore = {
  writeText(args: {
    runId: string;
    filename: string;
    mediaType: string;
    content: string;
  }): Promise<AgentToolArtifact>;
  writeJson(args: {
    runId: string;
    filename: string;
    mediaType?: string;
    data: unknown;
  }): Promise<AgentToolArtifact>;
};

export type AgentToolMemberContext = {
  userId: string;
  orgId: string;
  memberId: string;
  assignedRoles: string[];
};

export type AgentToolContext = {
  runId: string;
  now: string;
  abortSignal: AbortSignal;
  artifacts: AgentToolArtifactStore | null;
  member?: AgentToolMemberContext | null;
};

export type AgentToolError = {
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
};

type AgentToolOutputText<TOutput> = {
  bivarianceHack(output: TOutput): string;
}["bivarianceHack"];

export type AgentToolResult<TOutput = unknown> =
  | {
      status: "completed";
      data: TOutput;
      summary: string;
      artifact: AgentToolArtifact | null;
    }
  | {
      status: "failed";
      error: AgentToolError;
    };

export type AgentToolDefinition<TInput, TOutput> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  maxInlineResultChars?: number;
  isConcurrencySafe?: (input: unknown) => boolean;
  execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
  summarize?: AgentToolOutputText<TOutput>;
  /** Compact projection written back to the model transcript; full data still streams to the UI. */
  toModelContent?: AgentToolOutputText<TOutput>;
};

export type AgentTool<TInput = unknown, TOutput = unknown> = Omit<
  AgentToolDefinition<TInput, TOutput>,
  "execute"
> & {
  run(args: { input: unknown; context: AgentToolContext }): Promise<AgentToolResult<TOutput>>;
};

const DEFAULT_MAX_INLINE_RESULT_CHARS = 20_000;

function summarizeOutput(output: unknown) {
  const serialized = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return serialized.replace(/\s+/g, " ").trim().slice(0, 240);
}

function validationError(error: z.ZodError) {
  return {
    code: "validation_error",
    message: z.prettifyError(error),
  } satisfies AgentToolError;
}

async function maybePersistResult(args: {
  toolName: string;
  runId: string;
  output: unknown;
  context: AgentToolContext;
  maxInlineResultChars: number;
}) {
  const serialized =
    typeof args.output === "string" ? args.output : JSON.stringify(args.output, null, 2);

  if (!args.context.artifacts || serialized.length <= args.maxInlineResultChars) {
    return null;
  }

  if (typeof args.output === "string") {
    return args.context.artifacts.writeText({
      runId: args.runId,
      filename: `${args.toolName}.txt`,
      mediaType: "text/plain",
      content: args.output,
    });
  }

  return args.context.artifacts.writeJson({
    runId: args.runId,
    filename: `${args.toolName}.json`,
    data: args.output,
  });
}

function normalizeThrownToolError(error: unknown): AgentToolError {
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

export function buildAgentTool<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentTool<TInput, TOutput> {
  return {
    ...definition,
    async run({ input, context }) {
      const parsedInput = definition.inputSchema.safeParse(input);
      if (!parsedInput.success) {
        return {
          status: "failed",
          error: validationError(parsedInput.error),
        };
      }

      try {
        const output = await definition.execute(parsedInput.data, context);
        const parsedOutput = definition.outputSchema?.safeParse(output);
        if (parsedOutput && !parsedOutput.success) {
          return {
            status: "failed",
            error: validationError(parsedOutput.error),
          };
        }

        const data = (parsedOutput?.data ?? output) as TOutput;
        const artifact = await maybePersistResult({
          toolName: definition.name,
          runId: context.runId,
          output: data,
          context,
          maxInlineResultChars:
            definition.maxInlineResultChars ?? DEFAULT_MAX_INLINE_RESULT_CHARS,
        });

        return {
          status: "completed",
          data,
          summary: definition.summarize?.(data) ?? summarizeOutput(data),
          artifact,
        };
      } catch (error) {
        return {
          status: "failed",
          error: normalizeThrownToolError(error),
        };
      }
    },
  };
}
