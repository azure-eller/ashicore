import { config } from "dotenv";
config({ path: ".env.local" });
import { withOrgContext } from "@/lib/db/with-org-context";

async function main() {
  const { db } = await import("@/lib/db");
  const { organization, unitDefinitions, items, lots, stockMovements } = await import("@/lib/db/schema");
  // 1. Get the first org
  const orgs = await db.select().from(organization).limit(1);
  if (orgs.length === 0) {
    console.error("No organizations found. Sign up and create an org first.");
    process.exit(1);
  }
  const orgId = orgs[0].id;
  console.log(`Seeding for org: ${orgs[0].name} (${orgId})`);

  // 2. Insert unit definitions
  const insertedUnits = await db
    .insert(unitDefinitions)
    .values([
      { organizationId: orgId, name: "bale", size: "225", uom: "l" },
      { organizationId: orgId, name: "bag", size: "1", uom: "ft3" },
      { organizationId: orgId, name: "bag", size: "2", uom: "ft3" },
      { organizationId: orgId, name: "yard", size: "1", uom: "yd3" },
      { organizationId: orgId, name: "lb", size: "1", uom: "lb" },
    ])
    .onConflictDoNothing()
    .returning();

  const [bale, bag1, bag2, yard, lb] = insertedUnits;
  console.log(`Inserted ${insertedUnits.length} unit definitions`);

  // 3. Insert items
  const insertedItems = await db
    .insert(items)
    .values([
      // Materials
      {
        organizationId: orgId,
        name: "Sphagnum Peat Moss",
        sku: "MAT-SPM-001",
        category: "Peat",
        itemType: "material",
        unitDefinitionId: bale.id,
        safetyStock: "10",
      },
      {
        organizationId: orgId,
        name: "Perlite",
        sku: "MAT-PRL-001",
        category: "Amendments",
        itemType: "material",
        unitDefinitionId: bag1.id,
        safetyStock: "24",
      },
      {
        organizationId: orgId,
        name: "Compost",
        sku: "MAT-CMP-001",
        category: "Organics",
        itemType: "material",
        unitDefinitionId: yard.id,
        safetyStock: "8",
      },
      {
        organizationId: orgId,
        name: "Pumice",
        sku: "MAT-PMC-001",
        category: "Amendments",
        itemType: "material",
        unitDefinitionId: bag1.id,
        safetyStock: "12",
      },
      {
        organizationId: orgId,
        name: "Worm Castings",
        sku: "MAT-WC-001",
        category: "Organics",
        itemType: "material",
        unitDefinitionId: lb.id,
        safetyStock: "100",
      },
      // Products
      {
        organizationId: orgId,
        name: "Premium Garden Mix",
        sku: "PRD-PGM-001",
        category: "Potting Mix",
        itemType: "product",
        unitDefinitionId: bag2.id,
        safetyStock: "40",
        defaultSellingPrice: "24.99",
      },
      {
        organizationId: orgId,
        name: "Raised Bed Blend",
        sku: "PRD-RBB-001",
        category: "Potting Mix",
        itemType: "product",
        unitDefinitionId: yard.id,
        safetyStock: "5",
        defaultSellingPrice: "89.00",
      },
      {
        organizationId: orgId,
        name: "Seed Starting Mix",
        sku: "PRD-SSM-001",
        category: "Specialty",
        itemType: "product",
        unitDefinitionId: bag1.id,
        safetyStock: "20",
        defaultSellingPrice: "12.49",
      },
    ])
    .onConflictDoUpdate({
      target: [items.organizationId, items.sku],
      set: { deletedAt: null },
    })
    .returning({ id: items.id, name: items.name });

  console.log(`Inserted ${insertedItems.length} items:`);
  for (const item of insertedItems) {
    console.log(`  - ${item.name}`);
  }

  // 4. Create default lots for each item
  const stockAmounts: Record<string, string> = {
    "Sphagnum Peat Moss": "48",
    "Perlite": "120",
    "Compost": "30",
    "Pumice": "60",
    "Worm Castings": "500",
    "Premium Garden Mix": "200",
    "Raised Bed Blend": "15",
    "Seed Starting Mix": "85",
  };

  let lotSeq = 1;
  for (const item of insertedItems) {
    const qty = stockAmounts[item.name];
    if (qty) {
      await db.insert(lots).values({
        organizationId: orgId,
        itemId: item.id,
        lotNumber: `LOT-${String(lotSeq++).padStart(6, "0")}`,
        quantity: qty,
      }).onConflictDoNothing();
    }
  }
  console.log(`Created ${lotSeq - 1} default lots`);

  // 5. Create initial stock movements for seeded lots
  const seededLots = await withOrgContext(orgId, async (tx) => {
    return tx
      .select({ id: lots.id, itemId: lots.itemId, quantity: lots.quantity, costPerUnit: lots.costPerUnit })
      .from(lots);
  });

  for (const lot of seededLots) {
    if (parseFloat(lot.quantity) > 0) {
      await withOrgContext(orgId, async (tx) => {
        await tx.insert(stockMovements).values({
          organizationId: orgId,
          itemId: lot.itemId,
          lotId: lot.id,
          quantity: lot.quantity,
          reason: "initial",
          costPerUnit: lot.costPerUnit,
          createdBy: "seed",
        });
      });
    }
  }
  console.log(`Created ${seededLots.filter(l => parseFloat(l.quantity) > 0).length} initial stock movements`);

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
