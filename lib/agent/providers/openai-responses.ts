import "server-only";

import OpenAI from "openai";
import type { Reasoning } from "openai/resources/shared";
import { createOpenAIResponsesAgentAdapter } from "./openai-responses-adapter";
import type { OpenAIResponsesClient } from "./openai-responses-adapter";

export type OpenAIResponsesAgentProviderOptions = {
  client?: OpenAIResponsesClient;
  model?: string;
  reasoning?: Reasoning;
};

export function createOpenAIResponsesAgentProvider(
  options: OpenAIResponsesAgentProviderOptions = {},
) {
  const client = options.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses;
  const model = options.model ?? process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4-mini";
  // Low effort keeps chat latency interactive; summaries feed the thinking line.
  const reasoning = options.reasoning ?? { effort: "low", summary: "auto" };

  return createOpenAIResponsesAgentAdapter({ client, model, reasoning });
}
