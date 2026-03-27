import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateCustomerSchema } from "@/lib/schemas/customers";
import {
  deleteCustomer,
  SalesError,
  updateCustomer,
} from "@/app/(dashboard)/sales/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateCustomerSchema.parse(body);
  const customer = await updateCustomer(id, data);

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(customer);
});

export const DELETE = apiHandler(async (_request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", _request.headers);
  const { id } = await (ctx as RouteContext).params;

  try {
    const result = await deleteCustomer(id);

    if (!result.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
