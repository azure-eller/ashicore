import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeMoney, normalizeNumeric } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

const DEMO_MARKER = "[seed:paonia-planning-demo]";
const CONFIRMED_IMPORT_SOURCE_ROWS = [191, 188, 159];
const GENERATED_SALES_ORDER_COUNT = 3;
const PURCHASE_ORDER_COUNT = 6;
const MANUFACTURING_ORDER_COUNT = 6;
const DEFAULT_SEED_ORG_NAME = "Paonia Demo";
const DEFAULT_SEED_ORG_SLUG = "paonia-demo";

const INTERNAL_ONLY_PRODUCT_CATEGORIES = new Set([
  "Nutrient Packs",
  "Packaging Assemblies",
]);
const SUPPLEMENTAL_SALES_PRODUCT_CATEGORIES = new Set([
  "Soil Bags",
  "Soil Totes",
]);
const MANUFACTURING_DEMO_PRODUCT_CATEGORIES = new Set([
  "Nutrient Packs",
  "Soil Totes",
]);

type ApiResult = {
  status: number;
  body: unknown;
};

type ApiHelpers = typeof import("../test/helpers/api");

type DemoSupplier = {
  id: string;
  name: string;
};

type DemoCustomer = {
  id: string;
  name: string;
};

type DemoItem = {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  category: string | null;
  unitDefinitionId: string | null;
  unitName: string;
  purchaseUnitDefinitionId: string | null;
  purchaseToStockFactor: string | null;
  defaultPurchasePrice: string | null;
  currentStockUnitCost: string | null;
  defaultSellingPrice: string | null;
  sellable: boolean | null;
  manufacturingMode: string;
};

type DemoBomComponent = {
  itemId: string;
  quantity: string;
};

type DemoCatalog = {
  materials: DemoItem[];
  products: DemoItem[];
  productsWithBom: Array<DemoItem & { components: DemoBomComponent[] }>;
  customers: DemoCustomer[];
  suppliers: DemoSupplier[];
};

function addDays(days: number) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value: string | null | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return normalizeMoney(Number.isFinite(parsed) ? parsed : fallback);
}

function quantity(value: number) {
  return normalizeNumeric(value);
}

function marker(kind: string, index: number | string) {
  return `${DEMO_MARKER}:${kind}:${index}`;
}

function hasMarker(notes: string | null, value: string) {
  return notes?.includes(value) ?? false;
}

function firstNoteLine(notes: string | null) {
  return notes?.split(/\r?\n/)[0] ?? null;
}

function paoniaOrderMarker(prefix: string, sourceRow: number) {
  return `${prefix}${sourceRow}]`;
}

function hasCategory(
  item: Pick<DemoItem, "category">,
  categories: Set<string>
) {
  return item.category != null && categories.has(item.category);
}

function isSupplementalSalesProduct(item: DemoItem) {
  return (
    item.itemType === "product" &&
    item.sellable === true &&
    item.defaultSellingPrice != null &&
    hasCategory(item, SUPPLEMENTAL_SALES_PRODUCT_CATEGORIES)
  );
}

function isManufacturingDemoProduct(item: DemoItem) {
  return (
    item.itemType === "product" &&
    hasCategory(item, MANUFACTURING_DEMO_PRODUCT_CATEGORIES) &&
    (item.category === "Nutrient Packs" ||
      !hasCategory(item, INTERNAL_ONLY_PRODUCT_CATEGORIES))
  );
}

function productReorderPoint(item: Pick<DemoItem, "category" | "name">) {
  const category = item.category ?? "";
  const name = item.name.toLowerCase();

  if (category === "Packaging Assemblies") {
    return name.includes("1 cubic foot") ? 24 : 12;
  }

  if (category === "Nutrient Packs") {
    return 12;
  }

  if (category === "Soil Totes") {
    return 3;
  }

  if (category === "Soil Bags") {
    return name.includes("1 cubic foot") ? 24 : 12;
  }

  if (category === "Promotional Pallets") {
    return 1;
  }

  return null;
}

function productPlanningValues(item: Pick<DemoItem, "category" | "name">) {
  const category = item.category ?? "";
  const reorderPoint = productReorderPoint(item);

  if (category === "Packaging Assemblies") {
    return {
      safetyStock: 0,
      reorderPoint,
      targetCoverDays: null,
      productionLeadTimeDays: 1,
    };
  }

  if (category === "Nutrient Packs") {
    return {
      safetyStock: 0,
      reorderPoint,
      targetCoverDays: null,
      productionLeadTimeDays: 1,
    };
  }

  if (category === "Soil Totes") {
    return {
      safetyStock: 0,
      reorderPoint,
      targetCoverDays: 5,
      productionLeadTimeDays: 2,
    };
  }

  if (category === "Soil Bags") {
    return {
      safetyStock: 0,
      reorderPoint,
      targetCoverDays: 5,
      productionLeadTimeDays: 2,
    };
  }

  return {
    safetyStock: 0,
    reorderPoint,
    targetCoverDays: null,
    productionLeadTimeDays: 3,
  };
}

function materialReorderPoint(item: Pick<DemoItem, "category" | "name">) {
  const category = item.category ?? "";
  const name = item.name.toLowerCase();

  if (category === "Packaging") {
    if (name.includes("blank 2 cubic foot bag")) return 500;
    if (name.includes("blank 1.5 cubic foot bag")) return 250;
    if (name.includes("blank 1 cubic foot bag")) return 250;
    if (name.includes("sticker")) return 100;
    if (name.includes("tote")) return 25;
    if (name.includes("wrap")) return 5;
    return 50;
  }

  if (category === "Base Media") {
    return name.includes("top soil") ? 25 : 50;
  }

  if (category === "Compost & Biology") {
    return name.includes("worm") ? 100 : 25;
  }

  if (category === "Meals & Nutrients") {
    return 10;
  }

  if (category === "Minerals & Trace") {
    return 5;
  }

  if (category === "Nutrients & Amendments") {
    return name.includes("brick") ? 12 : 6;
  }

  if (category === "Process Inputs") {
    return 5;
  }

  return null;
}

function materialPlanningValues(
  item: Pick<DemoItem, "category" | "name">,
  index: number
) {
  const category = item.category ?? "";
  const isPackaging = category === "Packaging";

  return {
    safetyStock: 0,
    reorderPoint: materialReorderPoint(item),
    targetCoverDays: null,
    leadTimeDaysOverride: isPackaging ? 7 : 3 + (index % 5),
  };
}

function supplierMinimumOrderQuantity(
  item: Pick<DemoItem, "category">,
  index: number
) {
  const category = item.category ?? "";
  if (category === "Packaging") return 25 + (index % 4) * 25;
  if (category === "Base Media" || category === "Compost & Biology") {
    return 2 + (index % 4) * 2;
  }
  return 1 + (index % 4);
}

function supplierOrderMultiple(item: Pick<DemoItem, "category">) {
  return item.category === "Packaging" ? 25 : 1;
}

function salesQuantityForProduct(
  product: DemoItem,
  index: number,
  lineIndex: number
) {
  if (product.category === "Soil Bags") {
    return 12 + ((index + lineIndex) % 3) * 12;
  }

  if (product.category === "Soil Totes") {
    return 2 + ((index + lineIndex) % 3);
  }

  return 1 + ((index + lineIndex) % 3);
}

function purchaseQuantityForMaterial(
  material: DemoItem,
  index: number,
  lineIndex: number
) {
  const category = material.category ?? "";
  if (category === "Packaging") {
    return 100 + ((index + lineIndex) % 4) * 50;
  }

  if (category === "Base Media" || category === "Compost & Biology") {
    return 4 + ((index + lineIndex) % 4) * 2;
  }

  if (category === "Meals & Nutrients" || category === "Minerals & Trace") {
    return 2 + ((index + lineIndex) % 4);
  }

  return 3 + ((index + lineIndex) % 4);
}

function manufacturingQuantityForProduct(product: DemoItem, index: number) {
  const step = index % 3;

  if (product.category === "Nutrient Packs") {
    return step === 0 ? 8 : step === 1 ? 10 : 12;
  }

  if (product.category === "Soil Totes") {
    return step === 0 ? 9 : step === 1 ? 18 : 27;
  }

  return step === 0 ? 4 : step === 1 ? 6 : 8;
}

async function expectStatus<T extends ApiResult>(
  label: string,
  resultPromise: Promise<T>,
  statuses = [200, 201]
) {
  const result = await resultPromise;
  if (!statuses.includes(result.status)) {
    throw new Error(
      `${label} failed with ${result.status}: ${JSON.stringify(result.body)}`
    );
  }
  return result;
}

async function archiveInactiveImportedPaoniaOrders(orgId: string) {
  const { salesOrders } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");
  const { PAONIA_2026_ORDER_MARKER_PREFIX } = await import(
    "./load/paonia/customers-2026"
  );
  const activeMarkers = new Set(
    CONFIRMED_IMPORT_SOURCE_ROWS.map((sourceRow) =>
      paoniaOrderMarker(PAONIA_2026_ORDER_MARKER_PREFIX, sourceRow)
    )
  );

  return withOrgContext(orgId, async (tx) => {
    const importedOrders = await tx
      .select({
        id: salesOrders.id,
        notes: salesOrders.notes,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          isNull(salesOrders.deletedAt),
          sql`${salesOrders.notes} LIKE ${`${PAONIA_2026_ORDER_MARKER_PREFIX}%`}`
        )
      );
    const archivedIds = importedOrders
      .filter((order) => !activeMarkers.has(firstNoteLine(order.notes) ?? ""))
      .map((order) => order.id);

    if (archivedIds.length === 0) {
      return 0;
    }

    await tx
      .update(salesOrders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(inArray(salesOrders.id, archivedIds));

    return archivedIds.length;
  });
}

async function loadPaoniaBaseData(orgId: string) {
  const { paoniaLoaderConfig } = await import("./load/paonia/index");
  const { applyChanges } = await import("./load/engine/apply");
  const { runSalesImport } = await import("./load/engine/plan");

  const catalogReport = await applyChanges(
    orgId,
    paoniaLoaderConfig,
    "seed-paonia",
    "paonia-opening"
  );
  const salesReport = await runSalesImport(orgId, paoniaLoaderConfig, {
    apply: true,
    customersOnly: false,
  });
  const archivedImportedOrders = await archiveInactiveImportedPaoniaOrders(orgId);

  console.log(
    [
      "Paonia catalog:",
      `${catalogReport.createdItems.length} items created`,
      `${catalogReport.updatedItems.length} updated`,
      `${catalogReport.stockLotsCreated.length} opening lots created`,
      `${catalogReport.syncedBoms.length} BOMs synced`,
    ].join(" ")
  );
  console.log(
    [
      "Paonia sales import:",
      `${salesReport.createdCustomers.length} customers created`,
      `${salesReport.createdOrders.length} orders created`,
      `${salesReport.existingOrders.length} existing orders`,
      `${salesReport.skippedOrders.length} skipped`,
      `${archivedImportedOrders} archived for demo scale`,
    ].join(" ")
  );
}

async function ensureDemoSuppliersInTx(tx: Tx, orgId: string) {
  const { suppliers } = await import("@/lib/db/schema");
  const now = new Date();
  const supplierSeeds = [
    {
      name: "Mesa Valley Inputs",
      code: "SEED-MESA-INPUTS",
      contactName: "Mira Stone",
      email: "orders+mesa@example.test",
      phone: "970-555-0141",
      paymentTerms: "Net 15",
    },
    {
      name: "Western Slope Packaging",
      code: "SEED-WESTERN-PACK",
      contactName: "Devon Reed",
      email: "orders+packaging@example.test",
      phone: "970-555-0142",
      paymentTerms: "Net 30",
    },
    {
      name: "North Fork Minerals",
      code: "SEED-NF-MINERALS",
      contactName: "Jules Navarro",
      email: "orders+minerals@example.test",
      phone: "970-555-0143",
      paymentTerms: "Due on receipt",
    },
    {
      name: "High Desert Organics",
      code: "SEED-HD-ORGANICS",
      contactName: "Ari Valdez",
      email: "orders+organics@example.test",
      phone: "970-555-0144",
      paymentTerms: "Net 10",
    },
  ];

  const resolved: DemoSupplier[] = [];

  for (const seed of supplierSeeds) {
    const [existing] = await tx
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organizationId, orgId),
          eq(suppliers.code, seed.code),
          isNull(suppliers.deletedAt)
        )
      )
      .limit(1);

    if (existing) {
      await tx
        .update(suppliers)
        .set({
          name: seed.name,
          contactName: seed.contactName,
          email: seed.email,
          phone: seed.phone,
          paymentTerms: seed.paymentTerms,
          updatedAt: now,
        })
        .where(eq(suppliers.id, existing.id));
      resolved.push({ id: existing.id, name: seed.name });
      continue;
    }

    const [created] = await tx
      .insert(suppliers)
      .values({
        organizationId: orgId,
        ...seed,
        notes: `${DEMO_MARKER}:supplier`,
      })
      .returning({ id: suppliers.id, name: suppliers.name });
    resolved.push(created);
  }

  return resolved;
}

async function ensureDemoCustomersInTx(tx: Tx, orgId: string) {
  const { customers } = await import("@/lib/db/schema");
  const now = new Date();
  const customerSeeds = [
    "North Fork Farmstead",
    "Mesa Ridge Nursery",
    "Valley Bloom Supply",
    "Orchard City Garden Center",
    "Delta Greenhouse Co",
    "Cedar Mesa Cultivation",
    "Gunnison Grow Depot",
    "Uncompahgre Farm Store",
  ];

  for (const name of customerSeeds) {
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, orgId),
          eq(customers.name, name),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);

    if (existing) {
      await tx
        .update(customers)
        .set({
          phone: "970-555-0188",
          billingCity: "Paonia",
          billingRegion: "CO",
          billingCountry: "USA",
          notes: "Seeded Paonia-style planning customer.",
          updatedAt: now,
        })
        .where(eq(customers.id, existing.id));
      continue;
    }

    await tx.insert(customers).values({
      organizationId: orgId,
      name,
      phone: "970-555-0188",
      billingCity: "Paonia",
      billingRegion: "CO",
      billingCountry: "USA",
      notes: "Seeded Paonia-style planning customer.",
    });
  }
}

async function applyPlanningRulesInTx(
  tx: Tx,
  orgId: string,
  suppliersList: DemoSupplier[]
) {
  const { items, supplierItems } = await import("@/lib/db/schema");
  const activeItems = await tx
    .select({
      id: items.id,
      name: items.name,
      itemType: items.itemType,
      category: items.category,
      purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
      purchaseToStockFactor: items.purchaseToStockFactor,
      defaultPurchasePrice: items.defaultPurchasePrice,
      currentStockUnitCost: items.currentStockUnitCost,
      unitDefinitionId: items.unitDefinitionId,
    })
    .from(items)
    .where(
      and(
        eq(items.organizationId, orgId),
        eq(items.isMaster, false),
        isNull(items.deletedAt)
      )
    )
    .orderBy(asc(items.itemType), asc(items.name));

  const materials = activeItems.filter((item) => item.itemType === "material");
  const products = activeItems.filter((item) => item.itemType === "product");

  for (const [index, item] of materials.entries()) {
    const supplier = suppliersList[index % suppliersList.length];
    const fallbackCost = 0.75 + (index % 9) * 0.45;
    const unitCost = money(
      item.defaultPurchasePrice ?? item.currentStockUnitCost,
      fallbackCost
    );
    const purchaseUnitDefinitionId =
      item.purchaseUnitDefinitionId ?? item.unitDefinitionId;
    const purchaseToStockFactor = item.purchaseToStockFactor ?? "1";
    const planningValues = materialPlanningValues(item, index);

    await tx
      .update(items)
      .set({
        planningEnabled: true,
        safetyStock: quantity(planningValues.safetyStock),
        reorderPoint:
          planningValues.reorderPoint == null
            ? null
            : quantity(planningValues.reorderPoint),
        targetCoverDays:
          planningValues.targetCoverDays == null
            ? null
            : quantity(planningValues.targetCoverDays),
        leadTimeDaysOverride: quantity(planningValues.leadTimeDaysOverride),
        updatedAt: new Date(),
      })
      .where(eq(items.id, item.id));

    await tx
      .update(supplierItems)
      .set({ isPreferred: false, updatedAt: new Date() })
      .where(
        and(
          eq(supplierItems.itemId, item.id),
          eq(supplierItems.isPreferred, true),
          isNull(supplierItems.deletedAt)
        )
      );

    const [existingSupplierItem] = await tx
      .select({ id: supplierItems.id })
      .from(supplierItems)
      .where(
        and(
          eq(supplierItems.itemId, item.id),
          eq(supplierItems.supplierId, supplier.id),
          isNull(supplierItems.deletedAt)
        )
      )
      .limit(1);

    const supplierItemValues = {
      supplierSku: `SUP-${String(index + 1).padStart(4, "0")}`,
      unitCost,
      purchaseUnitDefinitionId,
      purchaseToStockFactor,
      leadTimeDaysOverride: quantity(planningValues.leadTimeDaysOverride),
      minimumOrderQuantity: quantity(supplierMinimumOrderQuantity(item, index)),
      orderMultiple: quantity(supplierOrderMultiple(item)),
      isPreferred: true,
      updatedAt: new Date(),
    };

    if (existingSupplierItem) {
      await tx
        .update(supplierItems)
        .set(supplierItemValues)
        .where(eq(supplierItems.id, existingSupplierItem.id));
    } else {
      await tx.insert(supplierItems).values({
        organizationId: orgId,
        supplierId: supplier.id,
        itemId: item.id,
        ...supplierItemValues,
      });
    }
  }

  for (const item of products) {
    const planningValues = productPlanningValues(item);

    await tx
      .update(items)
      .set({
        planningEnabled: true,
        safetyStock: quantity(planningValues.safetyStock),
        reorderPoint:
          planningValues.reorderPoint == null
            ? null
            : quantity(planningValues.reorderPoint),
        targetCoverDays:
          planningValues.targetCoverDays == null
            ? null
            : quantity(planningValues.targetCoverDays),
        productionLeadTimeDays: quantity(planningValues.productionLeadTimeDays),
        updatedAt: new Date(),
      })
      .where(eq(items.id, item.id));
  }
}

async function loadDemoCatalog(orgId: string): Promise<DemoCatalog> {
  const {
    bomRevisionComponents,
    bomRevisions,
    customers,
    items,
    suppliers,
    unitDefinitions,
  } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");

  return withOrgContext(orgId, async (tx) => {
    await ensureDemoCustomersInTx(tx, orgId);
    const suppliersList = await ensureDemoSuppliersInTx(tx, orgId);
    await applyPlanningRulesInTx(tx, orgId, suppliersList);

    const itemRows = await tx
      .select({
        id: items.id,
        name: items.name,
        sku: items.sku,
        itemType: items.itemType,
        category: items.category,
        unitDefinitionId: items.unitDefinitionId,
        unitName: unitDefinitions.name,
        purchaseUnitDefinitionId: items.purchaseUnitDefinitionId,
        purchaseToStockFactor: items.purchaseToStockFactor,
        defaultPurchasePrice: items.defaultPurchasePrice,
        currentStockUnitCost: items.currentStockUnitCost,
        defaultSellingPrice: items.defaultSellingPrice,
        sellable: items.sellable,
        manufacturingMode: items.manufacturingMode,
      })
      .from(items)
      .innerJoin(unitDefinitions, eq(unitDefinitions.id, items.unitDefinitionId))
      .where(
        and(
          eq(items.organizationId, orgId),
          eq(items.isMaster, false),
          isNull(items.deletedAt)
        )
      )
      .orderBy(asc(items.category), asc(items.name), asc(items.id));

    const bomRows = await tx
      .select({
        productId: bomRevisions.productId,
        componentId: bomRevisionComponents.componentId,
        quantity: bomRevisionComponents.quantity,
      })
      .from(bomRevisions)
      .innerJoin(
        bomRevisionComponents,
        eq(bomRevisionComponents.bomRevisionId, bomRevisions.id)
      )
      .where(
        and(
          eq(bomRevisions.organizationId, orgId),
          eq(bomRevisions.isCurrent, true)
        )
      )
      .orderBy(asc(bomRevisionComponents.sortOrder));

    const componentsByProduct = new Map<string, DemoBomComponent[]>();
    for (const row of bomRows) {
      const bucket = componentsByProduct.get(row.productId) ?? [];
      bucket.push({ itemId: row.componentId, quantity: row.quantity });
      componentsByProduct.set(row.productId, bucket);
    }

    const customerRows = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.organizationId, orgId), isNull(customers.deletedAt)))
      .orderBy(asc(customers.name));

    const supplierRows = await tx
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, orgId), isNull(suppliers.deletedAt)))
      .orderBy(asc(suppliers.name));

    const materialRows = itemRows.filter(
      (item): item is DemoItem => item.itemType === "material"
    );
    const productRows = itemRows.filter(
      (item): item is DemoItem =>
        item.itemType === "product" && isSupplementalSalesProduct(item)
    );
    const productsWithBom = itemRows
      .filter(
        (item): item is DemoItem =>
          item.itemType === "product" && isManufacturingDemoProduct(item)
      )
      .map((item) => ({
        ...item,
        components: componentsByProduct.get(item.id) ?? [],
      }))
      .filter((item) => item.components.length > 0);

    return {
      materials: materialRows,
      products: productRows,
      productsWithBom,
      customers: customerRows,
      suppliers: supplierRows,
    };
  });
}

async function existingSeedOrderMarkers(
  orgId: string,
  table: "sales" | "purchase" | "manufacturing"
) {
  const { manufacturingOrders, purchaseOrders, salesOrders } = await import(
    "@/lib/db/schema"
  );
  const { withOrgContext } = await import("@/lib/db/with-org-context");

  return withOrgContext(orgId, async (tx) => {
    const rows =
      table === "sales"
        ? await tx
            .select({ notes: salesOrders.notes })
            .from(salesOrders)
            .where(
              and(
                eq(salesOrders.organizationId, orgId),
                isNull(salesOrders.deletedAt),
                sql`${salesOrders.notes} LIKE ${`${DEMO_MARKER}:%`}`
              )
            )
        : table === "purchase"
          ? await tx
              .select({ notes: purchaseOrders.notes })
              .from(purchaseOrders)
              .where(
                and(
                  eq(purchaseOrders.organizationId, orgId),
                  isNull(purchaseOrders.deletedAt),
                  sql`${purchaseOrders.notes} LIKE ${`${DEMO_MARKER}:%`}`
                )
              )
          : await tx
              .select({ notes: manufacturingOrders.notes })
              .from(manufacturingOrders)
              .where(
                and(
                  eq(manufacturingOrders.organizationId, orgId),
                  isNull(manufacturingOrders.deletedAt),
                  sql`${manufacturingOrders.notes} LIKE ${`${DEMO_MARKER}:%`}`
                )
              );

    return new Set(rows.map((row) => row.notes ?? ""));
  });
}

async function confirmImportedPaoniaOrders(api: ApiHelpers, orgId: string) {
  const { salesOrders } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");
  const { PAONIA_2026_ORDER_MARKER_PREFIX } = await import(
    "./load/paonia/customers-2026"
  );
  const importedDrafts = await withOrgContext(orgId, (tx) =>
    tx
      .select({
        id: salesOrders.id,
        orderNumber: salesOrders.orderNumber,
        notes: salesOrders.notes,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.organizationId, orgId),
          eq(salesOrders.status, "draft"),
          isNull(salesOrders.deletedAt),
          sql`${salesOrders.notes} LIKE ${`${PAONIA_2026_ORDER_MARKER_PREFIX}%`}`,
          sql`EXISTS (
            SELECT 1
            FROM sales.sales_order_lines line
            WHERE line.sales_order_id = ${salesOrders.id}
          )`
        )
      )
      .orderBy(asc(salesOrders.requestedDate), asc(salesOrders.orderNumber))
  );
  const targetMarkers = new Set(
    CONFIRMED_IMPORT_SOURCE_ROWS.map(
      (sourceRow) => paoniaOrderMarker(PAONIA_2026_ORDER_MARKER_PREFIX, sourceRow)
    )
  );
  const ordersToConfirm = importedDrafts.filter((order) => {
    const firstLine = firstNoteLine(order.notes);
    return firstLine != null && targetMarkers.has(firstLine);
  });

  let confirmed = 0;
  for (const order of ordersToConfirm) {
    await expectStatus(
      `Confirm imported ${order.orderNumber}`,
      api.confirmSalesOrder(order.id, { confirmOversell: true })
    );
    confirmed += 1;
  }

  return confirmed;
}

async function createGeneratedSalesOrders(
  api: ApiHelpers,
  orgId: string,
  catalog: DemoCatalog
) {
  const existingMarkers = await existingSeedOrderMarkers(orgId, "sales");
  const usableProducts = catalog.products;
  let created = 0;

  if (usableProducts.length === 0 || catalog.customers.length === 0) {
    return created;
  }

  for (let index = 0; index < GENERATED_SALES_ORDER_COUNT; index += 1) {
    const orderMarker = marker("sales", index);
    if ([...existingMarkers].some((notes) => hasMarker(notes, orderMarker))) {
      continue;
    }

    const customer = catalog.customers[index % catalog.customers.length];
    const lineCount = index === 0 ? 2 : 1;
    const lines = Array.from({ length: lineCount }, (_, lineIndex) => {
      const product =
        usableProducts[(index * 3 + lineIndex * 5) % usableProducts.length];
      return {
        itemId: product.id,
        quantity: quantity(salesQuantityForProduct(product, index, lineIndex)),
        unitPrice: money(product.defaultSellingPrice, 18 + lineIndex * 4),
      };
    });

    await expectStatus(
      `Create generated sales order ${index + 1}`,
      api.createSalesOrder({
        customerId: customer.id,
        status: index === 2 ? "draft" : "confirmed",
        requestedDate: addDays(2 + index * 2),
        notes: `${orderMarker}\nGenerated from scrambled Paonia catalog demand.`,
        lines,
        confirmOversell: true,
      })
    );
    created += 1;
  }

  return created;
}

async function purchaseOrderLineIds(orgId: string, purchaseOrderId: string) {
  const { purchaseOrderLines } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");

  return withOrgContext(orgId, (tx) =>
    tx
      .select({
        id: purchaseOrderLines.id,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(purchaseOrderLines.sortOrder))
  );
}

async function createPurchaseOrders(
  api: ApiHelpers,
  orgId: string,
  catalog: DemoCatalog
) {
  const existingMarkers = await existingSeedOrderMarkers(orgId, "purchase");
  let created = 0;
  let submitted = 0;
  let partiallyReceived = 0;

  if (catalog.materials.length === 0 || catalog.suppliers.length === 0) {
    return { created, submitted, partiallyReceived };
  }

  for (let index = 0; index < PURCHASE_ORDER_COUNT; index += 1) {
    const orderMarker = marker("purchase", index);
    if ([...existingMarkers].some((notes) => hasMarker(notes, orderMarker))) {
      continue;
    }

    const supplier = catalog.suppliers[index % catalog.suppliers.length];
    const lineCount = index % 2 === 0 ? 2 : 1;
    const lines = Array.from({ length: lineCount }, (_, lineIndex) => {
      const material =
        catalog.materials[(index * 3 + lineIndex * 7) % catalog.materials.length];
      return {
        itemId: material.id,
        quantityOrdered: quantity(
          purchaseQuantityForMaterial(material, index, lineIndex)
        ),
        unitCost: money(
          material.defaultPurchasePrice ?? material.currentStockUnitCost,
          1.25 + lineIndex
        ),
      };
    });

    const order = await expectStatus(
      `Create purchase order ${index + 1}`,
      api.createPurchaseOrder({
        supplierId: supplier.id,
        expectedDate: addDays(3 + (index % 18)),
        notes: `${orderMarker}\nSeeded planning purchase supply.`,
        lines,
      })
    );
    created += 1;

    const orderId = (order.body as { id?: string } | null)?.id;
    if (!orderId || index % 3 === 0) {
      continue;
    }

    await expectStatus(
      `Submit purchase order ${index + 1}`,
      api.submitPurchaseOrder(orderId)
    );
    submitted += 1;

    if (index === 5) {
      const [firstLine] = await purchaseOrderLineIds(orgId, orderId);
      if (firstLine) {
        await expectStatus(
          `Partially receive purchase order ${index + 1}`,
          api.receivePurchaseOrder(orderId, {
            lines: [
              {
                lineId: firstLine.id,
                quantityReceived: quantity(
                  Number.parseFloat(firstLine.quantityOrdered) / 2
                ),
              },
            ],
          })
        );
        partiallyReceived += 1;
      }
    }
  }

  return { created, submitted, partiallyReceived };
}

async function createManufacturingOrders(
  api: ApiHelpers,
  orgId: string,
  catalog: DemoCatalog
) {
  const existingMarkers = await existingSeedOrderMarkers(orgId, "manufacturing");
  let created = 0;
  let released = 0;

  const nutrientPackProducts = catalog.productsWithBom
    .filter((product) => product.category === "Nutrient Packs")
    .slice(0, 3);
  const finishedGoodProducts = catalog.productsWithBom
    .filter((product) => product.category === "Soil Totes")
    .slice(0, 3);
  const usableProducts = [...nutrientPackProducts, ...finishedGoodProducts];

  if (usableProducts.length === 0) {
    return { created, released };
  }

  for (let index = 0; index < MANUFACTURING_ORDER_COUNT; index += 1) {
    const orderMarker = marker("manufacturing", index);
    if ([...existingMarkers].some((notes) => hasMarker(notes, orderMarker))) {
      continue;
    }

    const product = usableProducts[index % usableProducts.length];
    const plannedQuantity = quantity(manufacturingQuantityForProduct(product, index));
    const order = await expectStatus(
      `Create manufacturing order ${index + 1}`,
      api.createManufacturingOrder({
        productId: product.id,
        plannedQuantity,
        plannedDate: addDays(2 + (index % 21)),
        notes: `${orderMarker}\nSeeded planning production supply.`,
        ingredients: product.components.map((component) => ({
          itemId: component.itemId,
          quantityPerUnit: component.quantity,
        })),
        confirmShortage: true,
      })
    );
    created += 1;

    const orderId = (order.body as { id?: string } | null)?.id;
    if (!orderId || index % 3 === 0) {
      continue;
    }

    await expectStatus(
      `Release manufacturing order ${index + 1}`,
      api.releaseManufacturingOrder(orderId, { confirmShortage: true })
    );
    released += 1;
  }

  return { created, released };
}

async function seedPlanningDemoData(api: ApiHelpers, orgId: string) {
  const catalog = await loadDemoCatalog(orgId);
  const importedConfirmed = await confirmImportedPaoniaOrders(api, orgId);
  const generatedSales = await createGeneratedSalesOrders(api, orgId, catalog);
  const purchaseOrders = await createPurchaseOrders(api, orgId, catalog);
  const manufacturingOrders = await createManufacturingOrders(api, orgId, catalog);

  console.log(
    [
      "Planning demo:",
      `${catalog.materials.length} materials`,
      `${catalog.products.length} sellable products`,
      `${catalog.productsWithBom.length} BOM-backed products`,
      `${importedConfirmed} imported orders confirmed`,
      `${generatedSales} generated sales orders`,
      `${purchaseOrders.created} POs`,
      `${purchaseOrders.submitted} submitted`,
      `${purchaseOrders.partiallyReceived} partial receipts`,
      `${manufacturingOrders.created} MOs`,
      `${manufacturingOrders.released} released`,
    ].join(" ")
  );
}

async function main() {
  process.env.TEST_ORG =
    process.env.SEED_ORG ?? process.env.TEST_ORG ?? DEFAULT_SEED_ORG_NAME;
  process.env.TEST_ORG_SLUG =
    process.env.SEED_ORG_SLUG ??
    process.env.TEST_ORG_SLUG ??
    DEFAULT_SEED_ORG_SLUG;

  const { ensureTestAccount } = await import(
    "../test/helpers/test-account-setup"
  );
  const account = await ensureTestAccount({ log: console.log });
  await loadPaoniaBaseData(account.organizationId);

  const api = await import("../test/helpers/api");
  await seedPlanningDemoData(api, account.organizationId);

  console.log(`Seed complete for ${account.email}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
