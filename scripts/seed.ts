import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { unitDefinitions, items } from "@/lib/db/schema";

async function main() {
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
        inStock: "48",
        safetyStock: "10",
      },
      {
        organizationId: orgId,
        name: "Perlite",
        sku: "MAT-PRL-001",
        category: "Amendments",
        itemType: "material",
        unitDefinitionId: bag1.id,
        inStock: "120",
        safetyStock: "24",
      },
      {
        organizationId: orgId,
        name: "Compost",
        sku: "MAT-CMP-001",
        category: "Organics",
        itemType: "material",
        unitDefinitionId: yard.id,
        inStock: "30",
        safetyStock: "8",
      },
      {
        organizationId: orgId,
        name: "Pumice",
        sku: "MAT-PMC-001",
        category: "Amendments",
        itemType: "material",
        unitDefinitionId: bag1.id,
        inStock: "60",
        safetyStock: "12",
      },
      {
        organizationId: orgId,
        name: "Worm Castings",
        sku: "MAT-WC-001",
        category: "Organics",
        itemType: "material",
        unitDefinitionId: lb.id,
        inStock: "500",
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
        inStock: "200",
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
        inStock: "15",
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
        inStock: "85",
        safetyStock: "20",
        defaultSellingPrice: "12.49",
      },
    ])
    .returning({ id: items.id, name: items.name });

  console.log(`Inserted ${insertedItems.length} items:`);
  for (const item of insertedItems) {
    console.log(`  - ${item.name}`);
  }

  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
