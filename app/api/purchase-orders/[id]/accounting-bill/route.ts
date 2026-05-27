import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { createPurchaseBillSchema } from "@/lib/schemas/purchase-orders";
import { createPurchaseBillAccountingSync } from "@/app/(dashboard)/purchasing/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = createPurchaseBillSchema.parse(await request.json());

  const result = await createPurchaseBillAccountingSync(id, data);
  return NextResponse.json(result.result);
});
