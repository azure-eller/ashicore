import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleReadAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import { saveManufacturingOutputAllocationSchema } from "@/lib/schemas/manufacturing-orders";
import {
  getManufacturingOutputAllocation,
  ManufacturingError,
  saveManufacturingOutputAllocation,
} from "@/app/(dashboard)/manufacturing/queries";

export const GET = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleReadAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const result = await getManufacturingOutputAllocation(id);

  if (!result) {
    return NextResponse.json({ error: "Manufacturing order not found" }, { status: 404 });
  }

  return NextResponse.json(result);
});

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("manufacturing", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const data = saveManufacturingOutputAllocationSchema.parse(await request.json());

  try {
    const result = await saveManufacturingOutputAllocation(id, data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturingError) return error.toResponse();
    throw error;
  }
});
