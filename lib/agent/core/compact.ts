import { randomUUID } from "node:crypto";
import type { AgentProvider } from "@/lib/agent/core/api/provider";
import { getCompactionPrompt } from "@/lib/agent/core/compactPrompt";
import {
  createAgentMessage,
  type AgentMessage,
} from "@/lib/agent/core/messages";
import type { ToolFileStore } from "@/lib/agent/core/Tool";

const MAX_TRANSCRIPT_MESSAGES = 24;
const MAX_TRANSCRIPT_SIZE_CHARS = 28_000;
const RECENT_MESSAGES_TO_KEEP = 10;

function estimateTranscriptSize(messages: AgentMessage[]) {
  return JSON.stringify(messages).length;
}

function shouldCompact(messages: AgentMessage[]) {
  return (
    messages.length > MAX_TRANSCRIPT_MESSAGES ||
    estimateTranscriptSize(messages) > MAX_TRANSCRIPT_SIZE_CHARS
  );
}

function extractCompactionSummary(text: string) {
  const match = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  return (match?.[1] ?? text).trim();
}

function formatSummaryMessage(summary: string) {
  return [
    "Conversation summary from earlier turns. This is retained system context, not a new user request.",
    summary,
  ].join("\n\n");
}

export async function compactTranscriptIfNeeded(args: {
  provider: AgentProvider;
  model: string;
  sessionId: string;
  messages: AgentMessage[];
  signal: AbortSignal;
  fileStore: ToolFileStore;
  createdAt: string;
}) {
  if (!shouldCompact(args.messages)) {
    return args.messages;
  }

  const prefixCount = Math.max(args.messages.length - RECENT_MESSAGES_TO_KEEP, 0);
  if (prefixCount === 0) {
    return args.messages;
  }

  const prefix = args.messages.slice(0, prefixCount);
  const recent = args.messages.slice(prefixCount);

  let summaryText = "";

  try {
    const stream = args.provider.stream({
      sessionId: args.sessionId,
      model: args.model,
      systemSections: [
        {
          id: "erp-transcript-compaction",
          tier: "none",
          text: getCompactionPrompt(),
        },
      ],
      attachmentMessages: [],
      transcript: prefix,
      tools: [],
      signal: args.signal,
      fileStore: args.fileStore,
    });

    while (true) {
      const next = await stream.next();
      if (next.done) {
        break;
      }

      if (next.value.type === "text_delta") {
        summaryText += next.value.text;
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[agent-compact] compaction skipped after provider error", error);
    }
    return args.messages;
  }

  const summary = extractCompactionSummary(summaryText);
  if (summary.length === 0) {
    return args.messages;
  }

  return [
    createAgentMessage({
      id: randomUUID(),
      role: "system",
      createdAt: args.createdAt,
      parts: [
        {
          type: "text",
          text: formatSummaryMessage(summary),
        },
      ],
    }),
    ...recent,
  ];
}
