import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { setBomLock } from "@/app/(dashboard)/inventory/queries";
import { assertLockedBomManagementAccess } from "@/lib/dal/auth";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertLockedBomManagementAccess(request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "setBomLock");
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json().catch(() => ({}));
  const locked = body?.locked !== false;

  const item = await setBomLock(id, locked, { idempotencyKey });

  if (!item) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json(item);
});
