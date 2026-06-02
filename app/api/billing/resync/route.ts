import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { assertTeamManagementAccess } from "@/lib/dal/auth";
import { BillingConfigError, syncOrgBillingFromStripe } from "@/lib/billing/stripe";

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);

  try {
    const billing = await syncOrgBillingFromStripe(context.orgId);
    return NextResponse.json({ billing });
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
});
