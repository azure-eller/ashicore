import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectSchema } from "@/lib/schemas/customer-crm";
import { createCustomerProject } from "@/lib/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, customerProjectSchema);
  const project = await createCustomerProject(id, data);

  if (!project) {
    return jsonNotFound("Customer not found");
  }

  return jsonCreated(project);
});
