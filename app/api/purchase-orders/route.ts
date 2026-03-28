import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createPurchaseOrder,
  deletePurchaseOrders,
  getPurchaseOrders,
  PurchasingError,
} from "@/app/(dashboard)/purchasing/queries";
import { insertPurchaseOrderSchema } from "@/lib/schemas/purchase-orders";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("purchasing", request.headers);
  const data = await getPurchaseOrders();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
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
  await assertModuleWriteAccess("purchasing", request.headers);
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);
  const result = await deletePurchaseOrders(data.ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
});
