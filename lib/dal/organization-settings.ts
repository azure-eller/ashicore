import { eq } from "drizzle-orm";
import { organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { ALLOCATION_MODES, type AllocationMode } from "@/lib/schemas/organization";

// `organization.metadata` is a TEXT column holding a JSON object (Better Auth
// convention). Keep allocation-mode reads centralized; nothing else should
// hand-parse the metadata string.

const DEFAULT_ALLOCATION_MODE: AllocationMode = "manual";

function parseMetadata(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function getOrganizationAllocationMode(
  metadata: string | null | undefined
): AllocationMode {
  const value = parseMetadata(metadata).allocationMode;
  return (ALLOCATION_MODES as readonly string[]).includes(value as string)
    ? (value as AllocationMode)
    : DEFAULT_ALLOCATION_MODE;
}

export async function getOrganizationAllocationModeInTx(
  tx: Tx,
  organizationId: string
): Promise<AllocationMode> {
  const [org] = await tx
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId));
  return getOrganizationAllocationMode(org?.metadata);
}
