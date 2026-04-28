import { NextResponse } from "next/server";

export function blockXeroTestEndpointInProduction() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.XERO_TEST_ENDPOINTS_ENABLED !== "1"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return null;
}
