import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerActivitySchema } from "@/lib/schemas/customer-crm";
import { createCustomerActivity } from "@/lib/sales/queries/crm";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, customerActivitySchema);

  const activity = await createCustomerActivity(id, data, {
    userId: authContext.userId,
    name: authContext.name,
  });

  if (!activity) {
    return jsonNotFound("Customer not found");
  }

  return jsonCreated(activity);
});
