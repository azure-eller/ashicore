import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

type UnitSeed = {
  key: string;
  name: string;
  size: string;
  uom: string;
};

type ItemSummary = {
  id: string;
  name: string;
  sku: string | null;
};

type CreatedUnit = {
  id: string;
};

type CreatedItem = {
  id: string;
  name: string;
  sku: string | null;
};

const seedUnits: UnitSeed[] = [
  { key: "bale", name: "bale", size: "225", uom: "l" },
  { key: "bag-1", name: "bag", size: "1", uom: "cu ft" },
  { key: "bag-2", name: "bag", size: "2", uom: "cu ft" },
  { key: "yard", name: "yard", size: "1", uom: "cu yd" },
  { key: "lb", name: "lb", size: "1", uom: "lb" },
];

const materialSeeds = [
  {
    name: "Sphagnum Peat Moss",
    sku: "MAT-SPM-001",
    category: "Peat",
    unitKey: "bale",
    safetyStock: "10",
    stock: "48",
    defaultPurchasePrice: "8.5",
  },
  {
    name: "Perlite",
    sku: "MAT-PRL-001",
    category: "Amendments",
    unitKey: "bag-1",
    safetyStock: "24",
    stock: "120",
    defaultPurchasePrice: "2.75",
  },
  {
    name: "Compost",
    sku: "MAT-CMP-001",
    category: "Organics",
    unitKey: "yard",
    safetyStock: "8",
    stock: "30",
    defaultPurchasePrice: "32",
  },
  {
    name: "Pumice",
    sku: "MAT-PMC-001",
    category: "Amendments",
    unitKey: "bag-1",
    safetyStock: "12",
    stock: "60",
    defaultPurchasePrice: "3.5",
  },
  {
    name: "Worm Castings",
    sku: "MAT-WC-001",
    category: "Organics",
    unitKey: "lb",
    safetyStock: "100",
    stock: "500",
    defaultPurchasePrice: "0.85",
  },
];

const productSeeds = [
  {
    name: "Premium Garden Mix",
    sku: "PRD-PGM-001",
    category: "Potting Mix",
    unitKey: "bag-2",
    safetyStock: "40",
    defaultSellingPrice: "24.99",
    bom: [
      { sku: "MAT-SPM-001", quantity: "1" },
      { sku: "MAT-PRL-001", quantity: "1" },
      { sku: "MAT-CMP-001", quantity: "0.25" },
    ],
  },
  {
    name: "Raised Bed Blend",
    sku: "PRD-RBB-001",
    category: "Potting Mix",
    unitKey: "yard",
    safetyStock: "5",
    defaultSellingPrice: "89",
    bom: [
      { sku: "MAT-CMP-001", quantity: "1" },
      { sku: "MAT-PMC-001", quantity: "2" },
    ],
  },
  {
    name: "Seed Starting Mix",
    sku: "PRD-SSM-001",
    category: "Specialty",
    unitKey: "bag-1",
    safetyStock: "20",
    defaultSellingPrice: "12.49",
    bom: [
      { sku: "MAT-SPM-001", quantity: "1" },
      { sku: "MAT-PRL-001", quantity: "0.5" },
      { sku: "MAT-WC-001", quantity: "0.25" },
    ],
  },
];

async function apiFetch<T>(
  baseUrl: string,
  cookies: string,
  path: string,
  options: RequestInit & { idempotencyKey?: string } = {}
) {
  const {
    idempotencyKey,
    headers: optionHeaders,
    ...requestOptions
  } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookies,
    Origin: baseUrl,
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      ...headers,
      ...Object.fromEntries(new Headers(optionHeaders)),
    },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Request failed: ${options.method ?? "GET"} ${path} ${response.status} ${body}`
    );
  }

  return JSON.parse(body || "null") as T;
}

function itemPayload(params: {
  name: string;
  sku: string;
  category: string;
  itemType: "material" | "product";
  unitDefinitionId: string;
  safetyStock: string;
  stock: string;
  defaultPurchasePrice: string | null;
  defaultSellingPrice: string | null;
  bom: Array<{ componentId: string; quantity: string }>;
}) {
  return {
    name: params.name,
    sku: params.sku,
    category: params.category,
    itemType: params.itemType,
    sellable: true,
    unitDefinitionId: params.unitDefinitionId,
    purchaseUnitDefinitionId: null,
    purchaseToStockFactor: null,
    defaultPurchasePrice: params.defaultPurchasePrice,
    currentStockUnitCost: null,
    defaultSellingPrice: params.defaultSellingPrice,
    description: null,
    stock: params.stock,
    safetyStock: params.safetyStock,
    bom: params.bom,
    revisionNote: null,
    manufacturingMode: "discrete",
    expectedBatchYield: null,
  };
}

async function createSeedUnits(baseUrl: string, cookies: string) {
  const unitsByKey = new Map<string, string>();

  for (const unit of seedUnits) {
    const created = await apiFetch<CreatedUnit>(baseUrl, cookies, "/api/units", {
      method: "POST",
      body: JSON.stringify({
        name: unit.name,
        size: unit.size,
        uom: unit.uom,
      }),
    });
    unitsByKey.set(unit.key, created.id);
  }

  return unitsByKey;
}

async function listItems(baseUrl: string, cookies: string) {
  const [materials, products] = await Promise.all([
    apiFetch<ItemSummary[]>(baseUrl, cookies, "/api/items?itemType=material"),
    apiFetch<ItemSummary[]>(baseUrl, cookies, "/api/items?itemType=product"),
  ]);
  return [...materials, ...products];
}

async function main() {
  const { ensureTestAccount } = await import(
    "../test/helpers/test-account-setup"
  );
  const { readTestEnv } = await import("../test/helpers/test-env");
  const account = await ensureTestAccount();
  const env = readTestEnv();
  const runId = Date.now();
  const existingItems = await listItems(account.baseUrl, env.TEST_SESSION_COOKIE);
  const existingBySku = new Map(
    existingItems
      .filter((item) => item.sku)
      .map((item) => [item.sku as string, item])
  );
  const missingSkus = [...materialSeeds, ...productSeeds].filter(
    (seed) => !existingBySku.has(seed.sku)
  );

  if (missingSkus.length === 0) {
    console.log(`Seed data already exists for ${account.email}.`);
    return;
  }

  const unitsByKey = await createSeedUnits(
    account.baseUrl,
    env.TEST_SESSION_COOKIE
  );
  const materialIdsBySku = new Map<string, string>();
  let createdMaterials = 0;
  let createdProducts = 0;

  for (const material of materialSeeds) {
    const existing = existingBySku.get(material.sku);

    if (existing) {
      materialIdsBySku.set(material.sku, existing.id);
      continue;
    }

    const unitDefinitionId = unitsByKey.get(material.unitKey);
    if (!unitDefinitionId) {
      throw new Error(`Missing seed unit '${material.unitKey}'.`);
    }

    const created = await apiFetch<CreatedItem>(
      account.baseUrl,
      env.TEST_SESSION_COOKIE,
      "/api/items",
      {
        method: "POST",
        idempotencyKey: `seed:${material.sku}:${runId}`,
        body: JSON.stringify(
          itemPayload({
            ...material,
            itemType: "material",
            unitDefinitionId,
            defaultSellingPrice: null,
            bom: [],
          })
        ),
      }
    );
    materialIdsBySku.set(material.sku, created.id);
    existingBySku.set(material.sku, created);
    createdMaterials += 1;
  }

  for (const product of productSeeds) {
    if (existingBySku.has(product.sku)) {
      continue;
    }

    const unitDefinitionId = unitsByKey.get(product.unitKey);
    if (!unitDefinitionId) {
      throw new Error(`Missing seed unit '${product.unitKey}'.`);
    }

    const bom = product.bom.map((component) => {
      const componentId = materialIdsBySku.get(component.sku);

      if (!componentId) {
        throw new Error(`Missing seed material '${component.sku}'.`);
      }

      return {
        componentId,
        quantity: component.quantity,
      };
    });

    const created = await apiFetch<CreatedItem>(
      account.baseUrl,
      env.TEST_SESSION_COOKIE,
      "/api/items",
      {
        method: "POST",
        idempotencyKey: `seed:${product.sku}:${runId}`,
        body: JSON.stringify(
          itemPayload({
            ...product,
            itemType: "product",
            unitDefinitionId,
            stock: "0",
            defaultPurchasePrice: null,
            defaultSellingPrice: product.defaultSellingPrice,
            bom,
          })
        ),
      }
    );
    existingBySku.set(product.sku, created);
    createdProducts += 1;
  }

  console.log(
    `Seed complete for ${account.email}: ${createdMaterials} materials, ${createdProducts} products.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
