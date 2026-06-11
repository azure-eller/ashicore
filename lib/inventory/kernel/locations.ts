import { and, eq, isNull } from "drizzle-orm";
import { inventoryLocations } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

const DEFAULT_LOCATION_CODE = "main";
const DEFAULT_LOCATION_NAME = "Main";

export async function getExistingDefaultInventoryLocationInTx(
  tx: Tx,
  organizationId: string
) {
  return tx.query.inventoryLocations.findFirst({
    where: and(
      eq(inventoryLocations.organizationId, organizationId),
      eq(inventoryLocations.isDefault, true),
      isNull(inventoryLocations.deletedAt)
    ),
  });
}

export async function resolveInventoryLocationInTx(
  tx: Tx,
  organizationId: string,
  locationId?: string | null
) {
  if (!locationId) {
    return getDefaultInventoryLocationInTx(tx, organizationId);
  }

  const location = await tx.query.inventoryLocations.findFirst({
    where: and(
      eq(inventoryLocations.id, locationId),
      eq(inventoryLocations.organizationId, organizationId),
      isNull(inventoryLocations.deletedAt)
    ),
  });

  if (!location) {
    throw new Error("Inventory location not found for this organization.");
  }

  return location;
}

export async function getDefaultInventoryLocationInTx(
  tx: Tx,
  organizationId: string
) {
  const findExisting = () =>
    getExistingDefaultInventoryLocationInTx(tx, organizationId);

  const existing = await findExisting();

  if (existing) {
    return existing;
  }

  const [created] = await tx
    .insert(inventoryLocations)
    .values({
      organizationId,
      name: DEFAULT_LOCATION_NAME,
      code: DEFAULT_LOCATION_CODE,
      isDefault: true,
    })
    .onConflictDoNothing()
    .returning({
      id: inventoryLocations.id,
      organizationId: inventoryLocations.organizationId,
      name: inventoryLocations.name,
      code: inventoryLocations.code,
      isDefault: inventoryLocations.isDefault,
      deletedAt: inventoryLocations.deletedAt,
      createdAt: inventoryLocations.createdAt,
      updatedAt: inventoryLocations.updatedAt,
    });

  if (created) {
    return created;
  }

  const concurrent = await findExisting();

  if (!concurrent) {
    throw new Error("Failed to resolve the default inventory location.");
  }

  return concurrent;
}
