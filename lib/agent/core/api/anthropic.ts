import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { AgentProvider, ProviderRequest, ProviderStreamEvent } from "@/lib/agent/core/api/provider";
import { logProviderCacheMetrics } from "@/lib/agent/core/api/cacheControl";
import { buildAnthropicRequestShape } from "@/lib/agent/core/api/anthropicRequest";
import { withRetry } from "@/lib/agent/core/api/withRetry";
import type {
  AgentAttachmentContent,
  AgentMessage,
  AgentPart,
} from "@/lib/agent/core/messages";

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the Anthropic agent provider.");
  }

  return new Anthropic({ apiKey });
}

function getMessageRole(message: AgentMessage): MessageParam["role"] {
  if (message.role === "assistant") {
    return "assistant";
  }

  return "user";
}

function prependSystemContext(content: ContentBlockParam[]) {
  return [
    {
      type: "text" as const,
      text: "Retained context from earlier turns. Use it as background context, not as a new user request.",
    },
    ...content,
  ];
}

async function mapAttachment(
  content: AgentAttachmentContent,
  fileStore: ProviderRequest["fileStore"]
): Promise<ContentBlockParam[]> {
  if (content.kind === "text" || content.kind === "manifest") {
    return [
      {
        type: "text",
        text: content.text,
      },
    ];
  }

  const buffer = await fileStore.readBuffer(content.storageKey);
  const base64 = buffer.toString("base64");

  if (content.kind === "image") {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: content.mediaType,
          data: base64,
        },
      },
    ];
  }

  return [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: content.mediaType,
        data: base64,
      },
    },
  ];
}

async function mapPart(
  part: AgentPart,
  fileStore: ProviderRequest["fileStore"]
): Promise<ContentBlockParam | ToolResultBlockParam | ContentBlockParam[]> {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
      };
    case "tool_use":
      return {
        type: "tool_use",
        id: part.id,
        name: part.name,
        input: part.input as Record<string, unknown>,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: part.toolUseId,
        is_error: part.isError ?? false,
        content:
          typeof part.content === "string"
            ? part.content
            : JSON.stringify(part.content, null, 2),
      };
    case "attachment":
      return mapAttachment(part.content, fileStore);
  }
}

async function mapMessage(
  message: AgentMessage,
  fileStore: ProviderRequest["fileStore"]
): Promise<MessageParam> {
  const content = (
    await Promise.all(message.parts.map((part) => mapPart(part, fileStore)))
  ).flatMap((part) => (Array.isArray(part) ? part : [part]));

  return {
    role: getMessageRole(message),
    content: message.role === "system" ? prependSystemContext(content) : content,
  };
}

type InProgressToolUse = {
  id: string;
  name: string;
  inputJson: string;
};

export class AnthropicProvider implements AgentProvider {
  async *stream(request: ProviderRequest) {
    const client = getAnthropicClient();
    const { system, toolSchemas } = await buildAnthropicRequestShape({
      source: "anthropic",
      request,
    });
    const messages = await Promise.all(
      [...request.attachmentMessages, ...request.transcript].map((message) =>
        mapMessage(message, request.fileStore)
      )
    );

    const stream = await withRetry({
      signal: request.signal,
      operation: async () =>
        client.messages.create({
          model: request.model,
          max_tokens: 3_000,
          system,
          messages,
          tools: toolSchemas.map((toolSchema) => ({
            ...toolSchema,
            input_schema: toolSchema.input_schema as Anthropic.Tool.InputSchema,
          })),
          stream: true,
        }),
    });

    const toolUses = new Map<number, InProgressToolUse>();
    let finalUsage:
      | {
          inputTokens?: number;
          outputTokens?: number;
          cacheCreationInputTokens?: number;
          cacheReadInputTokens?: number;
        }
      | undefined;
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" = "end_turn";

    for await (const event of stream) {
      switch (event.type) {
        case "message_start": {
          finalUsage = {
            inputTokens: event.message.usage.input_tokens ?? undefined,
            outputTokens: event.message.usage.output_tokens,
            cacheCreationInputTokens:
              event.message.usage.cache_creation_input_tokens ?? undefined,
            cacheReadInputTokens: event.message.usage.cache_read_input_tokens ?? undefined,
          };
          break;
        }
        case "content_block_start": {
          if (event.content_block.type === "tool_use") {
            toolUses.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            yield {
              type: "text_delta",
              text: event.delta.text,
            } satisfies ProviderStreamEvent;
          }

          if (event.delta.type === "input_json_delta") {
            const entry = toolUses.get(event.index);
            if (entry) {
              entry.inputJson += event.delta.partial_json;
            }
          }
          break;
        }
        case "content_block_stop": {
          const entry = toolUses.get(event.index);
          if (entry) {
            yield {
              type: "tool_use",
              id: entry.id,
              name: entry.name,
              input: entry.inputJson.length > 0 ? JSON.parse(entry.inputJson) : {},
            } satisfies ProviderStreamEvent;
            toolUses.delete(event.index);
          }
          break;
        }
        case "message_delta": {
          stopReason = (event.delta.stop_reason ?? stopReason) as typeof stopReason;
          finalUsage = {
            inputTokens: event.usage.input_tokens ?? finalUsage?.inputTokens,
            outputTokens: event.usage.output_tokens,
            cacheCreationInputTokens:
              event.usage.cache_creation_input_tokens ?? finalUsage?.cacheCreationInputTokens,
            cacheReadInputTokens:
              event.usage.cache_read_input_tokens ?? finalUsage?.cacheReadInputTokens,
          };
          break;
        }
        case "message_stop": {
          if (finalUsage) {
            yield {
              type: "usage",
              usage: finalUsage,
            } satisfies ProviderStreamEvent;
          }
          break;
        }
      }
    }

    logProviderCacheMetrics("anthropic", finalUsage);

    return {
      stopReason,
      usage: finalUsage,
    };
  }
}
