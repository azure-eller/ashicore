import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { deletePrivateBlobsIfConfigured } from "@/lib/blob-storage";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { insertCustomerSchema } from "@/lib/schemas/customers";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { getCustomers } from "@/lib/sales/queries/customers-read";
import { createCustomer, deleteCustomers } from "@/lib/sales/queries/customers-write";


export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await getCustomers();
  return NextResponse.json(data);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const data = await parseJsonBody(request, insertCustomerSchema);
  const customer = await createCustomer(data);
  return jsonCreated(customer);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  const result = await deleteCustomers(data.ids);
  await deletePrivateBlobsIfConfigured(result.blobUrls);

  return NextResponse.json(result);
});
