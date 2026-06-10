export type AgentPromptSectionTier = "static" | "task" | "org" | "run";

export type AgentPromptSection = {
  id: string;
  tier: AgentPromptSectionTier;
  text: string;
};

export type AgentPromptSectionDefinition = {
  id: string;
  tier: AgentPromptSectionTier;
  scopeKey?: string;
  resolve: () => string | Promise<string>;
};

const promptSectionCache = new Map<string, string>();

function cacheKey(section: AgentPromptSectionDefinition) {
  if (section.tier === "run") {
    return null;
  }

  if (section.tier === "static" || section.tier === "task") {
    return `${section.tier}:${section.id}`;
  }

  if (!section.scopeKey) {
    throw new Error(`Prompt section '${section.id}' is missing scopeKey.`);
  }

  return `${section.tier}:${section.scopeKey}:${section.id}`;
}

function normalizePromptText(text: string) {
  return text.trim();
}

export async function resolveAgentPromptSection(
  section: AgentPromptSection | AgentPromptSectionDefinition
): Promise<AgentPromptSection> {
  if ("text" in section) {
    return {
      id: section.id,
      tier: section.tier,
      text: normalizePromptText(section.text),
    };
  }

  const key = cacheKey(section);
  const cached = key ? promptSectionCache.get(key) : undefined;
  if (cached != null) {
    return {
      id: section.id,
      tier: section.tier,
      text: cached,
    };
  }

  const text = normalizePromptText(await section.resolve());
  if (key) {
    promptSectionCache.set(key, text);
  }

  return {
    id: section.id,
    tier: section.tier,
    text,
  };
}

export async function resolveAgentPromptSections(
  sections: Array<AgentPromptSection | AgentPromptSectionDefinition>
) {
  return Promise.all(sections.map((section) => resolveAgentPromptSection(section)));
}

export function joinAgentPromptSections(sections: AgentPromptSection[]) {
  return sections
    .map((section) => section.text)
    .filter(Boolean)
    .join("\n\n");
}

export function invalidateAgentPromptSectionCache(args?: {
  tier?: AgentPromptSectionTier;
  scopeKey?: string;
  id?: string;
}) {
  if (!args) {
    promptSectionCache.clear();
    return;
  }

  for (const key of promptSectionCache.keys()) {
    const [tier, scopeOrId, maybeId] = key.split(":");
    if (args.tier && tier !== args.tier) continue;

    if (tier === "static" || tier === "task") {
      if (args.scopeKey) continue;
      if (args.id && scopeOrId !== args.id) continue;
      promptSectionCache.delete(key);
      continue;
    }

    if (args.scopeKey && scopeOrId !== args.scopeKey) continue;
    if (args.id && maybeId !== args.id) continue;
    promptSectionCache.delete(key);
  }
}
