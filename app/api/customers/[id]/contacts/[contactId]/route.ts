import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
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
  const data = customerContactSchema.parse(await request.json());
  const contact = await updateCustomerContact(id, contactId, data);

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return NextResponse.json(contact);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id, contactId } = await (ctx as ContactRouteContext).params;
  const result = await deleteCustomerContact(id, contactId);

  if (!result.deleted) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
});
