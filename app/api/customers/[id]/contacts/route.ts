import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonCreated } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerContactSchema } from "@/lib/schemas/customer-crm";
import { createCustomerContact } from "@/lib/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, customerContactSchema);
  const contact = await createCustomerContact(id, data);

  if (!contact) {
    return jsonNotFound("Customer not found");
  }

  return jsonCreated(contact);
});
