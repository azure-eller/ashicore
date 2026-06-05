import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { sendPurchaseOrderEmail } from "@/lib/purchasing/send-purchase-order-email";
import { sendPurchaseOrderEmailSchema } from "@/lib/schemas/purchase-orders";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const context = await assertModuleWriteAccess("purchasing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "sendPurchaseOrderEmail");
  const input = await parseJsonBody(request, sendPurchaseOrderEmailSchema);

  const result = await sendPurchaseOrderEmail({
    orgId: context.orgId,
    orderId: id,
    actorUserId: context.userId,
    idempotencyKey,
    input,
  });

  return NextResponse.json({
    ...result,
    recipientEmail: result.sent[0]?.recipientEmail ?? null,
  });
});
