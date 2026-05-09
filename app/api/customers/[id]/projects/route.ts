import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerProjectSchema } from "@/lib/schemas/customer-crm";
import { createCustomerProject } from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = customerProjectSchema.parse(await request.json());
  const project = await createCustomerProject(id, data);

  if (!project) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(project, { status: 201 });
});
