import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerContactSchema } from "@/lib/schemas/customer-crm";
import { createCustomerContact } from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = customerContactSchema.parse(await request.json());
  const contact = await createCustomerContact(id, data);

  if (!contact) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(contact, { status: 201 });
});
