import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import {
  getUserViewPreferencePayload,
  saveUserViewPreferencePayload,
} from "@/lib/dal/user-view-preferences";

const SALES_ORDERS_ALLOCATOR_VIEW_KEY = "sales.orders.allocator";

const allocatorPreferenceSchema = z.object({
  hiddenProductIds: z.array(z.string().uuid()).default([]),
});

export type SalesOrdersAllocatorPreference = z.infer<
  typeof allocatorPreferenceSchema
>;

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("sales", request.headers);
  const payload = await getUserViewPreferencePayload(
    SALES_ORDERS_ALLOCATOR_VIEW_KEY
  );
  const preference = allocatorPreferenceSchema.parse(payload);
  return NextResponse.json(preference);
});

export const PUT = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("sales", request.headers);
  const preference = allocatorPreferenceSchema.parse(await request.json());
  const payload = await saveUserViewPreferencePayload(
    SALES_ORDERS_ALLOCATOR_VIEW_KEY,
    preference
  );
  return NextResponse.json(allocatorPreferenceSchema.parse(payload));
});
