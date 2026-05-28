import { withAuthedOrgContext } from "@/lib/dal/auth";
import { getAllocationWorkspaceInTx } from "./read-model";
import {
  saveAllocationsForDemandInTx,
  saveAllocationsForManufacturingIngredientGroupInTx,
} from "./commands";
import type { AllocationDemandRef, SaveAllocationsForDemandInput } from "./types";

export async function getAllocationWorkspace(params: {
  primaryDemand?: AllocationDemandRef | null;
  primaryDemands?: AllocationDemandRef[] | null;
  itemId?: string | null;
  includeManufacturingDemand?: boolean;
}) {
  return withAuthedOrgContext((tx, organizationId) =>
    getAllocationWorkspaceInTx(tx, { organizationId, ...params })
  );
}

export async function saveAllocationWorkspace(
  input: SaveAllocationsForDemandInput,
  options: { idempotencyKey?: string | null; returnWorkspace?: boolean } = {}
) {
  return withAuthedOrgContext((tx, organizationId, actorUserId) =>
    saveAllocationsForDemandInTx(tx, {
      ...input,
      organizationId,
      actorUserId,
      idempotencyKey: options.idempotencyKey ?? null,
      returnWorkspace: options.returnWorkspace,
    })
  );
}

export async function saveManufacturingIngredientGroupAllocationWorkspace(
  input: Omit<SaveAllocationsForDemandInput, "demandType" | "demandId"> & {
    demandIds: string[];
  },
  options: { idempotencyKey?: string | null; returnWorkspace?: boolean } = {}
) {
  return withAuthedOrgContext(async (tx, organizationId, actorUserId) => {
    const workspace = await saveAllocationsForManufacturingIngredientGroupInTx(tx, {
      ...input,
      organizationId,
      actorUserId,
      idempotencyKey: options.idempotencyKey ?? null,
    });
    return options.returnWorkspace === false ? null : workspace;
  });
}
