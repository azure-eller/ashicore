import { toJSONSchema, type ZodType } from "zod/v4";

type JsonSchema = Record<string, unknown>;

const schemaCache = new WeakMap<ZodType, JsonSchema>();

export function zodToJsonSchema(schema: ZodType) {
  const cached = schemaCache.get(schema);
  if (cached) {
    return cached;
  }

  // Provider tool schemas only need the accepted input shape. Many app schemas
  // use transforms for normalization, which are valid at runtime but not fully
  // representable in JSON Schema.
  const converted = toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
  schemaCache.set(schema, converted);

  return converted;
}
