import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertCustomerSchema } from "@/lib/schemas/customers";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import {
  createCustomer,
  deleteCustomers,
  getCustomers,
  SalesError,
} from "@/app/(dashboard)/sales/queries";


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
  const data = bulkDeleteSchema.parse(body);

  try {
    const result = await deleteCustomers(data.ids);
    if (process.env.BLOB_READ_WRITE_TOKEN && result.blobUrls.length > 0) {
      await Promise.all(
        result.blobUrls.map((blobUrl) => del(blobUrl).catch(() => undefined))
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
