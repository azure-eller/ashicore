import { apiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { diffInventoryStateForOrganizations } from "@/lib/inventory/kernel";
import { requestSearchParams } from "@/lib/routing/search-params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertInventoryReconciliationAccess(request: Request) {
  const secret =
    process.env.INVENTORY_RECONCILIATION_SECRET ?? process.env.CRON_SECRET;

  if (!secret) {
    throw new Error(
      "INVENTORY_RECONCILIATION_SECRET or CRON_SECRET must be configured."
    );
  }

  const authorization = request.headers.get("authorization");

  if (authorization !== `Bearer ${secret}`) {
    throw new AuthorizationError("Invalid inventory reconciliation token.", 401);
  }
}

export const GET = apiHandler(async (request: Request) => {
  assertInventoryReconciliationAccess(request);

  const orgId = requestSearchParams(request).get("orgId");
  const results = await diffInventoryStateForOrganizations(
    orgId ? [orgId] : undefined
  );
  const failing = results.filter((result) => !result.ok);

  if (failing.length > 0) {
    throw new Error(
      `Inventory reconciliation drift detected for ${failing.length} org(s): ${JSON.stringify(
        failing.map((result) => ({
          orgId: result.orgId,
          summary: result.summary,
        }))
      )}`
    );
  }

  return jsonOk({
    checkedOrganizations: results.length,
    results: results.map((result) => ({
      orgId: result.orgId,
      summary: result.summary,
    })),
  });
});
