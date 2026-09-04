import type { ItemSeed, LoaderConfig, SupplierSeed, UnitSeed } from "../engine/types";

// Riverstone Coffee Roasters — the fictional company used for documentation
// screenshots. Distinct from the Paonia/test data on purpose: a roaster buys
// green coffee by origin, roasts to batch recipes, and sells wholesale, so it
// exercises purchasing, inventory lots, manufacturing, and sales for the docs.
//
// Numbers are deterministic (no Date.now()/random) so seeded rows — and the
// screenshots taken from them — stay stable run to run.

const units: UnitSeed[] = [
  { key: "kg", name: "Kilogram", size: "1", uom: "kg" },
  { key: "each", name: "Each", size: "1", uom: "ea" },
  { key: "roll", name: "Roll", size: "1", uom: "ea" },
];

const greenCoffees: ItemSeed[] = [
  {
    key: "green_colombia_huila",
    sku: "RVS-GRN-COL-HUILA",
    name: "Green Coffee — Colombia Huila",
    itemType: "material",
    unitKey: "kg",
    category: "Green Coffee",
    description: "Washed Colombia Huila, supplier-lot traceable. Roasted into House Blend and single-origin offerings.",
    defaultPurchasePrice: "8.50",
    currentStockUnitCost: "8.50",
  },
  {
    key: "green_ethiopia_yirgacheffe",
    sku: "RVS-GRN-ETH-YIRG",
    name: "Green Coffee — Ethiopia Yirgacheffe",
    itemType: "material",
    unitKey: "kg",
    category: "Green Coffee",
    description: "Washed Ethiopia Yirgacheffe, floral and bright. Roasted as a single origin.",
    defaultPurchasePrice: "11.20",
    currentStockUnitCost: "11.20",
  },
  {
    key: "green_brazil_cerrado",
    sku: "RVS-GRN-BRA-CERR",
    name: "Green Coffee — Brazil Cerrado",
    itemType: "material",
    unitKey: "kg",
    category: "Green Coffee",
    description: "Natural Brazil Cerrado, nutty and low-acid. House Blend base.",
    defaultPurchasePrice: "6.80",
    currentStockUnitCost: "6.80",
  },
  {
    key: "green_guatemala_antigua",
    sku: "RVS-GRN-GUA-ANTI",
    name: "Green Coffee — Guatemala Antigua",
    itemType: "material",
    unitKey: "kg",
    category: "Green Coffee",
    description: "Washed Guatemala Antigua, balanced and chocolatey. Seasonal single origin.",
    defaultPurchasePrice: "9.40",
    currentStockUnitCost: "9.40",
  },
];

const packaging: ItemSeed[] = [
  {
    key: "bag_250g_kraft",
    sku: "RVS-PKG-BAG-250",
    name: "Retail Bag — 250g Kraft",
    itemType: "material",
    unitKey: "each",
    category: "Packaging",
    description: "Kraft stand-up pouch with valve, 250g fill. Used for all retail roasted coffee.",
    defaultPurchasePrice: "0.42",
    currentStockUnitCost: "0.42",
  },
  {
    key: "box_shipping_12",
    sku: "RVS-PKG-BOX-12",
    name: "Shipping Box — 12 ct",
    itemType: "material",
    unitKey: "each",
    category: "Packaging",
    description: "Corrugated shipper holding twelve 250g bags. Wholesale fulfilment.",
    defaultPurchasePrice: "1.10",
    currentStockUnitCost: "1.10",
  },
  {
    key: "label_roll_1000",
    sku: "RVS-PKG-LBL-1000",
    name: "Label Roll — 1000 ct",
    itemType: "material",
    unitKey: "roll",
    category: "Packaging",
    description: "Pre-printed roast-date labels, 1000 per roll.",
    defaultPurchasePrice: "24.00",
    currentStockUnitCost: "24.00",
  },
];

const roastedProducts: ItemSeed[] = [
  {
    key: "roasted_house_blend",
    sku: "RVS-RST-HOUSE",
    name: "Roasted — House Blend",
    itemType: "product",
    unitKey: "kg",
    category: "Roasted Coffee",
    description: "Medium roast house blend. Roasted to batch from Colombia and Brazil greens.",
    manufacturingMode: "batch",
    expectedBatchYield: "40",
    typicalBatchSize: "48",
    defaultSellingPrice: "32.00",
    sellable: true,
    bom: [
      { componentKey: "green_colombia_huila", quantity: "0.7" },
      { componentKey: "green_brazil_cerrado", quantity: "0.5" },
    ],
  },
  {
    key: "roasted_ethiopia_single",
    sku: "RVS-RST-ETH",
    name: "Roasted — Ethiopia Single Origin",
    itemType: "product",
    unitKey: "kg",
    category: "Roasted Coffee",
    description: "Light roast Ethiopia Yirgacheffe single origin. Roasted to batch.",
    manufacturingMode: "batch",
    expectedBatchYield: "20",
    typicalBatchSize: "24",
    defaultSellingPrice: "42.00",
    sellable: true,
    bom: [{ componentKey: "green_ethiopia_yirgacheffe", quantity: "1.2" }],
  },
];

const seeds: ItemSeed[] = [...greenCoffees, ...packaging, ...roastedProducts];

const suppliers: SupplierSeed[] = [
  {
    name: "Cooperativa del Huila",
    code: "COOP-HUILA",
    contactName: "María Restrepo",
    email: "ventas@coophuila.example",
    phone: "+57 8 875 0042",
    billingCity: "Pitalito",
    billingRegion: "Huila",
    billingCountry: "Colombia",
    paymentTerms: "Net 30",
  },
  {
    name: "Yirgacheffe Farmers Union",
    code: "YCFCU",
    contactName: "Abebe Tadesse",
    email: "export@ycfcu.example",
    phone: "+251 11 552 1234",
    billingCity: "Addis Ababa",
    billingCountry: "Ethiopia",
    paymentTerms: "Net 45",
  },
  {
    name: "Crown Mountain Importers",
    code: "CROWN",
    contactName: "Dana Okafor",
    email: "orders@crownmtn.example",
    phone: "+1 503 555 0117",
    billingCity: "Portland",
    billingRegion: "OR",
    billingCountry: "USA",
    paymentTerms: "Net 30",
  },
  {
    name: "Cascade Packaging Co.",
    code: "CASCADE-PKG",
    contactName: "Priya Nair",
    email: "sales@cascadepkg.example",
    phone: "+1 206 555 0188",
    billingCity: "Seattle",
    billingRegion: "WA",
    billingCountry: "USA",
    paymentTerms: "Net 15",
  },
];

// Opening stock in each item's stock unit. Green coffees carry dated lots so
// inventory views show realistic ages; packaging is bulk on hand.
const initialStockByKey: Record<string, string | { quantity: string; ageDays?: number }> = {
  green_colombia_huila: { quantity: "276", ageDays: 20 },
  green_ethiopia_yirgacheffe: { quantity: "138", ageDays: 12 },
  green_brazil_cerrado: { quantity: "207", ageDays: 30 },
  green_guatemala_antigua: { quantity: "69", ageDays: 8 },
  bag_250g_kraft: "4000",
  box_shipping_12: "350",
  label_roll_1000: "12",
};

export const docsDemoLoaderConfig: LoaderConfig = {
  customerSlug: "docs-demo",
  customerLabel: "Riverstone Coffee Roasters",
  defaultOrgRef: "docs-demo",
  units,
  seeds,
  initialStockByKey,
  suppliers,
  openingLotPrefix: "OPEN",
  bomRevisionNote: "Managed by docs-demo loader",
};
