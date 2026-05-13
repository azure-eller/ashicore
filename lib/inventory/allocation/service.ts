import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getAllocationWorkspaceInTx } from "./read-model";
import { saveAllocationsForDemandInTx } from "./commands";
import type { AllocationDemandRef, SaveAllocationsForDemandInput } from "./types";

export async function getAllocationWorkspace(params: {
  primaryDemand?: AllocationDemandRef | null;
  itemId?: string | null;
}) {
  return withAuthedOrgContext((tx, organizationId) =>
    getAllocationWorkspaceInTx(tx, { organizationId, ...params })
  );
}

export async function saveAllocationWorkspace(input: SaveAllocationsForDemandInput) {
  return withAuthedOrgContext((tx, organizationId, actorUserId) =>
    saveAllocationsForDemandInTx(tx, {
      ...input,
      organizationId,
      actorUserId,
    })
  );
}
