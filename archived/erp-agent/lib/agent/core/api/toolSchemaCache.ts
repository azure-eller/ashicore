export type RenderedToolSchema = {
  name: string;
  description: string;
  input_schema: unknown;
};

const TOOL_SCHEMA_CACHE = new Map<string, RenderedToolSchema>();

function getToolSchemaCacheKey(sessionId: string, toolName: string) {
  return `${sessionId}:${toolName}`;
}

export function getCachedToolSchema(sessionId: string, toolName: string) {
  return TOOL_SCHEMA_CACHE.get(getToolSchemaCacheKey(sessionId, toolName)) ?? null;
}

export function setCachedToolSchema(
  sessionId: string,
  toolName: string,
  schema: RenderedToolSchema
) {
  TOOL_SCHEMA_CACHE.set(getToolSchemaCacheKey(sessionId, toolName), schema);
}

export function clearToolSchemaCache(sessionId?: string) {
  if (!sessionId) {
    TOOL_SCHEMA_CACHE.clear();
    return;
  }

  for (const key of TOOL_SCHEMA_CACHE.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      TOOL_SCHEMA_CACHE.delete(key);
    }
  }
}
