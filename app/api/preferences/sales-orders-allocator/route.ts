import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import {
  getUserViewPreferencePayload,
  saveUserViewPreferencePayload,
} from "@/lib/dal/user-view-preferences";
import { salesOrdersAllocatorPreferenceSchema } from "@/lib/view-preferences";

const SALES_ORDERS_ALLOCATOR_VIEW_KEY = "sales.orders.allocator";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("sales", request.headers);
  const payload = await getUserViewPreferencePayload(
    SALES_ORDERS_ALLOCATOR_VIEW_KEY
  );
  const preference = salesOrdersAllocatorPreferenceSchema.parse(payload);
  return NextResponse.json(preference);
});

export const PUT = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("sales", request.headers);
  const preference = salesOrdersAllocatorPreferenceSchema.parse(await request.json());
  const payload = await saveUserViewPreferencePayload(
    SALES_ORDERS_ALLOCATOR_VIEW_KEY,
    preference
  );
  return NextResponse.json(salesOrdersAllocatorPreferenceSchema.parse(payload));
});
