import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertCustomerSchema } from "@/lib/schemas/customers";
import {
  createCustomer,
  deleteCustomers,
  getCustomers,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

const deleteCustomersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await getCustomers();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = insertCustomerSchema.parse(body);
  const customer = await createCustomer(data);
  return NextResponse.json(customer, { status: 201 });
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = deleteCustomersSchema.parse(body);

  try {
    const result = await deleteCustomers(data.ids);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
