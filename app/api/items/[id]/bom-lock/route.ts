import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { jsonNotFound } from "@/lib/api/responses";
import { setBomLock } from "@/lib/inventory/queries/bom-write";
import { assertLockedBomManagementAccess } from "@/lib/dal/auth";

const bomLockBodySchema = z.object({
  locked: z.boolean().optional(),
}).passthrough().catch({});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertLockedBomManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "setBomLock");
  const { id } = await (ctx as RouteContext).params;
  const body = await parseOptionalJsonBody(request, bomLockBodySchema, {});
  const locked = body.locked !== false;

  const item = await setBomLock(id, locked, { idempotencyKey });

  if (!item) {
    return jsonNotFound("Product not found");
  }

  return NextResponse.json(item);
});
