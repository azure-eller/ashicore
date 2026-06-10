import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonSuccess } from "@/lib/api/responses";
import { assertModuleAccess } from "@/lib/dal/auth";
import { updateCustomerCategorySchema } from "@/lib/schemas/customer-categories";
import { deleteCustomerCategory, updateCustomerCategory } from "@/lib/sales/queries/customer-categories";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = await parseJsonBody(request, updateCustomerCategorySchema);

  const category = await updateCustomerCategory(id, data);

  if (!category) {
    return NextResponse.json(
      { error: "Customer category not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(category);
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleAccess("sales", "admin", request.headers);
  const { id } = await (ctx as RouteContext).params;

  const result = await deleteCustomerCategory(id);

  if (!result.deleted) {
    return NextResponse.json(
      { error: "Customer category not found" },
      { status: 404 }
    );
  }

  return jsonSuccess();
});
