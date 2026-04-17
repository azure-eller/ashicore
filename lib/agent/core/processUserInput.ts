import { randomUUID } from "node:crypto";
import {
  createAgentMessage,
  type AgentMessage,
} from "@/lib/agent/core/messages";

export function createUserTurnMessage(args: {
  text: string;
  createdAt: string;
  pendingToolResult?: {
    toolUseId: string;
    content: unknown;
    isError?: boolean;
  };
}) {
  const parts: AgentMessage["parts"] = [];

  if (args.pendingToolResult) {
    parts.push({
      type: "tool_result",
      toolUseId: args.pendingToolResult.toolUseId,
      content: args.pendingToolResult.content,
      isError: args.pendingToolResult.isError,
    });
  }

  if (args.text.trim().length > 0) {
    parts.push({
      type: "text",
      text: args.text.trim(),
    });
  }

  return createAgentMessage({
    id: randomUUID(),
    role: "user",
    createdAt: args.createdAt,
    parts,
  });
}
