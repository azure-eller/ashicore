import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { insertCustomerCategorySchema } from "@/lib/schemas/customer-categories";
import {
  createCustomerCategory,
  deleteCustomerCategories,
  getCustomerCategories,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const categories = await getCustomerCategories();
  return NextResponse.json(categories);
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = insertCustomerCategorySchema.parse(body);

  try {
    const category = await createCustomerCategory(data);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);

  try {
    const result = await deleteCustomerCategories(data.ids);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
