import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { submitPurchaseOrder } from "@/lib/purchasing/queries/order-submit";
import { getPurchaseOrder } from "@/lib/purchasing/queries/orders-read";
import { receivePurchaseOrder } from "@/lib/purchasing/queries/receiving";
import { PURCHASE_ORDER_STATUSES } from "@/lib/schemas/purchase-orders";

const statusSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES),
});

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "purchaseOrderStatus");
  const { id } = await (ctx as RouteContext).params;
  const { status } = await parseJsonBody(request, statusSchema);
  const order = await getPurchaseOrder(id);

  if (!order) {
    return NextResponse.json(
      { error: "Purchase order not found" },
      { status: 404 },
    );
  }

  if (order.status === status) {
    return NextResponse.json({ id });
  }

  if (status === "ordered") {
    const result = await submitPurchaseOrder(id, {
      idempotencyKey: `${idempotencyKey}:submit`,
      syncAccounting: false,
      sendEmail: false,
    });
    if (!result) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  }

  if (status === "received") {
    const receivableLines = order.lines
      .filter((line) => Number(line.quantityRemaining) > 0)
      .map((line) => ({
        lineId: line.id,
        quantityReceived: line.quantityRemaining,
        disposition: "available" as const,
      }));

    if (receivableLines.length === 0) {
      return NextResponse.json({ id });
    }

    const result = await receivePurchaseOrder(
      id,
      { lines: receivableLines, confirmOverReceipt: false },
      { idempotencyKey: `${idempotencyKey}:receive` },
    );
    if (!result) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: "This status transition is not available from the list." },
    { status: 400 },
  );
});
