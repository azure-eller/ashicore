import type { AnyAgentTool, ToolFileStore } from "@/lib/agent/core/Tool";
import type { AgentMessage } from "@/lib/agent/core/messages";
import type { PromptSection } from "@/lib/agent/core/promptSections";

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; usage: ProviderUsage };

export type ProviderStopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

export type ProviderRunResult = {
  stopReason: ProviderStopReason;
  usage?: ProviderUsage;
};

export type ProviderRequest = {
  sessionId: string;
  model: string;
  systemSections: PromptSection[];
  attachmentMessages: AgentMessage[];
  transcript: AgentMessage[];
  tools: AnyAgentTool[];
  signal: AbortSignal;
  fileStore: ToolFileStore;
};

export interface AgentProvider {
  stream(request: ProviderRequest): AsyncGenerator<ProviderStreamEvent, ProviderRunResult, void>;
}
