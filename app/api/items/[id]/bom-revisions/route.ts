import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import {
  assertBomViewAccess,
  assertLockedBomManagementAccess,
  assertModuleReadAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";
import { getBomRevisionHistory, getItem } from "@/app/(dashboard)/inventory/queries";
import {
  createBomRevision,
  createBomRevisionSchema,
} from "@/lib/inventory/bom-revisions";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const item = await getItem(id);

  if (!item) {
    return jsonNotFound("Item not found");
  }

  await assertBomViewAccess(request.headers, item.bomLocked ?? false);

  const revisions = await getBomRevisionHistory(id);
  return NextResponse.json(revisions);
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  // Idempotency required: this writes a new revision row + components and
  // would otherwise duplicate on a network retry.
  void requireIdempotencyKey(request, "createBomRevision");
  const { id } = await (ctx as RouteContext).params;
  const item = await getItem(id);
  if (!item) {
    return jsonNotFound("Item not found");
  }
  if (item.itemType !== "product") {
    return NextResponse.json(
      { error: "BOM revisions are only valid on products." },
      { status: 400 },
    );
  }
  if (item.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  const data = await parseJsonBody(request, createBomRevisionSchema);
  const result = await createBomRevision(id, data);
  return jsonCreated(result);
});
