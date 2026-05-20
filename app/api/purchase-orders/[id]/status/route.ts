import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  PurchasingError,
  receivePurchaseOrder,
  submitPurchaseOrder,
} from "@/app/(dashboard)/purchasing/queries";
import { PURCHASE_ORDER_STATUSES } from "@/lib/schemas/purchase-orders";

const statusSchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES),
});

function idempotencyKey(request: Request, action: string, id: string) {
  return (
    request.headers.get("Idempotency-Key") ??
    `purchase-order-status:${action}:${id}:${crypto.randomUUID()}`
  );
}

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const { status } = statusSchema.parse(await request.json());
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

  try {
    if (status === "ordered") {
      const result = await submitPurchaseOrder(id, {
        idempotencyKey: idempotencyKey(request, "submit", id),
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
        { idempotencyKey: idempotencyKey(request, "receive", id) },
      );
      if (!result) {
        return NextResponse.json(
          { error: "Purchase order not found" },
          { status: 404 },
        );
      }
      return NextResponse.json(result);
    }

    if (status === "cancelled") {
      const result = await cancelPurchaseOrder(id, {
        idempotencyKey: idempotencyKey(request, "cancel", id),
      });
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
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});
