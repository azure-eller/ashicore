import { NextResponse } from "next/server";
import { jsonCreated } from "@/lib/api/responses";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess, assertModuleReadAccess } from "@/lib/dal/auth";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { insertCustomerCategorySchema } from "@/lib/schemas/customer-categories";
import { createCustomerCategory, deleteCustomerCategories, getCustomerCategories } from "@/lib/sales/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const categories = await getCustomerCategories();
  return NextResponse.json(categories);
});

export const POST = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const data = await parseJsonBody(request, insertCustomerCategorySchema);

  const category = await createCustomerCategory(data);
  return jsonCreated(category);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);

  const result = await deleteCustomerCategories(data.ids);
  return NextResponse.json(result);
});
