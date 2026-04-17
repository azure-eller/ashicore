export type AgentRole = "user" | "assistant" | "system";

export type SupportedAgentImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export type SupportedAgentDocumentMediaType = "application/pdf";

export type AgentMessage = {
  id: string;
  role: AgentRole;
  parts: AgentPart[];
  createdAt: string;
};

export type AgentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; isError?: boolean; content: unknown }
  | { type: "attachment"; attachmentId: string; label: string; content: AgentAttachmentContent };

export type AgentAttachmentContent =
  | { kind: "text"; text: string }
  | { kind: "manifest"; text: string }
  | {
      kind: "image";
      storageKey: string;
      mediaType: SupportedAgentImageMediaType;
    }
  | {
      kind: "document";
      storageKey: string;
      mediaType: SupportedAgentDocumentMediaType;
    };

export function createAgentMessage(args: {
  id: string;
  role: AgentRole;
  createdAt: string;
  parts?: AgentPart[];
}): AgentMessage {
  return {
    id: args.id,
    role: args.role,
    createdAt: args.createdAt,
    parts: args.parts ?? [],
  };
}

export function appendTextPart(message: AgentMessage, text: string) {
  if (text.length === 0) {
    return message;
  }

  const lastPart = message.parts.at(-1);
  if (lastPart?.type === "text") {
    lastPart.text += text;
    return message;
  }

  message.parts.push({ type: "text", text });
  return message;
}

export function hasToolUsePart(message: AgentMessage) {
  return message.parts.some((part) => part.type === "tool_use");
}

export function getMessageText(message: AgentMessage) {
  return message.parts
    .filter((part): part is Extract<AgentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function getVisibleAgentMessages(messages: AgentMessage[]) {
  return messages.filter((message) => message.role !== "system");
}

export function countHiddenAgentMessages(messages: AgentMessage[]) {
  return messages.filter((message) => message.role === "system").length;
}

export function createTextMessage(args: {
  id: string;
  role: AgentRole;
  createdAt: string;
  text: string;
}) {
  return createAgentMessage({
    id: args.id,
    role: args.role,
    createdAt: args.createdAt,
    parts: [{ type: "text", text: args.text }],
  });
}
