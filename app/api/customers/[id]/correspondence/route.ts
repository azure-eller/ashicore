import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { customerCorrespondenceSchema } from "@/lib/schemas/customer-crm";
import {
  createCustomerCorrespondence,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  const authContext = await assertModuleWriteAccess("sales", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = customerCorrespondenceSchema.parse(await request.json());

  try {
    const entry = await createCustomerCorrespondence(id, data, {
      userId: authContext.userId,
      name: authContext.name,
    });

    if (!entry) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
