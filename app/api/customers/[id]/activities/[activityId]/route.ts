import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerActivityPatchSchema } from "@/lib/schemas/customer-crm";
import {
  deleteCustomerActivity,
  patchCustomerActivity,
} from "@/lib/sales/queries";

type ActivityRouteContext = {
  params: Promise<{ id: string; activityId: string }>;
};

export const PATCH = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, activityId } = await (ctx as ActivityRouteContext).params;
  const data = await parseJsonBody(request, customerActivityPatchSchema);
  const activity = await patchCustomerActivity(id, activityId, data);

  if (!activity) {
    return jsonNotFound("Activity not found");
  }

  return NextResponse.json(activity);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, activityId } = await (ctx as ActivityRouteContext).params;
  const deleted = await deleteCustomerActivity(id, activityId);

  if (!deleted) {
    return jsonNotFound("Activity not found");
  }

  return jsonSuccess();
});
