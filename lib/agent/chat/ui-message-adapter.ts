import "server-only";

import { randomUUID } from "node:crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { z } from "zod";
import {
  runAgentTask,
  type AgentRuntimeEvent,
  type AgentRuntimeMessage,
  type AgentToolMemberContext,
  type AgentToolResult,
  type AgentUserContentPart,
} from "@/lib/agent/core";
import { createOpenAIResponsesAgentProvider } from "@/lib/agent/providers/openai-responses";
import { dashboardChatAgentTask } from "@/lib/agent/chat/task";
import { workbookToStructuredText } from "@/lib/onboarding/import/extraction/workbook-reader";

const uiMessagePartSchema = z.object({ type: z.string() }).passthrough();
const uiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(uiMessagePartSchema),
  })
  .passthrough() as z.ZodType<UIMessage>;

export const dashboardChatRequestSchema = z.object({
  id: z.string().optional(),
  context: z.string().max(240).optional(),
  messages: z.array(uiMessageSchema),
});

function partText(part: UIMessage["parts"][number]) {
  if (part.type !== "text") return "";
  return typeof part.text === "string" ? part.text : "";
}

function messageText(message: UIMessage) {
  return message.parts.map(partText).join("").trim();
}

// Attachments ride only the message they were sent with (the client drops
// data URLs from history to stay under request-size limits), so history
// conversion reads text parts only.
function uiMessageToRuntimeMessage(message: UIMessage): AgentRuntimeMessage | null {
  const content = messageText(message);
  if (!content) return null;

  if (message.role === "user") {
    return { role: "user", content };
  }

  if (message.role === "assistant") {
    return { role: "assistant", content };
  }

  return null;
}

type UIFilePart = { type: "file"; mediaType: string; filename?: string; url: string };

const MAX_ATTACHMENTS_PER_MESSAGE = 5;
// ~3.7MB of binary per attachment as a base64 data URL; Vercel caps request
// bodies at ~4.5MB, so the client enforces a tighter total — this is the
// server-side backstop.
const MAX_ATTACHMENT_DATA_URL_CHARS = 5_000_000;
const MAX_ATTACHMENT_TEXT_CHARS = 80_000;

function isUIFilePart(part: UIMessage["parts"][number]): part is UIFilePart {
  return (
    part.type === "file" &&
    typeof (part as { url?: unknown }).url === "string" &&
    typeof (part as { mediaType?: unknown }).mediaType === "string"
  );
}

function dataUrlBuffer(url: string): Buffer | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma === -1 || !url.slice(0, comma).endsWith(";base64")) return null;
  return Buffer.from(url.slice(comma + 1), "base64");
}

function isSpreadsheetPart(part: UIFilePart) {
  return (
    part.mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    part.mediaType === "application/vnd.ms-excel" ||
    /\.xlsx?$/i.test(part.filename ?? "")
  );
}

function isTextLikePart(part: UIFilePart) {
  return (
    part.mediaType.startsWith("text/") ||
    part.mediaType === "application/json" ||
    /\.(csv|txt|json)$/i.test(part.filename ?? "")
  );
}

function attachmentText(filename: string, body: string) {
  const text =
    body.length > MAX_ATTACHMENT_TEXT_CHARS
      ? `${body.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n[truncated after ${MAX_ATTACHMENT_TEXT_CHARS} characters]`
      : body;
  return { type: "text" as const, text: `Attached file ${filename}:\n${text}` };
}

function filePartToRuntimePart(part: UIFilePart): AgentUserContentPart {
  const filename = part.filename ?? "attachment";
  if (part.url.length > MAX_ATTACHMENT_DATA_URL_CHARS) {
    return {
      type: "text",
      text: `[Attachment ${filename} was too large to process.]`,
    };
  }

  if (part.mediaType.startsWith("image/")) {
    return { type: "image", dataUrl: part.url };
  }

  if (part.mediaType === "application/pdf") {
    return { type: "file", filename, dataUrl: part.url };
  }

  const bytes = dataUrlBuffer(part.url);
  if (!bytes) {
    return { type: "text", text: `[Attachment ${filename} could not be read.]` };
  }

  if (isSpreadsheetPart(part)) {
    try {
      return attachmentText(filename, workbookToStructuredText(bytes));
    } catch {
      return {
        type: "text",
        text: `[Attachment ${filename} could not be parsed as a spreadsheet.]`,
      };
    }
  }

  if (isTextLikePart(part)) {
    return attachmentText(filename, bytes.toString("utf8"));
  }

  return {
    type: "text",
    text: `[Attachment ${filename} (${part.mediaType}) is not a supported type. Supported: images, PDF, Excel, CSV, and text files.]`,
  };
}

export function dashboardChatMessagesToRuntime(messages: UIMessage[]) {
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  if (latestUserIndex === -1) {
    return null;
  }

  const latest = messages[latestUserIndex]!;
  const input = messageText(latest);
  const attachments = latest.parts
    .filter(isUIFilePart)
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
    .map(filePartToRuntimePart);
  if (!input && attachments.length === 0) {
    return null;
  }

  return {
    input,
    attachments,
    history: messages
      .slice(Math.max(0, latestUserIndex - 12), latestUserIndex)
      .map(uiMessageToRuntimeMessage)
      .filter((message): message is AgentRuntimeMessage => message != null),
  };
}

function toolOutput(result: AgentToolResult) {
  if (result.status === "failed") {
    return { error: result.error };
  }

  return {
    summary: result.summary,
    artifact: result.artifact,
    data: result.data,
  };
}

function writeToolEvent(
  writer: UIMessageStreamWriter,
  event: Extract<AgentRuntimeEvent, { type: "tool_started" | "tool_completed" | "tool_failed" }>,
) {
  if (event.type === "tool_started") {
    writer.write({
      type: "tool-input-available",
      toolCallId: event.toolCall.id,
      toolName: event.toolCall.name,
      input: event.toolCall.input,
      dynamic: true,
    });
    return;
  }

  if (event.type === "tool_completed") {
    writer.write({
      type: "tool-output-available",
      toolCallId: event.toolCall.id,
      output: toolOutput(event.result),
      dynamic: true,
    });
    return;
  }

  writer.write({
    type: "tool-output-error",
    toolCallId: event.toolCall.id,
    errorText: event.error.message,
    dynamic: true,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Agent chat failed.";
}

export function createDashboardChatResponse(args: {
  messages: UIMessage[];
  organizationName: string;
  member: AgentToolMemberContext;
  pageContext?: string;
  chatId?: string;
  abortSignal: AbortSignal;
  now?: Date;
}) {
  const prepared = dashboardChatMessagesToRuntime(args.messages);
  if (!prepared) {
    return new Response("A user message is required.", { status: 400 });
  }

  const stream = createUIMessageStream({
    originalMessages: args.messages,
    onError: errorMessage,
    execute: async ({ writer }) => {
      // Text and reasoning parts are framed per turn: opened on first delta,
      // closed at the turn boundary, so parts interleave with tool calls in
      // the order the model produced them.
      let textId: string | null = null;
      let reasoningId: string | null = null;

      const endTextPart = () => {
        if (!textId) return;
        writer.write({ type: "text-end", id: textId });
        textId = null;
      };
      const endReasoningPart = () => {
        if (!reasoningId) return;
        writer.write({ type: "reasoning-end", id: reasoningId });
        reasoningId = null;
      };
      const inputText = [
        `Current organization: ${args.organizationName}`,
        args.pageContext ? `Page context: ${args.pageContext}` : null,
        `User message:\n${prepared.input || "(see attached files)"}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      for await (const event of runAgentTask({
        task: dashboardChatAgentTask,
        provider: createOpenAIResponsesAgentProvider(),
        input:
          prepared.attachments.length > 0
            ? [{ type: "text", text: inputText }, ...prepared.attachments]
            : inputText,
        history: prepared.history,
        cacheKey: args.chatId,
        run: {
          runId: randomUUID(),
          now: (args.now ?? new Date()).toISOString(),
          abortSignal: args.abortSignal,
          artifacts: null,
          member: args.member,
        },
        // Backstop against runaway loops, not a scope limit — tool results enter
        // the transcript as compact projections, so deep tool chains stay cheap.
        maxTurns: 12,
      })) {
        switch (event.type) {
          case "model_text_delta":
            endReasoningPart();
            if (!textId) {
              textId = randomUUID();
              writer.write({ type: "text-start", id: textId });
            }
            writer.write({ type: "text-delta", id: textId, delta: event.delta });
            break;
          case "model_reasoning_delta":
            if (!reasoningId) {
              reasoningId = randomUUID();
              writer.write({ type: "reasoning-start", id: reasoningId });
            }
            writer.write({ type: "reasoning-delta", id: reasoningId, delta: event.delta });
            break;
          case "model_message":
            endReasoningPart();
            endTextPart();
            break;
          case "tool_call_started":
            endReasoningPart();
            writer.write({
              type: "tool-input-start",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              dynamic: true,
            });
            break;
          case "tool_started":
          case "tool_completed":
          case "tool_failed":
            writeToolEvent(writer, event);
            break;
          case "validation_failed":
            writer.write({
              type: "data-validation",
              data: { errors: event.errors },
              transient: true,
            });
            break;
          case "run_failed":
            writer.write({ type: "error", errorText: event.error });
            break;
          default:
            break;
        }
      }

      endReasoningPart();
      endTextPart();
    },
  });

  return createUIMessageStreamResponse({ stream });
}
