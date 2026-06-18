import { and, eq, isNull } from "drizzle-orm";
import { unitDefinitions } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertUnitDefinition } from "@/lib/schemas/units";

const DEFAULT_UNIT_DEFINITIONS: InsertUnitDefinition[] = [
  { name: "Each", size: "1", uom: "ea" },
  { name: "Piece", size: "1", uom: "pcs" },
  { name: "Pound", size: "1", uom: "lb" },
  { name: "Ounce", size: "1", uom: "oz" },
  { name: "Kilogram", size: "1", uom: "kg" },
  { name: "Gram", size: "1", uom: "g" },
  { name: "Gallon", size: "1", uom: "gal" },
  { name: "Liter", size: "1", uom: "l" },
];

export async function initializeDefaultUnitDefinitionsInTx(tx: Tx, orgId: string) {
  const [existingUnit] = await tx
    .select({ id: unitDefinitions.id })
    .from(unitDefinitions)
    .where(and(eq(unitDefinitions.organizationId, orgId), isNull(unitDefinitions.deletedAt)))
    .limit(1);

  if (existingUnit) return;

  await tx.insert(unitDefinitions).values(
    DEFAULT_UNIT_DEFINITIONS.map((unit) => ({
      ...unit,
      organizationId: orgId,
    })),
  );
}
