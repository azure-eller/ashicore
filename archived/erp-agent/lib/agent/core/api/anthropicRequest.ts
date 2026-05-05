import type { ProviderRequest } from "@/lib/agent/core/api/provider";
import {
  assertAnthropicCacheControlLimit,
  buildAnthropicSystemBlocks,
  logPromptPrefixDiagnostics,
} from "@/lib/agent/core/api/cacheControl";
import {
  getCachedToolSchema,
  setCachedToolSchema,
  type RenderedToolSchema,
} from "@/lib/agent/core/api/toolSchemaCache";
import { resolveToolPrompt } from "@/lib/agent/core/Tool";
import { zodToJsonSchema } from "@/lib/agent/core/zod-to-json-schema";

async function mapToolSchema(
  sessionId: string,
  tool: ProviderRequest["tools"][number]
): Promise<RenderedToolSchema> {
  const cached = getCachedToolSchema(sessionId, tool.name);
  if (cached) {
    return cached;
  }

  const rendered = {
    name: tool.name,
    description: await resolveToolPrompt(tool),
    input_schema: zodToJsonSchema(tool.inputSchema),
  };

  setCachedToolSchema(sessionId, tool.name, rendered);
  return rendered;
}

export async function buildAnthropicRequestShape(args: {
  source: string;
  request: ProviderRequest;
}) {
  const system = buildAnthropicSystemBlocks(args.request.systemSections);
  const toolSchemas = await Promise.all(
    args.request.tools.map((tool) => mapToolSchema(args.request.sessionId, tool))
  );

  assertAnthropicCacheControlLimit({
    source: args.source,
    sessionId: args.request.sessionId,
    systemBlocks: system,
    toolSchemas,
  });

  logPromptPrefixDiagnostics({
    source: args.source,
    sessionId: args.request.sessionId,
    systemSections: args.request.systemSections,
    toolSchemas,
  });

  return {
    system,
    toolSchemas,
  };
}
