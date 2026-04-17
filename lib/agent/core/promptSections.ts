export type PromptSectionTier = "static" | "org" | "session" | "none";

export type PromptSection = {
  id: string;
  text: string;
  tier: PromptSectionTier;
};

export type ResolvedPromptSection = PromptSection;

export type PromptSectionDefinition = {
  id: string;
  tier: PromptSectionTier;
  scopeKey?: string;
  compute: () => string | Promise<string>;
};

const PROMPT_SECTION_CACHE = new Map<string, string>();

function normalizePromptSectionText(text: string) {
  return text.trim();
}

function getPromptSectionCacheKey(section: PromptSectionDefinition) {
  if (section.tier === "none") {
    return null;
  }

  if (section.tier === "static") {
    return `${section.tier}:${section.id}`;
  }

  if (!section.scopeKey) {
    throw new Error(`Prompt section '${section.id}' is missing a scope key for tier '${section.tier}'.`);
  }

  return `${section.tier}:${section.scopeKey}:${section.id}`;
}

export async function resolvePromptSection(
  section: PromptSection | PromptSectionDefinition
): Promise<ResolvedPromptSection> {
  if ("text" in section) {
    return {
      ...section,
      text: normalizePromptSectionText(section.text),
    };
  }

  const cacheKey = getPromptSectionCacheKey(section);
  if (cacheKey) {
    const cached = PROMPT_SECTION_CACHE.get(cacheKey);
    if (cached != null) {
      return {
        id: section.id,
        tier: section.tier,
        text: cached,
      };
    }
  }

  const text = normalizePromptSectionText(await section.compute());

  if (cacheKey) {
    PROMPT_SECTION_CACHE.set(cacheKey, text);
  }

  return {
    id: section.id,
    tier: section.tier,
    text,
  };
}

export async function resolvePromptSections(
  sections: Array<PromptSection | PromptSectionDefinition>
) {
  return Promise.all(sections.map((section) => resolvePromptSection(section)));
}

export function invalidatePromptSectionCache(args?: {
  tier?: PromptSectionTier;
  scopeKey?: string;
  id?: string;
}) {
  if (!args) {
    PROMPT_SECTION_CACHE.clear();
    return;
  }

  for (const key of PROMPT_SECTION_CACHE.keys()) {
    const [tier, scopeOrId, maybeId] = key.split(":");

    if (args.tier && tier !== args.tier) {
      continue;
    }

    if (tier === "static") {
      if (args.scopeKey) {
        continue;
      }

      if (args.id && scopeOrId !== args.id) {
        continue;
      }

      PROMPT_SECTION_CACHE.delete(key);
      continue;
    }

    if (args.scopeKey && scopeOrId !== args.scopeKey) {
      continue;
    }

    if (args.id && maybeId !== args.id) {
      continue;
    }

    PROMPT_SECTION_CACHE.delete(key);
  }
}

export function invalidateOrgPromptSectionCache(orgId: string) {
  invalidatePromptSectionCache({
    tier: "org",
    scopeKey: orgId,
  });
}

export function invalidateSessionPromptSectionCache(sessionId: string) {
  invalidatePromptSectionCache({
    tier: "session",
    scopeKey: sessionId,
  });
}

export function joinPromptSections(sections: PromptSection[]) {
  return sections
    .map((section) => normalizePromptSectionText(section.text))
    .filter(Boolean)
    .join("\n\n");
}
