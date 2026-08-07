import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { createPortalSession, BillingConfigError } from "@/lib/billing/stripe";
import { assertTeamManagementAccess } from "@/lib/dal/auth";

export const POST = apiHandler(async (request) => {
  const context = await assertTeamManagementAccess(request.headers);

  try {
    const session = await createPortalSession({ orgId: context.orgId });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return jsonError(error.publicMessage, error.status);
    }
    throw error;
  }
});
