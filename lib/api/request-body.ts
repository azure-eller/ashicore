import { z } from "zod";

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  return schema.parse(await request.json());
}

export async function parseOptionalJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  fallback: unknown = undefined,
): Promise<z.infer<TSchema>> {
  return schema.parse(await request.json().catch(() => fallback));
}
