import "server-only";

import { eq } from "drizzle-orm";
import { assertTeamManagementAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { organization } from "@/lib/db/schema";
import {
  getOrganizationAllocationMode,
  mergeOrganizationAllocationMode,
} from "@/lib/dal/organization-settings";
import { releaseAllActiveAllocationsForOrgInTx } from "@/lib/inventory/allocation/release";
import type { AllocationMode } from "@/lib/schemas/organization";

export async function getOrganizationAllocationModeForRequest(
  requestHeaders: HeadersInit
): Promise<{ allocationMode: AllocationMode }> {
  const actor = await assertTeamManagementAccess(requestHeaders);
  return withAuthedOrgContext(async (tx) => {
    const [org] = await tx
      .select({ metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, actor.orgId));
    return { allocationMode: getOrganizationAllocationMode(org?.metadata) };
  });
}

export async function updateOrganizationAllocationMode(
  requestHeaders: HeadersInit,
  mode: AllocationMode
): Promise<{ allocationMode: AllocationMode }> {
  await assertTeamManagementAccess(requestHeaders);

  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [org] = await tx
      .select({ metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, orgId));

    await tx
      .update(organization)
      .set({ metadata: mergeOrganizationAllocationMode(org?.metadata, mode) })
      .where(eq(organization.id, orgId));

    // Entering demand-queue mode is a one-way release of active manual
    // allocation commitments and their derived sales-line reservations.
    if (mode === "demand_queue") {
      await releaseAllActiveAllocationsForOrgInTx(tx, {
        organizationId: orgId,
        actorUserId: userId,
      });
    }

    return { allocationMode: mode };
  });
}
