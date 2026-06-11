import { jsonNotFound } from "@/lib/api/responses";
import { env } from "@/lib/env";

export function blockXeroTestEndpointInProduction() {
  if (
    process.env.NODE_ENV === "production" &&
    env.XERO_TEST_ENDPOINTS_ENABLED !== "1"
  ) {
    return jsonNotFound();
  }

  return null;
}
