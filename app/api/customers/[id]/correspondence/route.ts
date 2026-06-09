import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerCorrespondenceSchema } from "@/lib/schemas/customer-crm";
import { createCustomerCorrespondence } from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, customerCorrespondenceSchema);

  const entry = await createCustomerCorrespondence(id, data, {
    userId: authContext.userId,
    name: authContext.name,
  });

  if (!entry) {
    return jsonNotFound("Customer not found");
  }

  return jsonCreated(entry);
});
