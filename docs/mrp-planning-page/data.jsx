// Sample data — Paonia Soil Co. style catalog.
// Generic ERP concepts: products, sub-assemblies, sales orders, BOM dep graph.

const PRODUCTS = {
  // 1-yard totes (sub-assemblies AND sellable end products)
  'BMB-1YT':       { sku: 'BMB-1YT',       name: 'The Bomb / Bomb OG',          unit: '1 yd tote', kind: 'tote' },
  'BMB50-1YT':     { sku: 'BMB50-1YT',     name: 'Bomb 50/50',                  unit: '1 yd tote', kind: 'tote' },
  'BMBRB-3S-1YT':  { sku: 'BMBRB-3S-1YT',  name: 'Raised Bed Mix + 3% Sand',    unit: '1 yd tote', kind: 'tote' },
  'CFM-1YT':       { sku: 'CFM-1YT',       name: 'Cut Flower Mix',              unit: '1 yd tote', kind: 'tote' },

  // Bagged finished goods
  'BMB-2CF':       { sku: 'BMB-2CF',       name: 'The Bomb / Bomb OG',          unit: '2 cf bag', kind: 'bag', from: 'BMB-1YT' },
  'BMB50-2CF':     { sku: 'BMB50-2CF',     name: 'Bomb 50/50',                  unit: '2 cf bag', kind: 'bag', from: 'BMB50-1YT' },
  'BMB50-1CF':     { sku: 'BMB50-1CF',     name: 'Bomb 50/50',                  unit: '1 cf bag', kind: 'bag', from: 'BMB50-1YT' },
  'BMBRB-2CF':     { sku: 'BMBRB-2CF',     name: 'Raised Bed Mix',              unit: '2 cf bag', kind: 'bag', from: 'BMBRB-3S-1YT' },
  'CFM-2CF':       { sku: 'CFM-2CF',       name: 'Cut Flower Mix',              unit: '2 cf bag', kind: 'bag', from: 'CFM-1YT' },
  'LWN-2CF':       { sku: 'LWN-2CF',       name: 'Lawngevity',                  unit: '2 cf bag', kind: 'bag' },
  'DD-2CF':        { sku: 'DD-2CF',        name: 'Dynamic Dressing',            unit: '2 cf bag', kind: 'bag' },
};

// "Must be older than X days" — lives on the BOM line in the real app.
// We only surface this implicitly via "required by" dates.
const AGING_DAYS = 10;

// Open sales orders driving demand
const SALES_ORDERS = [
  { id: 'SO-3041', customer: 'Verdant Garden Co.',     dueDate: 'May 3',  daysOut: 3,  value: '$8,420',  items: [
    { sku: 'BMB50-2CF', qty: 200 }, { sku: 'BMB-2CF', qty: 80 },
  ]},
  { id: 'SO-3038', customer: 'Highland Nursery',       dueDate: 'May 6',  daysOut: 6,  value: '$5,640',  items: [
    { sku: 'CFM-1YT', qty: 3 },
  ]},
  { id: 'SO-3036', customer: 'Mason & Field Supply',   dueDate: 'May 10', daysOut: 10, value: '$3,180',  items: [
    { sku: 'BMBRB-2CF', qty: 240 }, { sku: 'LWN-2CF', qty: 60 },
  ]},
  { id: 'SO-3033', customer: 'Riverbank Farm Co-op',   dueDate: 'May 14', daysOut: 14, value: '$4,210',  items: [
    { sku: 'BMB50-1CF', qty: 480 }, { sku: 'DD-2CF', qty: 40 },
  ]},
  { id: 'SO-3029', customer: 'Foothill Greenhouses',   dueDate: 'May 17', daysOut: 17, value: '$6,800',  items: [
    { sku: 'CFM-2CF', qty: 200 },
  ]},
  { id: 'SO-3024', customer: 'Twin Pines Landscape',   dueDate: 'May 21', daysOut: 21, value: '$2,940',  items: [
    { sku: 'BMB-1YT', qty: 6 }, { sku: 'BMBRB-3S-1YT', qty: 4 },
  ]},
];

// Computed production plan (the engine output the UI displays).
// Each work item knows what it serves and what must be ready first.
const WORK_ITEMS = [
  // Today — produce totes that need 10 days to age before downstream bag MOs
  { id: 'wo-01', kind: 'produce', sku: 'CFM-1YT',      qty: 18,  startBy: 'Apr 27', requiredBy: 'May 7',  daysOut: 0,
    serves: [{ id: 'SO-3038', sku: 'CFM-1YT', qty: 3 }, { id: 'SO-3029', sku: 'CFM-2CF', qty: 200 }],
    note: '',
    capacityFit: 'fits today', urgency: 'critical' },
  { id: 'wo-02', kind: 'produce', sku: 'BMB50-1YT',    qty: 24,  startBy: 'Apr 27', requiredBy: 'May 9',  daysOut: 0,
    serves: [{ id: 'SO-3033', sku: 'BMB50-1CF', qty: 480 }],
    note: '',
    capacityFit: 'fits today', urgency: 'critical' },

  // This week — bag runs that already have aged totes ready
  { id: 'wo-03', kind: 'produce', sku: 'BMB50-2CF',    qty: 200, startBy: 'May 1',  requiredBy: 'May 3',  daysOut: 4,
    serves: [{ id: 'SO-3041', sku: 'BMB50-2CF', qty: 200 }],
    note: 'Inputs in stock',
    capacityFit: 'fits Thursday', urgency: 'high' },
  { id: 'wo-04', kind: 'produce', sku: 'BMB-2CF',      qty: 80,  startBy: 'May 1',  requiredBy: 'May 3',  daysOut: 4,
    serves: [{ id: 'SO-3041', sku: 'BMB-2CF', qty: 80 }],
    note: 'Inputs in stock',
    capacityFit: 'fits Thursday', urgency: 'high' },
  { id: 'wo-05', kind: 'produce', sku: 'CFM-2CF',      qty: 200, startBy: 'May 13',  requiredBy: 'May 15',  daysOut: 16,
    serves: [{ id: 'SO-3029', sku: 'CFM-2CF', qty: 200 }],
    note: 'Inputs in stock',
    capacityFit: 'fits next week', urgency: 'normal' },

  // Next week
  { id: 'wo-06', kind: 'produce', sku: 'BMBRB-3S-1YT', qty: 40,  startBy: 'May 5',  requiredBy: 'May 8',  daysOut: 8,
    serves: [{ id: 'SO-3036', sku: 'BMBRB-2CF', qty: 240 }, { id: 'SO-3024', sku: 'BMBRB-3S-1YT', qty: 4 }],
    note: '',
    capacityFit: 'fits next Mon', urgency: 'high' },
  { id: 'wo-07', kind: 'produce', sku: 'BMBRB-2CF',    qty: 240, startBy: 'May 8',  requiredBy: 'May 10', daysOut: 11,
    serves: [{ id: 'SO-3036', sku: 'BMBRB-2CF', qty: 240 }],
    note: 'Waits on upstream MO',
    capacityFit: 'fits next Wed', urgency: 'normal',
    blocked: 'wo-06' },
  { id: 'wo-08', kind: 'produce', sku: 'LWN-2CF',      qty: 60,  startBy: 'May 8',  requiredBy: 'May 10', daysOut: 11,
    serves: [{ id: 'SO-3036', sku: 'LWN-2CF', qty: 60 }],
    note: 'No upstream MO required',
    capacityFit: 'fits next Wed', urgency: 'normal' },
  { id: 'wo-09', kind: 'produce', sku: 'BMB50-1CF',    qty: 480, startBy: 'May 12', requiredBy: 'May 14', daysOut: 15,
    serves: [{ id: 'SO-3033', sku: 'BMB50-1CF', qty: 480 }],
    note: 'Waits on upstream MO',
    capacityFit: 'fits next Thu', urgency: 'normal',
    blocked: 'wo-02' },

  // Later
  { id: 'wo-10', kind: 'produce', sku: 'DD-2CF',       qty: 40,  startBy: 'May 12', requiredBy: 'May 14', daysOut: 15,
    serves: [{ id: 'SO-3033', sku: 'DD-2CF', qty: 40 }],
    note: 'No upstream MO required',
    capacityFit: 'fits next Thu', urgency: 'normal' },
  { id: 'wo-11', kind: 'produce', sku: 'CFM-2CF',      qty: 200, startBy: 'May 15', requiredBy: 'May 17', daysOut: 18,
    serves: [{ id: 'SO-3029', sku: 'CFM-2CF', qty: 200 }],
    note: 'Pulls from upstream MO scheduled today',
    capacityFit: 'fits May 15', urgency: 'normal',
    blocked: 'wo-01' },
  { id: 'wo-12', kind: 'produce', sku: 'BMB-1YT',      qty: 6,   startBy: 'May 19', requiredBy: 'May 21', daysOut: 22,
    serves: [{ id: 'SO-3024', sku: 'BMB-1YT', qty: 6 }],
    note: 'Sold direct (no downstream MO)',
    capacityFit: 'fits May 19', urgency: 'normal' },
];

// Raw materials with reorder-point logic
const SUPPLIERS = {
  paonia:     { id: 'paonia',     name: 'Paonia Compost & Co.',  leadDays: 7  },
  cascade:    { id: 'cascade',    name: 'Cascade Mineral Supply', leadDays: 14 },
  pacific:    { id: 'pacific',    name: 'Pacific Coir Imports',   leadDays: 21 },
  meridian:   { id: 'meridian',   name: 'Meridian Aggregates',    leadDays: 5  },
  sunvalley:  { id: 'sunvalley',  name: 'Sun Valley Peat',        leadDays: 10 },
  brightside: { id: 'brightside', name: 'Brightside Packaging',   leadDays: 3  },
};

// Materials — reorder-point view
const MATERIALS = [
  { id: 'm1', name: 'Coco Coir',                sku: 'RAW-COIR',    unit: 'pallet', supplier: 'pacific',
    onHand: 8,  reorderAt: 12, reorderQty: 50, daysCover: 9,  burnPerDay: 0.9, status: 'order-now' },
  { id: 'm2', name: 'Forest Compost',           sku: 'RAW-FCMP',    unit: 'yd³',    supplier: 'paonia',
    onHand: 60, reorderAt: 80, reorderQty: 200, daysCover: 12, burnPerDay: 5,   status: 'order-now' },
  { id: 'm3', name: 'Worm Castings',            sku: 'RAW-WC',      unit: 'yd³',    supplier: 'paonia',
    onHand: 14, reorderAt: 20, reorderQty: 60,  daysCover: 7,  burnPerDay: 2,   status: 'order-now' },
  { id: 'm4', name: 'Volcanic Pumice, ½″',      sku: 'RAW-PUM-12',  unit: 'yd³',    supplier: 'cascade',
    onHand: 28, reorderAt: 30, reorderQty: 80,  daysCover: 18, burnPerDay: 1.5, status: 'order-soon' },
  { id: 'm5', name: 'Glacial Rock Dust',        sku: 'RAW-GRD',     unit: 'super sack', supplier: 'cascade',
    onHand: 12, reorderAt: 8,  reorderQty: 24,  daysCover: 28, burnPerDay: 0.4, status: 'ok' },
  { id: 'm6', name: 'Mason Sand',               sku: 'RAW-SND',     unit: 'yd³',    supplier: 'meridian',
    onHand: 22, reorderAt: 15, reorderQty: 40,  daysCover: 22, burnPerDay: 1.0, status: 'ok' },
  { id: 'm7', name: 'Sphagnum Peat Moss',       sku: 'RAW-PEAT',    unit: 'bale',   supplier: 'sunvalley',
    onHand: 110, reorderAt: 120, reorderQty: 400, daysCover: 14, burnPerDay: 8, status: 'order-soon' },
  { id: 'm8', name: 'Greensand',                sku: 'RAW-GS',      unit: 'super sack', supplier: 'cascade',
    onHand: 4, reorderAt: 6,  reorderQty: 20,  daysCover: 11, burnPerDay: 0.35, status: 'order-now' },
  { id: 'm9', name: 'Kraft Bag, 2cf',           sku: 'PKG-BAG-2CF', unit: 'bag',    supplier: 'brightside',
    onHand: 8400, reorderAt: 6000, reorderQty: 20000, daysCover: 26, burnPerDay: 320, status: 'ok' },
  { id: 'm10', name: '1 yd Tote, woven',        sku: 'PKG-TOTE-1YT', unit: 'tote',  supplier: 'brightside',
    onHand: 90, reorderAt: 120, reorderQty: 500, daysCover: 12, burnPerDay: 7.5, status: 'order-soon' },
  { id: 'm11', name: 'Branded Sticker Roll',    sku: 'PKG-STK',      unit: 'roll',  supplier: 'brightside',
    onHand: 18, reorderAt: 6,  reorderQty: 24,   daysCover: 36, burnPerDay: 0.5, status: 'ok' },
  { id: 'm12', name: 'Pelletized Lime',         sku: 'RAW-LIME',     unit: 'super sack', supplier: 'cascade',
    onHand: 9, reorderAt: 10, reorderQty: 30,   daysCover: 16, burnPerDay: 0.55, status: 'order-soon' },
];

window.PLAN_DATA = { PRODUCTS, SALES_ORDERS, WORK_ITEMS, MATERIALS, SUPPLIERS, AGING_DAYS };
