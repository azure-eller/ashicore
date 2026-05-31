import { jsonNotFound } from "@/lib/api/responses";

export function blockXeroTestEndpointInProduction() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.XERO_TEST_ENDPOINTS_ENABLED !== "1"
  ) {
    return jsonNotFound();
  }

  return null;
}
