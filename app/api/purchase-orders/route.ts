import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import {
  createPurchaseOrder,
  deletePurchaseOrders,
  getPurchaseOrders,
  PurchasingError,
} from "@/app/(dashboard)/purchasing/queries";
import { insertPurchaseOrderSchema } from "@/lib/schemas/purchase-orders";

const deletePurchaseOrdersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function GET() {
  const data = await getPurchaseOrders();
  return NextResponse.json(data);
}

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const data = insertPurchaseOrderSchema.parse(body);

  try {
    const order = await createPurchaseOrder(data);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof PurchasingError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request) => {
  const body = await request.json();
  const data = deletePurchaseOrdersSchema.parse(body);
  const result = await deletePurchaseOrders(data.ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
});
