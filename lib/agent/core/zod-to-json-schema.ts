import { toJSONSchema, type ZodType } from "zod/v4";

type JsonSchema = Record<string, unknown>;

const schemaCache = new WeakMap<ZodType, JsonSchema>();

export function zodToJsonSchema(schema: ZodType) {
  const cached = schemaCache.get(schema);
  if (cached) {
    return cached;
  }

  const converted = toJSONSchema(schema) as JsonSchema;
  schemaCache.set(schema, converted);

  return converted;
}
