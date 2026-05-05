import { toJSONSchema, type ZodType } from "zod/v4";

type JsonSchema = Record<string, unknown>;

const schemaCache = new WeakMap<ZodType, JsonSchema>();

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function mergePropertySchema(left: unknown, right: unknown) {
  if (JSON.stringify(left) === JSON.stringify(right)) {
    return left;
  }

  return {
    anyOf: [left, right],
  };
}

function flattenTopLevelObjectCombinator(schema: JsonSchema) {
  const combinatorEntries = [
    schema.anyOf,
    schema.oneOf,
    schema.allOf,
  ].find((value): value is unknown[] => Array.isArray(value));

  if (!combinatorEntries) {
    return schema;
  }

  const variants = combinatorEntries.filter(isJsonSchema);
  if (variants.length !== combinatorEntries.length) {
    return schema;
  }

  const supportsObjectFlatten = variants.every(
    (variant) =>
      variant.type === "object" ||
      "properties" in variant ||
      "required" in variant ||
      "additionalProperties" in variant
  );

  if (!supportsObjectFlatten) {
    return schema;
  }

  const mergedProperties: Record<string, unknown> = {};
  let mergedRequired: string[] | null = null;
  let allowsAdditionalProperties = false;

  for (const variant of variants) {
    const properties = isJsonSchema(variant.properties) ? variant.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      mergedProperties[key] =
        key in mergedProperties
          ? mergePropertySchema(mergedProperties[key], propertySchema)
          : propertySchema;
    }

    const required = Array.isArray(variant.required)
      ? variant.required.filter((value): value is string => typeof value === "string")
      : [];
    mergedRequired =
      mergedRequired == null
        ? required
        : mergedRequired.filter((key) => required.includes(key));

    if (variant.additionalProperties === true) {
      allowsAdditionalProperties = true;
    }
  }

  const rest = { ...schema };
  delete rest.anyOf;
  delete rest.oneOf;
  delete rest.allOf;

  return {
    ...rest,
    type: "object",
    properties: mergedProperties,
    ...(mergedRequired && mergedRequired.length > 0
      ? {
          required: mergedRequired,
        }
      : {}),
    additionalProperties: allowsAdditionalProperties,
  };
}

function normalizeToolInputSchema(schema: JsonSchema) {
  const flattened = flattenTopLevelObjectCombinator(schema);
  if (typeof flattened.type === "string") {
    return flattened;
  }

  return {
    type: "object",
    ...flattened,
  };
}

export function zodToJsonSchema(schema: ZodType) {
  const cached = schemaCache.get(schema);
  if (cached) {
    return cached;
  }

  // Provider tool schemas only need the accepted input shape. Many app schemas
  // use transforms for normalization, which are valid at runtime but not fully
  // representable in JSON Schema.
  const converted = normalizeToolInputSchema(
    toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
    }) as JsonSchema
  );
  schemaCache.set(schema, converted);

  return converted;
}
