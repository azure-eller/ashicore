import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { updateCustomerCategorySchema } from "@/lib/schemas/customer-categories";
import {
  deleteCustomerCategory,
  SalesError,
  updateCustomerCategory,
} from "@/app/(dashboard)/sales/queries";

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = updateCustomerCategorySchema.parse(body);

  try {
    const category = await updateCustomerCategory(id, data);

    if (!category) {
      return NextResponse.json(
        { error: "Customer category not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});

export const DELETE = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;

  try {
    const result = await deleteCustomerCategory(id);

    if (!result.deleted) {
      return NextResponse.json(
        { error: "Customer category not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
