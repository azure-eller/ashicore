import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { getSalesOrder } from "@/app/(dashboard)/sales/queries";

type PrepareForShippingBlocker = {
  lineId: string;
  itemId: string;
  itemName: string;
  neededQty: string;
  availableQty: string;
  shortQty: string;
  reason:
    | "insufficient_stock"
    | "not_allocated"
    | "open_manufacturing_order"
    | "quality_hold"
    | "not_manufacturable"
    | "unknown";
};

export type PrepareForShippingResponse =
  | { ok: true; state: "ready"; message?: string }
  | {
      ok: false;
      state: "blocked";
      blockers: PrepareForShippingBlocker[];
      suggestedAction?: "create_mos" | "purchase" | "allocate_manually";
    };

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);

  const { id } = await (ctx as RouteContext).params;
  const order = await getSalesOrder(id);

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "confirmed" && order.status !== "partially_shipped") {
    return NextResponse.json(
      { error: "Only confirmed or partially shipped orders can be prepared." },
      { status: 400 }
    );
  }

  if (
    order.shippingReadiness.state === "ready" &&
    Number(order.fulfillmentSummary.shortQty) <= 0
  ) {
    return NextResponse.json({
      ok: true,
      state: "ready",
      message: "Order is ready to ship.",
    } satisfies PrepareForShippingResponse);
  }

  const blockers = order.lines
    .filter((line) => Number(line.shortQty) > 0)
    .map((line): PrepareForShippingBlocker => {
      const availableQty = Number(line.availableQty ?? "0");
      const hasOpenProduction = line.allocationSources.some(
        (source) => source.sourceType === "manufacturing_order"
      );

      return {
        lineId: line.id,
        itemId: line.itemId,
        itemName: line.masterName,
        neededQty: line.remainingQuantity,
        availableQty: line.availableQty ?? "0",
        shortQty: line.shortQty,
        reason: hasOpenProduction
          ? "open_manufacturing_order"
          : availableQty > 0
            ? "not_allocated"
            : "insufficient_stock",
      };
    });

  const suggestedAction = order.hasManufacturableLines
    ? "create_mos"
    : blockers.some((blocker) => blocker.reason === "not_allocated")
      ? "allocate_manually"
      : "purchase";

  return NextResponse.json({
    ok: false,
    state: "blocked",
    blockers:
      blockers.length > 0
        ? blockers
        : order.shippingReadiness.blockers.map((blocker) => ({
            lineId: "",
            itemId: "",
            itemName: blocker,
            neededQty: "0",
            availableQty: "0",
            shortQty: "0",
            reason: "unknown" as const,
          })),
    suggestedAction,
  } satisfies PrepareForShippingResponse);
});
