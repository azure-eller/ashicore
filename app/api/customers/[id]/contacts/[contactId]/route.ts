import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerContactSchema } from "@/lib/schemas/customer-crm";
import {
  deleteCustomerContact,
  updateCustomerContact,
} from "@/app/(dashboard)/sales/queries";

type ContactRouteContext = {
  params: Promise<{ id: string; contactId: string }>;
};

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, contactId } = await (ctx as ContactRouteContext).params;
  const data = await parseJsonBody(request, customerContactSchema);
  const contact = await updateCustomerContact(id, contactId, data);

  if (!contact) {
    return jsonNotFound("Contact not found");
  }

  return NextResponse.json(contact);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, contactId } = await (ctx as ContactRouteContext).params;
  const result = await deleteCustomerContact(id, contactId);

  if (!result.deleted) {
    return jsonNotFound("Contact not found");
  }

  return jsonSuccess();
});
