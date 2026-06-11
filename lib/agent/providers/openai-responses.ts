import "server-only";

import OpenAI from "openai";
import type { Reasoning } from "openai/resources/shared";
import type { ResponseCreateParams } from "openai/resources/responses/responses";
import { createOpenAIResponsesAgentAdapter } from "./openai-responses-adapter";
import type { OpenAIResponsesClient } from "./openai-responses-adapter";
import { env } from "@/lib/env";

export type OpenAIResponsesAgentProviderOptions = {
  client?: OpenAIResponsesClient;
  model?: string;
  reasoning?: Reasoning;
  contextManagement?: ResponseCreateParams.ContextManagement[];
};

export function createOpenAIResponsesAgentProvider(
  options: OpenAIResponsesAgentProviderOptions = {},
) {
  const client = options.client ?? new OpenAI({ apiKey: env.OPENAI_API_KEY }).responses;
  const model = options.model ?? env.OPENAI_AGENT_MODEL ?? "gpt-5.4-mini";
  // Low effort keeps chat latency interactive; summaries feed the thinking line.
  const reasoning = options.reasoning ?? { effort: "low", summary: "auto" };
  // Server-side compaction as a default primitive: when the rendered context
  // crosses the threshold the API compacts mid-stream, and the resulting
  // compaction item rides providerItems replay into later turns.
  const contextManagement = options.contextManagement ?? [
    { type: "compaction", compact_threshold: 200_000 },
  ];

  return createOpenAIResponsesAgentAdapter({ client, model, reasoning, contextManagement });
}
