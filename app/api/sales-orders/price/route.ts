import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { resolveSalesLinePricingSchema } from "@/lib/schemas/pricing-schedules";
import {
  resolveSalesLinePricing,
  SalesError,
} from "@/app/(dashboard)/sales/queries";

export const POST = apiHandler(async (request) => {
  await assertModuleReadAccess("sales", request.headers);
  const body = await request.json();
  const data = resolveSalesLinePricingSchema.parse(body);

  try {
    const pricing = await resolveSalesLinePricing(data);
    return NextResponse.json(pricing);
  } catch (error) {
    if (error instanceof SalesError) return error.toResponse();
    throw error;
  }
});
