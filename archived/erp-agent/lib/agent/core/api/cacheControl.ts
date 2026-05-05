import { createHash } from "node:crypto";
import type { PromptSection } from "@/lib/agent/core/promptSections";

export const ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS = 4;

type AnthropicEphemeralCacheControl = {
  type: "ephemeral";
};

export type AnthropicSystemTextBlock = {
  type: "text";
  text: string;
  cache_control?: AnthropicEphemeralCacheControl;
};

export type AnthropicToolSchemaLike = {
  name: string;
  cache_control?: AnthropicEphemeralCacheControl;
};

export function isCacheablePromptSection(section: PromptSection) {
  return section.tier !== "none";
}

function normalizePromptText(text: string) {
  return text.trim();
}

export function buildAnthropicSystemBlocks(systemSections: PromptSection[]): AnthropicSystemTextBlock[] {
  const blocks: Array<
    AnthropicSystemTextBlock & {
      tier: PromptSection["tier"];
    }
  > = [];

  for (const section of systemSections) {
    const text = normalizePromptText(section.text);
    if (!text) {
      continue;
    }

    const cacheable = isCacheablePromptSection(section);
    const lastBlock = blocks.at(-1);

    if (lastBlock && lastBlock.tier === section.tier) {
      lastBlock.text = `${lastBlock.text}\n\n${text}`;
      continue;
    }

    blocks.push({
      tier: section.tier,
      type: "text",
      text,
      ...(cacheable
        ? {
            cache_control: {
              type: "ephemeral" as const,
            },
          }
        : {}),
    });
  }

  return blocks.map((block) => ({
    type: block.type,
    text: block.text,
    ...(block.cache_control ? { cache_control: block.cache_control } : {}),
  }));
}

export function countAnthropicCacheControlBlocks(args: {
  systemBlocks: AnthropicSystemTextBlock[];
  toolSchemas: AnthropicToolSchemaLike[];
}) {
  const systemCount = args.systemBlocks.filter((block) => block.cache_control != null).length;
  const toolCount = args.toolSchemas.filter((schema) => schema.cache_control != null).length;

  return {
    total: systemCount + toolCount,
    systemCount,
    toolCount,
  };
}

export function assertAnthropicCacheControlLimit(args: {
  source: string;
  sessionId: string;
  systemBlocks: AnthropicSystemTextBlock[];
  toolSchemas: AnthropicToolSchemaLike[];
}) {
  const counts = countAnthropicCacheControlBlocks(args);
  if (counts.total <= ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS) {
    return;
  }

  throw new Error(
    `[agent-cache:${args.source}] Anthropic cache_control limit exceeded for session ${args.sessionId.slice(0, 8)}: ` +
      `${counts.total} markers (${counts.systemCount} system, ${counts.toolCount} tools); ` +
      `max ${ANTHROPIC_MAX_CACHE_CONTROL_BLOCKS}.`
  );
}

type PromptCacheDiagnosticSchema = {
  name: string;
  description: string;
  input_schema: unknown;
};

type PromptCacheDiagnosticState = {
  systemHash: string;
  toolHash: string;
};

const PROMPT_CACHE_DIAGNOSTICS = new Map<string, PromptCacheDiagnosticState>();

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

export function logPromptPrefixDiagnostics(args: {
  source: string;
  sessionId: string;
  systemSections: PromptSection[];
  toolSchemas: PromptCacheDiagnosticSchema[];
}) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const cacheableSections = args.systemSections
    .filter((section) => isCacheablePromptSection(section))
    .map((section) => ({
      id: section.id,
      tier: section.tier,
      text: normalizePromptText(section.text),
    }));
  const systemHash = hashValue(cacheableSections);
  const toolHash = hashValue(
    args.toolSchemas.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }))
  );
  const previous = PROMPT_CACHE_DIAGNOSTICS.get(args.sessionId);

  console.info(
    `[agent-cache:${args.source}] session=${args.sessionId.slice(0, 8)} system=${systemHash} tools=${toolHash}`
  );

  if (previous && previous.systemHash !== systemHash) {
    console.warn(
      `[agent-cache:${args.source}] cacheable system prompt prefix changed for session ${args.sessionId.slice(0, 8)}`
    );
  }

  if (previous && previous.toolHash !== toolHash) {
    console.warn(
      `[agent-cache:${args.source}] cacheable tool schema prefix changed for session ${args.sessionId.slice(0, 8)}`
    );
  }

  PROMPT_CACHE_DIAGNOSTICS.set(args.sessionId, {
    systemHash,
    toolHash,
  });
}

export function logProviderCacheMetrics(source: string, usage?: {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}) {
  if (process.env.NODE_ENV === "production" || !usage) {
    return;
  }

  const created = usage.cacheCreationInputTokens ?? 0;
  const read = usage.cacheReadInputTokens ?? 0;

  console.info(`[agent-cache:${source}] created=${created} read=${read}`);

  if (created === 0 && read === 0) {
    console.warn(
      `[agent-cache:${source}] no cache metrics detected; cached prompt sections may not be marked correctly`
    );
  }
}
