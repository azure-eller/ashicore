import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { resolveSalesLinePricingSchema } from "@/lib/schemas/pricing-schedules";
import {
  resolveSalesLinePricing,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const data = await parseJsonBody(request, resolveSalesLinePricingSchema);

  try {
    const pricing = await resolveSalesLinePricing(data);
    return NextResponse.json(pricing);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
