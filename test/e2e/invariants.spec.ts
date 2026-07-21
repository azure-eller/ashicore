// Stateful property-based test of the inventory quantity spine.
// One module, Hughes-style: model state, commands, invariant, property.
// The model shares nothing with the app; the real system is reached only
// through the public API; stored values are read back with raw SQL.
//
// THE SPEC — the authority for this file. The model answers to this text,
// never to the app's current behavior. The model must not silently bend to
// match the app: every disagreement is triaged, and either the app, the
// model, or the rule is corrected explicitly.
//
// Laws (checked as invariant sweeps after every command):
//   I1  an item's on-hand = its lots added up; each lot = its events added up
//   I2  an item's demand = the unfulfilled quantities of its open sales
//       orders, added up
//   I3  an item's expected = the unreceived quantities of its open purchase
//       orders, added up
//   I4  an item's ATP = floor-at-zero(on-hand + expected) − demand
//       (owner policy, not a timeless law — ATP definitions vary between
//       systems; this one is ours, per C1)
//
// Owner decisions (do not relitigate in code):
//   C1  incoming stock counts toward ATP
//   C2  going below zero stock is allowed, behind an explicit override
//   C3  receiving more than ordered is allowed
//   C4  full receipt closes a purchase order to further receiving;
//       over-receipt is legal only within the receipt that crosses the
//       remainder
//   C5  any purchase order may be deleted (K2). Deleting an order with
//       receipts REVERSES them: received stock leaves on-hand and the
//       remaining claim releases; the ledger keeps the receipt and its
//       reversal as history. (AMENDED — the original ruling made received
//       history permanent; the owner superseded it in the app (#760) and
//       ratified the amendment here. The reversal semantics are not yet
//       modeled: the old refusal command is parked, deletion of orders
//       WITH receipts is off the menus until a blind pass models it.)
//   C6  a confirmed over-receipt rewrites the document: ordered rises to
//       match received, and the order's value follows (Katana model — the
//       document reflects accepted reality; no "originally ordered" fact
//       survives on it, only in the event history)
//   K1  like Katana: a document that exists IS booked — creation books
//       demand/expected; no draft gate; no cancelled status
//   K2  like Katana: documents leave the world by deletion, which releases
//       their claims
//   K3  like Katana: fulfillment and receiving may be partial
//
// Open questions (each waits for the slice that makes it concrete):
//   Q1  does I4's "on-hand" mean physical stock or only available-
//       disposition stock? The readings agree until a command can create
//       blocked/rejected stock.
//
// THE PROTOCOL for model changes (state shape, preconditions, next-state,
// postconditions). Agents over-index on existing code; a model derived from
// the app only proves the app equals itself. Therefore:
//   1. Model semantics are authored BLIND: spawn a subagent whose prompt
//      contains THE SPEC above and forbids reading any app code (lib/, app/,
//      db schema). It answers from the spec and Katana MRP behavior only.
//   2. The connecting agent reads code only to wire the driver call
//      (test/helpers/ endpoint, field names, status codes) — never to adjust
//      what the model expects.
//   3. Every red is triaged by the owner: fix the app, fix the model, or
//      amend the rule — explicitly, never silently. MENU.parked with a
//      reason is the only accepted deferral.
//   4. The blind pass is an anti-bias proposal mechanism, not an authority.
//      Only the numbered laws and owner decisions are authoritative; when
//      they do not determine an edge case, the model author must surface an
//      open question rather than infer a rule from the application or an
//      analogous product.
//
// Growth rules: add one command at a time, running the property between
// additions. Generate only the fields the model tracks; pin the rest to
// constants until a slice adds an oracle for them.
//
// Observability: every run appends invariants-journal.jsonl and rewrites
// invariants-spec.json; the dev server renders both at /dev/invariants.
// Agents: after running this suite for the owner, open that URL in their
// browser (e.g. google-chrome-stable <url>).

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { Client } from "pg";
import { db as appDb } from "@/lib/db";
import { toRows } from "@/lib/db/query-result";
import {
  createCustomer,
  createItem,
  createPurchaseOrder,
  createSalesOrder,
  createSupplier,
  deletePurchaseOrder,
  fulfillSalesOrder,
  getBaseUrl,
  getOrgId,
  getUnitId,
  receivePurchaseOrder,
} from "../helpers/api";

// ---------------------------------------------------------------------------
// Model state (the state record + initial_state)
// ---------------------------------------------------------------------------

// Primary facts ONLY — documents and what happened to them. Every aggregate
// (on-hand, demand, expected, ATP) is derived through the laws, never
// stored: a model holding both causes and summaries can drift internally
// inconsistent. Map keys and lineId are opaque driver handles, not
// semantics. received/fulfilled are cumulative event sums (recording totals
// instead of individual receipts is a granularity choice, not semantics).
type ModelItem = { openingStock: number };
// An order present in its map exists and is booked (K1); it leaves only by
// deletion (K2). Openness is DERIVED, never stored: open to receiving =
// received < ordered (C4); open to fulfillment = fulfilled < ordered (the
// K3 cap keeps fulfilled ≤ ordered).
type ModelPurchaseOrder = {
  itemId: string;
  lineId: string;
  ordered: number;
  received: number;
};
type ModelSalesOrder = {
  itemId: string;
  lineId: string;
  ordered: number;
  fulfilled: number;
};

type Model = {
  items: Map<string, ModelItem>;
  purchaseOrders: Map<string, ModelPurchaseOrder>;
  salesOrders: Map<string, ModelSalesOrder>;
};

function initialModel(): Model {
  return {
    items: new Map(),
    purchaseOrders: new Map(),
    salesOrders: new Map(),
  };
}

type ItemQuantities = { onHand: number; demand: number; expected: number };

// The laws as derivations (blind-derived). I1: every stock event sums in
// full — no flooring anywhere (C2). I2/I3: unfulfilled/unreceived remainders
// of OPEN orders. Under C6 received never ends above ordered — the crossing
// receipt raises ordered to match — so a closed order's remainder is exactly
// zero. I4's floor wraps the supply term only; ATP itself may go negative.
function derive(model: Model, itemId: string): ItemQuantities {
  const pos = [...model.purchaseOrders.values()].filter(
    (po) => po.itemId === itemId
  );
  const sos = [...model.salesOrders.values()].filter(
    (so) => so.itemId === itemId
  );
  return {
    onHand:
      model.items.get(itemId)!.openingStock +
      pos.reduce((sum, po) => sum + po.received, 0) -
      sos.reduce((sum, so) => sum + so.fulfilled, 0),
    demand: sos
      .filter((so) => so.fulfilled < so.ordered)
      .reduce((sum, so) => sum + (so.ordered - so.fulfilled), 0),
    expected: pos
      .filter((po) => po.received < po.ordered)
      .reduce((sum, po) => sum + (po.ordered - po.received), 0),
  };
}

// The handle commands receive for the real system: scoping for raw reads
// plus pinned entities the model does not track.
type Real = { orgId: string; supplierId: string; customerId: string };

// THE SPEC and model shape as data for the overview page — keep in lockstep
// with the header text and the types above.
const SPEC = {
  laws: [
    { id: "I1", text: "an item's on-hand = its lots added up; each lot = its events added up" },
    { id: "I2", text: "an item's demand = the unfulfilled quantities of its open sales orders, added up" },
    { id: "I3", text: "an item's expected = the unreceived quantities of its open purchase orders, added up" },
    { id: "I4", text: "an item's ATP = floor-at-zero(on-hand + expected) − demand", kind: "owner policy — ATP definitions vary between systems; this one is ours (C1)" },
  ],
  decisions: [
    { id: "C1", text: "incoming stock counts toward ATP" },
    { id: "C2", text: "going below zero stock is allowed, behind an explicit override" },
    { id: "C3", text: "receiving more than ordered is allowed" },
    { id: "C4", text: "full receipt closes a purchase order to further receiving; over-receipt is legal only within the receipt that crosses the remainder" },
    { id: "C5", text: "any purchase order may be deleted (K2); deleting an order with receipts reverses them — received stock leaves on-hand, the remaining claim releases, and the ledger keeps receipt + reversal as history. AMENDED: the original ruling made received history permanent; the owner superseded it in the app (#760) and ratified the amendment. Reversal semantics not yet modeled — the old refusal command is parked until a blind pass models them." },
    { id: "C6", text: "a confirmed over-receipt rewrites the document: ordered rises to match received, and the order's value follows (Katana model — the document reflects accepted reality; no 'originally ordered' fact survives on it, only in the event history)" },
    { id: "K1", text: "like Katana: a document that exists IS booked — creation books demand/expected; no draft gate; no cancelled status" },
    { id: "K2", text: "like Katana: documents leave the world by deletion, which releases their claims" },
    { id: "K3", text: "like Katana: fulfillment and receiving may be partial" },
  ],
  open: [
    { id: "Q1", text: "does I4's 'on-hand' mean physical stock or only available-disposition stock? The readings agree until a command can create blocked/rejected stock." },
  ],
  protocol: [
    "Model semantics are authored blind: by a subagent that gets THE SPEC and may not read any app code.",
    "Connecting agents read code only to wire driver calls — never to adjust what the model expects.",
    "Every red is triaged by the owner: fix the app, fix the model, or amend the rule — explicitly, never silently. MENU.parked with a reason is the only deferral.",
    "The blind pass is an anti-bias proposal mechanism, not an authority. Only the numbered laws and owner decisions are authoritative; when they do not determine an edge case, the model author surfaces an open question rather than inferring a rule from the application or an analogous product.",
  ],
};

const MODEL_DEF = {
  convention:
    "The model stores only primary facts — documents and what happened to them. Every aggregate is derived through the laws, never stored, so the model cannot drift internally inconsistent. An order present in its map exists and is booked (K1); it leaves only by deletion (K2); openness is derived from its quantities.",
  entities: [
    {
      name: "ModelItem",
      keyedBy: "item id",
      fields: [
        { name: "openingStock", meaning: "the creation fact — stock the item was born with" },
      ],
      derived: [
        { name: "onHand", meaning: "openingStock + all receipts − all fulfillments (I1) — may go negative (C2), never floored" },
        { name: "demand", meaning: "unfulfilled remainders of its open sales orders (I2)" },
        { name: "expected", meaning: "unreceived remainders of its open purchase orders (I3) — a closed order contributes zero (C6 keeps received from ending above ordered); over-receipt excess lives in onHand" },
        { name: "ATP", meaning: "floor-at-zero(onHand + expected) − demand (I4) — the floor wraps the supply term only; ATP itself may go negative" },
      ],
    },
    {
      name: "ModelSalesOrder",
      keyedBy: "sales order id",
      fields: [
        { name: "itemId", meaning: "the item this order claims" },
        { name: "lineId", meaning: "opaque driver handle (not semantics)" },
        { name: "ordered", meaning: "quantity promised to the customer" },
        { name: "fulfilled", meaning: "cumulative fulfillment events — the K3 cap keeps this ≤ ordered; open = fulfilled < ordered" },
      ],
      derived: [],
    },
    {
      name: "ModelPurchaseOrder",
      keyedBy: "purchase order id",
      fields: [
        { name: "itemId", meaning: "the item this order supplies" },
        { name: "lineId", meaning: "opaque driver handle (not semantics)" },
        { name: "ordered", meaning: "the document's live ordered quantity — a confirmed over-receipt raises it to match received (C6); the original request survives only in history" },
        { name: "received", meaning: "cumulative receipt events — the crossing receipt may overshoot (C3) but ordered rises with it (C6); open to receiving = received < ordered (C4)" },
      ],
      derived: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Raw reads (for postconditions): no app helpers, straight SQL
// ---------------------------------------------------------------------------

async function storedQuantities(
  orgId: string,
  itemId: string
): Promise<ItemQuantities & { atp: number }> {
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return tx.execute(sql`
      SELECT
        COALESCE(SUM(on_hand_qty), 0) AS on_hand,
        COALESCE(SUM(demand_qty), 0) AS demand,
        COALESCE(SUM(expected_qty), 0) AS expected,
        COALESCE(SUM(available_to_promise), 0) AS atp
      FROM inventory.inventory_item_balances
      WHERE organization_id = ${orgId} AND item_id = ${itemId}
    `);
  });
  const [row] = toRows<{
    on_hand: string;
    demand: string;
    expected: string;
    atp: string;
  }>(result);
  return {
    onHand: Number(row?.on_hand ?? 0),
    demand: Number(row?.demand ?? 0),
    expected: Number(row?.expected ?? 0),
    atp: Number(row?.atp ?? 0),
  };
}

async function storedPoExists(
  orgId: string,
  purchaseOrderId: string
): Promise<boolean> {
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return tx.execute(sql`
      SELECT 1 FROM purchasing.purchase_orders
      WHERE id = ${purchaseOrderId} AND deleted_at IS NULL
    `);
  });
  return toRows(result).length > 0;
}

// Deep no-mutation reads for rejection commands. A refusal must leave no
// trace: the whole order document (header + every line, every column) and
// the whole event ledger are compared as snapshots — a count-only check
// would miss an event modified or replaced in place.
async function storedPoSnapshot(
  orgId: string,
  purchaseOrderId: string
): Promise<string> {
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return tx.execute(sql`
      SELECT COALESCE((SELECT to_jsonb(po) FROM purchasing.purchase_orders po
                       WHERE po.id = ${purchaseOrderId}), 'null'::jsonb)::text
             || COALESCE((SELECT jsonb_agg(to_jsonb(pol) ORDER BY pol.id)
                          FROM purchasing.purchase_order_lines pol
                          WHERE pol.purchase_order_id = ${purchaseOrderId}),
                         'null'::jsonb)::text AS snapshot
    `);
  });
  const [row] = toRows<{ snapshot: string }>(result);
  return row?.snapshot ?? "";
}

async function storedLedgerDigest(orgId: string): Promise<string> {
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    // to_jsonb(ev) hashes EVERY column — identity, disposition, costs,
    // references, timestamps — so "the whole ledger" means exactly that.
    return tx.execute(sql`
      SELECT COUNT(*)::text || ':'
             || COALESCE(md5(string_agg(to_jsonb(ev)::text, ',' ORDER BY ev.id)),
                         '') AS digest
      FROM inventory.inventory_events ev
      WHERE ev.organization_id = ${orgId}
    `);
  });
  const [row] = toRows<{ digest: string }>(result);
  return row?.digest ?? "";
}

// Per-step model-vs-real ledger, recorded before asserting so a red run can
// show the whole story, not just the last diff.
type LedgerStep = {
  cmd: string;
  item: string;
  oh: [number, number]; // [model, real]
  dm: [number, number];
  ex: [number, number];
  atp: [number, number];
  bad: string[];
};
const trace: LedgerStep[] = [];
let failureTrace: LedgerStep[] = [];

function recordStep(
  cmd: string,
  itemId: string,
  m: ItemQuantities,
  r: ItemQuantities,
  realAtp: number
) {
  const modelAtp = Math.max(0, m.onHand + m.expected) - m.demand;
  const step: LedgerStep = {
    cmd,
    item: itemId.slice(0, 8),
    oh: [m.onHand, r.onHand],
    dm: [m.demand, r.demand],
    ex: [m.expected, r.expected],
    atp: [modelAtp, realAtp],
    bad: [],
  };
  for (const key of ["oh", "dm", "ex", "atp"] as const) {
    if (step[key][0] !== step[key][1]) step.bad.push(key);
  }
  trace.push(step);
  // I4: the floor applies to supply before demand; ATP may go negative
  expect(realAtp, `${cmd} ATP formula (item ${itemId})`).toBe(modelAtp);
}

async function storedLine(orgId: string, salesOrderId: string) {
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return tx.execute(sql`
      SELECT id, shipped_quantity FROM sales.sales_order_lines
      WHERE sales_order_id = ${salesOrderId}
      LIMIT 1
    `);
  });
  const [row] = toRows<{ id: string; shipped_quantity: string }>(result);
  return { lineId: row?.id ?? "", shipped: Number(row?.shipped_quantity ?? 0) };
}

async function storedPoLine(orgId: string, purchaseOrderId: string) {
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return tx.execute(sql`
      SELECT id, quantity_ordered, quantity_received
      FROM purchasing.purchase_order_lines
      WHERE purchase_order_id = ${purchaseOrderId}
      LIMIT 1
    `);
  });
  const [row] = toRows<{
    id: string;
    quantity_ordered: string;
    quantity_received: string;
  }>(result);
  return {
    lineId: row?.id ?? "",
    ordered: Number(row?.quantity_ordered ?? 0),
    received: Number(row?.quantity_received ?? 0),
  };
}

// Reset the org to the model's empty initial world. Runs before every
// sequence: leftover state from earlier attempts would poison shrinking and
// make seed replay start from a different database. Needs the owner
// connection — app_user has no DELETE on the events ledger. Children before
// parents; a table a future command writes to but is missing here fails
// loudly (FK blocks the items delete) instead of leaking state.
async function wipeOrg(orgId: string): Promise<void> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of [
      "DELETE FROM inventory.inventory_idempotency_claims WHERE organization_id = $1",
      "DELETE FROM inventory.inventory_lot_balances WHERE organization_id = $1",
      "DELETE FROM inventory.inventory_events WHERE organization_id = $1",
      "DELETE FROM inventory.inventory_demands_summary WHERE organization_id = $1",
      "DELETE FROM inventory.inventory_expected_summary WHERE organization_id = $1",
      "DELETE FROM inventory.inventory_item_balances WHERE organization_id = $1",
      `DELETE FROM sales.sales_order_lines WHERE sales_order_id IN
        (SELECT id FROM sales.sales_orders WHERE organization_id = $1)`,
      "DELETE FROM system.billing_usage_events WHERE organization_id = $1",
      "DELETE FROM sales.sales_orders WHERE organization_id = $1",
      `DELETE FROM purchasing.purchase_order_lines WHERE purchase_order_id IN
        (SELECT id FROM purchasing.purchase_orders WHERE organization_id = $1)`,
      "DELETE FROM purchasing.purchase_orders WHERE organization_id = $1",
      "DELETE FROM inventory.lots WHERE organization_id = $1",
      "DELETE FROM inventory.items WHERE organization_id = $1",
    ]) {
      await client.query(statement, [orgId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// The invariant: org-wide checks that must hold after every command.
// Liveness clauses (summary rows trace to live documents) land with the
// delete commands.
// ---------------------------------------------------------------------------

// kind distinguishes the different truths a sweep checks: "reconciliation"
// = the app's storage layers agree with each other (checks OUR architecture);
// "source truth" = projections trace to live business documents (the ERP
// law); "policy" = an owner-defined formula. Business conservation itself is
// checked by the model postconditions (derived facts vs stored).
const SWEEP_DEFS = [
  {
    name: "I1 on-hand = sum of its lots",
    predicate: "item_balances.on_hand_qty = Σ lot_balances.quantity",
    kind: "reconciliation",
  },
  {
    name: "I1 lot = fold of its events",
    predicate: "Σ lot_balances per lot = signed fold of inventory_events",
    kind: "reconciliation",
  },
  {
    name: "I2 demand = sum of open demand",
    predicate: "item_balances.demand_qty = Σ demands_summary.quantity",
    kind: "reconciliation",
  },
  {
    name: "I3 expected = sum of open supply",
    predicate: "item_balances.expected_qty = Σ expected_summary.quantity",
    kind: "reconciliation",
  },
  {
    name: "I4 ATP = its formula",
    predicate: "available_to_promise = GREATEST(0, available + expected) − demand",
    kind: "policy",
  },
  {
    name: "I3 liveness: every open line contributes exactly once",
    predicate:
      "each live open line owns EXACTLY ONE expected row, on the right item, equal to its stock-unit remainder; closed lines and deleted orders own zero rows. Single-location slice: strict cardinality also rules out rows duplicated across locations — no location fact exists on the order to trace against yet",
    kind: "source truth",
    faultEvidence:
      "test/e2e/invariants-i3-fault-validation.md — 7/7 seeded faults killed by test/e2e/validate-i3-liveness.sh",
  },
];

// One transaction, one UNION ALL — the invariant runs after every command,
// so round trips dominate its cost. Each branch returns only violating rows;
// the invariant holds when the union is empty.
async function invariant(real: Real): Promise<void> {
  const org = real.orgId;
  const result = await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${org}, true)`);
    return tx.execute(sql`
      -- I1 on_hand_qty = SUM of lot quantities (all dispositions)
      (SELECT ${SWEEP_DEFS[0].name}::text AS sweep,
              COALESCE(b.item_id, l.item_id)::text AS entity_id,
              COALESCE(b.on_hand_qty, 0)::text AS stored,
              COALESCE(l.total, 0)::text AS recomputed
       FROM (SELECT * FROM inventory.inventory_item_balances
             WHERE organization_id = ${org}) b
       FULL JOIN (SELECT organization_id, location_id, item_id, SUM(quantity) AS total
                  FROM inventory.inventory_lot_balances
                  WHERE organization_id = ${org}
                  GROUP BY 1, 2, 3) l
         ON l.location_id = b.location_id AND l.item_id = b.item_id
       WHERE COALESCE(b.on_hand_qty, 0) <> COALESCE(l.total, 0)
       LIMIT 5)

      UNION ALL

      -- I1 (deeper) each lot = the fold of its inventory_events; direction is
      -- encoded here from first principles, independent of the kernel
      (SELECT ${SWEEP_DEFS[1].name}::text,
              COALESCE(lb.lot_id, ev.lot_id)::text,
              COALESCE(lb.total, 0)::text,
              COALESCE(ev.folded, 0)::text
       FROM (SELECT lot_id, SUM(quantity) AS total
             FROM inventory.inventory_lot_balances
             WHERE organization_id = ${org}
             GROUP BY 1) lb
       FULL JOIN (SELECT lot_id, SUM(CASE
                WHEN event_type IN ('opening_balance','purchase_receipt',
                  'manufacturing_output','manual_adjustment_increase',
                  'stocktake_gain','manufacturing_variance_gain','unpick_restock',
                  'transfer_in') THEN quantity
                WHEN event_type IN ('manual_adjustment_decrease','stocktake_loss',
                  'sales_consumption','manufacturing_ingredient_consumption',
                  'manufacturing_variance_loss','quality_scrap','transfer_out')
                  THEN -quantity
                ELSE 0 END) AS folded
             FROM inventory.inventory_events
             WHERE organization_id = ${org} AND lot_id IS NOT NULL
             GROUP BY 1) ev
         ON ev.lot_id = lb.lot_id
       WHERE COALESCE(lb.total, 0) <> COALESCE(ev.folded, 0)
       LIMIT 5)

      UNION ALL

      -- I2 demand_qty = SUM of demand summary rows
      (SELECT ${SWEEP_DEFS[2].name}::text,
              COALESCE(b.item_id, d.item_id)::text,
              COALESCE(b.demand_qty, 0)::text,
              COALESCE(d.total, 0)::text
       FROM (SELECT * FROM inventory.inventory_item_balances
             WHERE organization_id = ${org}) b
       FULL JOIN (SELECT organization_id, location_id, item_id, SUM(quantity) AS total
                  FROM inventory.inventory_demands_summary
                  WHERE organization_id = ${org}
                  GROUP BY 1, 2, 3) d
         ON d.location_id = b.location_id AND d.item_id = b.item_id
       WHERE COALESCE(b.demand_qty, 0) <> COALESCE(d.total, 0)
       LIMIT 5)

      UNION ALL

      -- I3 expected_qty = SUM of expected summary rows
      (SELECT ${SWEEP_DEFS[3].name}::text,
              COALESCE(b.item_id, e.item_id)::text,
              COALESCE(b.expected_qty, 0)::text,
              COALESCE(e.total, 0)::text
       FROM (SELECT * FROM inventory.inventory_item_balances
             WHERE organization_id = ${org}) b
       FULL JOIN (SELECT organization_id, location_id, item_id, SUM(quantity) AS total
                  FROM inventory.inventory_expected_summary
                  WHERE organization_id = ${org}
                  GROUP BY 1, 2, 3) e
         ON e.location_id = b.location_id AND e.item_id = b.item_id
       WHERE COALESCE(b.expected_qty, 0) <> COALESCE(e.total, 0)
       LIMIT 5)

      UNION ALL

      -- I4 available_to_promise = GREATEST(0, net available + expected) - demand
      (SELECT ${SWEEP_DEFS[4].name}::text,
              b.item_id::text,
              b.available_to_promise::text,
              (GREATEST(0, COALESCE(a.net, 0) + b.expected_qty) - b.demand_qty)::text
       FROM inventory.inventory_item_balances b
       LEFT JOIN (SELECT organization_id, location_id, item_id, SUM(quantity) AS net
                  FROM inventory.inventory_lot_balances
                  WHERE organization_id = ${org} AND disposition = 'available'
                  GROUP BY 1, 2, 3) a
         ON a.location_id = b.location_id AND a.item_id = b.item_id
       WHERE b.organization_id = ${org}
         AND b.available_to_promise
           <> GREATEST(0, COALESCE(a.net, 0) + b.expected_qty) - b.demand_qty
       LIMIT 5)

      UNION ALL

      -- I3 liveness: each live open line owns exactly one expected row, on
      -- the right item, equal to its stock-unit remainder; closed lines and
      -- deleted orders own zero rows. Both sides render to one descriptor
      -- string — quantity, cardinality, item — and the row violates when
      -- the descriptors differ. A summed comparison would let two wrong
      -- rows that add up right, or a row on the wrong item, pass.
      (SELECT * FROM (
        SELECT ${SWEEP_DEFS[5].name}::text AS sweep,
               COALESCE(es.reference_id, src.line_id)::text AS entity_id,
               CASE WHEN es.reference_id IS NULL THEN 'no rows'
                    ELSE format('qty=%s rows=%s item=%s',
                                es.qty::numeric(18,4), es.n, es.item_id)
               END AS stored,
               CASE WHEN src.line_id IS NULL THEN 'no live line'
                    WHEN src.remainder = 0 THEN 'no rows'
                    ELSE format('qty=%s rows=%s item=%s',
                                src.remainder::numeric(18,4), 1, src.item_id)
               END AS recomputed
        FROM (SELECT reference_id, COUNT(*) AS n, SUM(quantity) AS qty,
                     MIN(item_id::text) AS item_id
              FROM inventory.inventory_expected_summary
              WHERE organization_id = ${org}
                AND reference_type = 'purchase_order_line'
              GROUP BY 1) es
        FULL JOIN (SELECT pol.id AS line_id, pol.item_id::text AS item_id,
                          GREATEST(0, pol.stock_quantity_ordered
                                      - pol.stock_quantity_received) AS remainder
                   FROM purchasing.purchase_order_lines pol
                   JOIN purchasing.purchase_orders po
                     ON po.id = pol.purchase_order_id
                   WHERE po.organization_id = ${org}
                     AND po.deleted_at IS NULL) src
          ON src.line_id = es.reference_id
      ) live WHERE live.stored <> live.recomputed
      LIMIT 5)
    `);
  });
  const rows = toRows<Record<string, unknown>>(result);
  expect(rows, "invariant violated").toEqual([]);
}

// executed vs drawn (generator proposals before preconditions filter them):
// the gap between the two IS the filter.
const commandTally = new Map<string, number>();
const drawnTally = new Map<string, number>();

// Hughes' classify: the situations a run must visit for green to mean
// something. Mutation situations are counted generically from model diffs
// after every command — commands stay classification-free. Each property
// declares which situations are binding floors; the rest stay display-only.
const SITUATIONS = [
  "partial receipt",
  "purchase order completed exactly",
  "over-receipt",
  "partial fulfillment",
  "completed sales order",
  "negative stock",
  "supply and demand overlap",
  "multiple open orders on one item",
  "ATP crossed zero",
] as const;
const situationTally = new Map<string, number>();
const hitSituation = (name: (typeof SITUATIONS)[number]) =>
  situationTally.set(name, (situationTally.get(name) ?? 0) + 1);

function atpOf(model: Model, itemId: string): number {
  const q = derive(model, itemId);
  return Math.max(0, q.onHand + q.expected) - q.demand;
}

function classifySituations(
  model: Model,
  poBefore: Map<string, { received: number; ordered: number }>,
  soBefore: Map<string, number>,
  atpBefore: Map<string, number>
) {
  const hit = hitSituation;
  for (const [id, po] of model.purchaseOrders) {
    const before = poBefore.get(id) ?? { received: po.received, ordered: po.ordered };
    if (po.received > before.received) {
      if (po.received < po.ordered) hit("partial receipt");
      // C6: the crossing receipt raises ordered to received, so afterwards
      // the two are equal either way; the ordered rise IS the over-receipt
      else if (po.ordered > before.ordered) hit("over-receipt");
      else hit("purchase order completed exactly");
    }
  }
  for (const [id, so] of model.salesOrders) {
    if (so.fulfilled > (soBefore.get(id) ?? so.fulfilled)) {
      if (so.fulfilled < so.ordered) hit("partial fulfillment");
      else hit("completed sales order");
    }
  }
  for (const itemId of model.items.keys()) {
    const q = derive(model, itemId);
    if (q.onHand < 0) {
      hit("negative stock");
      break;
    }
  }
  for (const itemId of model.items.keys()) {
    const q = derive(model, itemId);
    if (q.expected > 0 && q.demand > 0) {
      hit("supply and demand overlap");
      break;
    }
  }
  const openPerItem = new Map<string, number>();
  for (const po of model.purchaseOrders.values())
    if (po.received < po.ordered)
      openPerItem.set(po.itemId, (openPerItem.get(po.itemId) ?? 0) + 1);
  for (const so of model.salesOrders.values())
    if (so.fulfilled < so.ordered)
      openPerItem.set(so.itemId, (openPerItem.get(so.itemId) ?? 0) + 1);
  if ([...openPerItem.values()].some((n) => n >= 2))
    hit("multiple open orders on one item");
  for (const [itemId, before] of atpBefore) {
    const after = atpOf(model, itemId);
    if ((before > 0 && after <= 0) || (before <= 0 && after > 0)) {
      hit("ATP crossed zero");
      break;
    }
  }
}

// fast-check has no invariant hook, so every command on the menu is wrapped:
// tally, run, sweep. A command cannot join the menu without either.
class WithInvariant implements fc.AsyncCommand<Model, Real> {
  constructor(readonly inner: fc.AsyncCommand<Model, Real>) {}

  check(model: Readonly<Model>): boolean {
    return this.inner.check(model);
  }

  async run(model: Model, real: Real): Promise<void> {
    if (VERBOSE) console.log(`    ${String(this.inner)}`);
    const name = this.inner.toString().split("(")[0];
    commandTally.set(name, (commandTally.get(name) ?? 0) + 1);
    const poBefore = new Map(
      [...model.purchaseOrders].map(([id, po]) => [
        id,
        { received: po.received, ordered: po.ordered },
      ])
    );
    const soBefore = new Map(
      [...model.salesOrders].map(([id, so]) => [id, so.fulfilled])
    );
    const atpBefore = new Map(
      [...model.items.keys()].map((id) => [id, atpOf(model, id)])
    );
    await this.inner.run(model, real);
    classifySituations(model, poBefore, soBefore, atpBefore);
    await invariant(real);
  }

  toString(): string {
    return this.inner.toString();
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

class CreateItemCommand implements fc.AsyncCommand<Model, Real> {
  constructor(readonly stock: number) {}

  check(): boolean {
    return true;
  }

  async run(model: Model, real: Real): Promise<void> {
    const suffix = randomUUID().slice(0, 8);
    const res = await createItem({
      name: `Inv ${suffix}`,
      itemType: "material",
      unitDefinitionId: getUnitId(),
      sku: `INV-${suffix}`,
      category: "Invariants",
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      // pinned: every item may be bought and sold; the model tracks neither
      sellable: true,
      stock: String(this.stock),
      safetyStock: "0",
      bom: [],
    });
    expect(res.status, `${this} rejected`).toBe(201);
    const itemId = (res.body as { id: string }).id;

    model.items.set(itemId, { openingStock: this.stock });

    // postcondition: stored quantities equal the derived model
    const item = derive(model, itemId);
    const { atp, ...stored } = await storedQuantities(real.orgId, itemId);
    recordStep(String(this), itemId, item, stored, atp);
    expect(stored, `${this} postcondition (item ${itemId})`).toEqual(item);
  }

  toString(): string {
    return `createItem(stock=${this.stock})`;
  }
}

class CreatePurchaseOrderCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly itemIndex: number,
    readonly quantity: number
  ) {}

  check(model: Readonly<Model>): boolean {
    return model.items.size > 0;
  }

  async run(model: Model, real: Real): Promise<void> {
    const itemIds = [...model.items.keys()];
    const itemId = itemIds[this.itemIndex % itemIds.length];

    const res = await createPurchaseOrder({
      supplierId: real.supplierId,
      lines: [
        { itemId, quantityOrdered: String(this.quantity), unitCost: "2.00" },
      ],
    });
    expect(res.status, `${this} rejected`).toBe(201);
    const poId = (res.body as { id: string }).id;

    // a purchase order that exists IS booked supply (K1) — booking is
    // derivation, not a write
    const { lineId, ordered } = await storedPoLine(real.orgId, poId);
    expect(ordered, `${this} document ordered quantity (order ${poId})`).toBe(
      this.quantity
    );
    model.purchaseOrders.set(poId, {
      itemId,
      lineId,
      ordered: this.quantity,
      received: 0,
    });

    // postcondition: stored quantities equal the derived model
    const item = derive(model, itemId);
    const { atp, ...stored } = await storedQuantities(real.orgId, itemId);
    recordStep(String(this), itemId, item, stored, atp);
    expect(stored, `${this} postcondition (item ${itemId})`).toEqual(item);
  }

  toString(): string {
    return `createPurchaseOrder(item#${this.itemIndex}, qty=${this.quantity})`;
  }
}

// Blind-derived from THE SPEC: legal targets are orders still open to
// receiving — received < ordered (C4). The quantity is NOT capped: the
// crossing receipt may overshoot (C3), and afterwards the order is closed
// with ordered rewritten up to received (C6). C4 is not a special case —
// it is the precondition evaluated before the append. The order stays in
// the map (K2).
type ReceiveMode = "some" | "under" | "exact" | "over";

class ReceivePurchaseOrderCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly orderIndex: number,
    readonly mode: ReceiveMode,
    readonly amount: number
  ) {}

  check(model: Readonly<Model>): boolean {
    return [...model.purchaseOrders.values()].some(
      (po) => po.ordered - po.received > 0
    );
  }

  async run(model: Model, real: Real): Promise<void> {
    const open = [...model.purchaseOrders.entries()].filter(
      ([, po]) => po.ordered - po.received > 0
    );
    const [poId, po] = open[this.orderIndex % open.length];

    // Deliberate boundary targeting (generator tuning, not legality — any
    // q > 0 is legal): random draws rarely land ON the remainder, and the
    // interesting transitions live at and past it.
    const remaining = po.ordered - po.received;
    const quantity =
      this.mode === "under"
        ? Math.max(1, remaining - this.amount)
        : this.mode === "exact"
          ? remaining
          : this.mode === "over"
            ? remaining + this.amount
            : this.amount;

    const res = await receivePurchaseOrder(poId, {
      confirmOverReceipt: true, // C3 override, pinned on
      lines: [{ lineId: po.lineId, quantityReceived: String(quantity) }],
    });
    expect(res.status, `${this} rejected`).toBe(200);

    po.received += quantity;
    // C6: the crossing receipt rewrites the document — ordered rises to
    // match received. Every aggregate agrees with and without this line
    // (a closed order's remainder is zero either way); only the document
    // read-back below can tell the difference.
    if (po.received > po.ordered) po.ordered = po.received;

    // postcondition: stored = derived model, and the document itself —
    // ordered and received — matches the model's primary facts
    const item = derive(model, po.itemId);
    const { atp, ...stored } = await storedQuantities(real.orgId, po.itemId);
    recordStep(String(this), po.itemId, item, stored, atp);
    expect(stored, `${this} postcondition (item ${po.itemId})`).toEqual(item);
    const line = await storedPoLine(real.orgId, poId);
    expect(line.received, `${this} received counter (order ${poId})`).toBe(
      po.received
    );
    expect(line.ordered, `${this} document ordered quantity (order ${poId})`).toBe(
      po.ordered
    );
  }

  toString(): string {
    return `receivePurchaseOrder(order#${this.orderIndex}, ${this.mode}, amt=${this.amount})`;
  }
}

// Blind-derived: C4 fully determines this — a receipt against a closed
// order (received ≥ ordered) is refused, any quantity, no override path.
// Rejection command: the postcondition is the app's EXPLICIT domain refusal
// (a crash or auth failure is not a refusal) and nothing observable changed
// — quantities, the whole order document, the whole event ledger.
class ReceiveClosedPurchaseOrderCommand
  implements fc.AsyncCommand<Model, Real>
{
  constructor(
    readonly orderIndex: number,
    readonly quantity: number
  ) {}

  check(model: Readonly<Model>): boolean {
    return [...model.purchaseOrders.values()].some(
      (po) => po.received >= po.ordered
    );
  }

  async run(model: Model, real: Real): Promise<void> {
    const closed = [...model.purchaseOrders.entries()].filter(
      ([, po]) => po.received >= po.ordered
    );
    const [poId, po] = closed[this.orderIndex % closed.length];

    const before = await storedQuantities(real.orgId, po.itemId);
    const docBefore = await storedPoSnapshot(real.orgId, poId);
    const ledgerBefore = await storedLedgerDigest(real.orgId);

    const res = await receivePurchaseOrder(poId, {
      confirmOverReceipt: true,
      lines: [{ lineId: po.lineId, quantityReceived: String(this.quantity) }],
    });
    expect(res.status, `${this} refusal status`).toBe(400);
    expect(
      (res.body as { error?: string }).error ?? "",
      `${this} refusal reason`
    ).toContain("purchase orders can be received");

    // postcondition: refused AND nothing observable changed
    const after = await storedQuantities(real.orgId, po.itemId);
    expect(after, `${this} mutated item quantities`).toEqual(before);
    expect(
      await storedPoSnapshot(real.orgId, poId),
      `${this} mutated the order document (order ${poId})`
    ).toBe(docBefore);
    expect(
      await storedLedgerDigest(real.orgId),
      `${this} changed the event ledger`
    ).toBe(ledgerBefore);
    const { atp, ...stored } = after;
    recordStep(String(this), po.itemId, derive(model, po.itemId), stored, atp);
  }

  toString(): string {
    return `receiveClosedPurchaseOrder(order#${this.orderIndex}, qty=${this.quantity})`;
  }
}

// Blind-derived: deletes a pristine order — no receipts. Under amended C5
// any order may be deleted, but this command generates only the no-receipt
// subset, where deletion is a pure map-delete (K2): expected sheds the full
// ordered quantity through derivation, nothing else moves. Deletion WITH
// receipts has reversal semantics and waits for its own blind-authored
// command (see MENU.next).
class DeletePurchaseOrderCommand implements fc.AsyncCommand<Model, Real> {
  constructor(readonly orderIndex: number) {}

  check(model: Readonly<Model>): boolean {
    return [...model.purchaseOrders.values()].some((po) => po.received === 0);
  }

  async run(model: Model, real: Real): Promise<void> {
    const pristine = [...model.purchaseOrders.entries()].filter(
      ([, po]) => po.received === 0
    );
    const [poId, po] = pristine[this.orderIndex % pristine.length];

    const res = await deletePurchaseOrder(poId);
    expect(res.status, `${this} rejected`).toBe(200);

    model.purchaseOrders.delete(poId);

    // postcondition: the document left the world; stored = derived model
    expect(
      await storedPoExists(real.orgId, poId),
      `${this} order still present (order ${poId})`
    ).toBe(false);
    const item = derive(model, po.itemId);
    const { atp, ...stored } = await storedQuantities(real.orgId, po.itemId);
    recordStep(String(this), po.itemId, item, stored, atp);
    expect(stored, `${this} postcondition (item ${po.itemId})`).toEqual(item);
  }

  toString(): string {
    return `deletePurchaseOrder(order#${this.orderIndex})`;
  }
}

// PARKED (see MENU.parked): this command models the ORIGINAL C5 — refusal
// of any deletion with receipt history. The owner amended C5 (#760):
// such deletions are now legal and reverse their receipts. Kept as
// reference until the blind pass models the reversal; not on any menu.
class DeletePurchaseOrderWithHistoryCommand
  implements fc.AsyncCommand<Model, Real>
{
  // read by the situation classifier after run — which context was refused
  targetWasClosed?: boolean;

  constructor(
    readonly orderIndex: number,
    readonly prefer: "partial" | "closed"
  ) {}

  check(model: Readonly<Model>): boolean {
    return [...model.purchaseOrders.values()].some((po) => po.received >= 1);
  }

  async run(model: Model, real: Real): Promise<void> {
    const touched = [...model.purchaseOrders.entries()].filter(
      ([, po]) => po.received >= 1
    );
    const preferred = touched.filter(([, po]) =>
      this.prefer === "closed"
        ? po.received >= po.ordered
        : po.received < po.ordered
    );
    const pool = preferred.length > 0 ? preferred : touched;
    const [poId, po] = pool[this.orderIndex % pool.length];
    this.targetWasClosed = po.received >= po.ordered;

    const before = await storedQuantities(real.orgId, po.itemId);
    const docBefore = await storedPoSnapshot(real.orgId, poId);
    const ledgerBefore = await storedLedgerDigest(real.orgId);

    const res = await deletePurchaseOrder(poId);
    expect(res.status, `${this} refusal status`).toBe(400);
    expect(
      (res.body as { error?: string }).error ?? "",
      `${this} refusal reason`
    ).toContain("history must be preserved");

    // postcondition: refused AND nothing observable changed
    expect(
      await storedPoExists(real.orgId, poId),
      `${this} order vanished (order ${poId})`
    ).toBe(true);
    const after = await storedQuantities(real.orgId, po.itemId);
    expect(after, `${this} mutated item quantities`).toEqual(before);
    expect(
      await storedPoSnapshot(real.orgId, poId),
      `${this} mutated the order document (order ${poId})`
    ).toBe(docBefore);
    expect(
      await storedLedgerDigest(real.orgId),
      `${this} changed the event ledger`
    ).toBe(ledgerBefore);
    const { atp, ...stored } = after;
    recordStep(String(this), po.itemId, derive(model, po.itemId), stored, atp);
  }

  toString(): string {
    return `deletePurchaseOrderWithHistory(order#${this.orderIndex}, prefer=${this.prefer})`;
  }
}

class CreateSalesOrderCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly itemIndex: number,
    readonly quantity: number
  ) {}

  check(model: Readonly<Model>): boolean {
    return model.items.size > 0;
  }

  async run(model: Model, real: Real): Promise<void> {
    const itemIds = [...model.items.keys()];
    const itemId = itemIds[this.itemIndex % itemIds.length];

    // the helper pins confirmOversell: demand may exceed stock (C2)
    const res = await createSalesOrder({
      customerId: real.customerId,
      lines: [{ itemId, quantity: String(this.quantity), unitPrice: "5.00" }],
    });
    expect(res.status, `${this} rejected`).toBe(201);
    const soId = (res.body as { id: string }).id;

    // a sales order that exists IS booked demand (K1) — booking is
    // derivation, not a write
    const { lineId } = await storedLine(real.orgId, soId);
    model.salesOrders.set(soId, {
      itemId,
      lineId,
      ordered: this.quantity,
      fulfilled: 0,
    });

    // postcondition: stored quantities equal the derived model
    const item = derive(model, itemId);
    const { atp, ...stored } = await storedQuantities(real.orgId, itemId);
    recordStep(String(this), itemId, item, stored, atp);
    expect(stored, `${this} postcondition (item ${itemId})`).toEqual(item);
  }

  toString(): string {
    return `createSalesOrder(item#${this.itemIndex}, qty=${this.quantity})`;
  }
}

// Blind-derived from THE SPEC: partial allowed (K3), capped at the remainder
// (over-fulfilling is forbidden — C3 legalizes over-receiving only), stock
// may go negative (C2), a fulfilled order stays in the map (K2).
class FulfillSalesOrderCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly orderIndex: number,
    readonly rawQuantity: number
  ) {}

  check(model: Readonly<Model>): boolean {
    return [...model.salesOrders.values()].some(
      (so) => so.ordered - so.fulfilled > 0
    );
  }

  async run(model: Model, real: Real): Promise<void> {
    const open = [...model.salesOrders.entries()].filter(
      ([, so]) => so.ordered - so.fulfilled > 0
    );
    const [soId, so] = open[this.orderIndex % open.length];
    const remaining = so.ordered - so.fulfilled;
    const quantity = Math.min(this.rawQuantity, remaining);

    const res = await fulfillSalesOrder(soId, {
      confirmNegativeStock: true, // C2 override, pinned on
      lines: [{ salesOrderLineId: so.lineId, quantity: String(quantity) }],
    });
    expect(res.status, `${this} rejected`).toBe(200);

    so.fulfilled += quantity; // the order does NOT leave the map (K2)

    // postcondition: stored = derived model, and the fulfilled counter matches
    const item = derive(model, so.itemId);
    const { atp, ...stored } = await storedQuantities(real.orgId, so.itemId);
    recordStep(String(this), so.itemId, item, stored, atp);
    expect(stored, `${this} postcondition (item ${so.itemId})`).toEqual(item);
    const line = await storedLine(real.orgId, soId);
    expect(line.shipped, `${this} fulfilled counter (order ${soId})`).toBe(
      so.fulfilled
    );
  }

  toString(): string {
    return `fulfillSalesOrder(order#${this.orderIndex}, qty=${this.rawQuantity})`;
  }
}

// ---------------------------------------------------------------------------
// Command generators
// ---------------------------------------------------------------------------

// Named so each property scopes its own menu (a subset of these names).
const RAW_ARBITRARIES: Record<
  string,
  fc.Arbitrary<fc.AsyncCommand<Model, Real>>
> = {
  createItem: fc
    .integer({ min: 0, max: 20 })
    .map((stock) => new CreateItemCommand(stock)),
  createPurchaseOrder: fc
    .tuple(fc.nat(99), fc.integer({ min: 1, max: 20 }))
    .map(
      ([itemIndex, quantity]) =>
        new CreatePurchaseOrderCommand(itemIndex, quantity)
    ),
  receivePurchaseOrder: fc
    .tuple(
      fc.nat(99),
      // Weighted toward the states the floors demand: "under" twice because
      // partial states are transient — the next receive closes them — and
      // three situation floors need them to exist; "exact" twice because
      // only it produces exact completion; "some" keeps a plain-quantity
      // tail; "over" also arises when "some" overshoots
      fc.constantFrom<ReceiveMode>("some", "under", "under", "exact", "exact", "over"),
      fc.integer({ min: 1, max: 20 })
    )
    .map(
      ([orderIndex, mode, amount]) =>
        new ReceivePurchaseOrderCommand(orderIndex, mode, amount)
    ),
  receiveClosedPurchaseOrder: fc
    .tuple(fc.nat(99), fc.integer({ min: 1, max: 20 }))
    .map(
      ([orderIndex, quantity]) =>
        new ReceiveClosedPurchaseOrderCommand(orderIndex, quantity)
    ),
  deletePurchaseOrder: fc
    .nat(99)
    .map((orderIndex) => new DeletePurchaseOrderCommand(orderIndex)),
  deletePurchaseOrderWithHistory: fc
    .tuple(
      fc.nat(99),
      // partial twice: closed orders accumulate for the rest of a sequence
      // while partial ones are a passing window — the bias corrects the
      // standing-population imbalance between the two refusal contexts
      fc.constantFrom<"partial" | "closed">("partial", "partial", "closed")
    )
    .map(
      ([orderIndex, prefer]) =>
        new DeletePurchaseOrderWithHistoryCommand(orderIndex, prefer)
    ),
  createSalesOrder: fc
    .tuple(fc.nat(99), fc.integer({ min: 1, max: 20 }))
    .map(
      ([itemIndex, quantity]) =>
        new CreateSalesOrderCommand(itemIndex, quantity)
    ),
  fulfillSalesOrder: fc
    .tuple(fc.nat(99), fc.integer({ min: 1, max: 20 }))
    .map(
      ([orderIndex, rawQuantity]) =>
        new FulfillSalesOrderCommand(orderIndex, rawQuantity)
    ),
};

// drawnEver spans the whole process (all properties) — it feeds the spec
// snapshot, which is one file; per-property drawn stats live in the journal.
const drawnEver = new Set<string>();
const menuArbitraries = (names: string[]) =>
  names.map((name) =>
    RAW_ARBITRARIES[name].map((command) => {
      drawnTally.set(name, (drawnTally.get(name) ?? 0) + 1);
      drawnEver.add(name);
      return new WithInvariant(command);
    })
  );

// Command anatomy for the overview page: prose summaries; the precondition
// and run source are extracted from the live classes, so they cannot drift.
const COMMAND_DEFS = [
  {
    name: "createItem",
    summary: "create an item with starting stock; books nothing else",
    cls: CreateItemCommand,
  },
  {
    name: "createPurchaseOrder",
    summary: "creating a PO books expected supply at once (K1)",
    cls: CreatePurchaseOrderCommand,
  },
  {
    name: "receivePurchaseOrder",
    summary:
      "receive any quantity against a PO still open to receiving — received < ordered (C4); over-receipt within the crossing receipt is legal (C3), closes the order, and rewrites the document: ordered rises to received (C6); onHand gains the full quantity, expected sheds only the unreceived remainder (I3); the order stays in the map until deleted (K2)",
    cls: ReceivePurchaseOrderCommand,
  },
  {
    name: "receiveClosedPurchaseOrder",
    summary:
      "rejection command (C4): a receipt against a closed order must draw the app's explicit domain refusal (status + reason — a crash is not a refusal), any quantity, no override; and nothing observable may change: item quantities, the whole order document, the whole event ledger",
    cls: ReceiveClosedPurchaseOrderCommand,
  },
  {
    name: "deletePurchaseOrder",
    summary:
      "delete a pristine order — no receipts, the pure map-delete subset of amended C5; the document leaves the world and expected sheds its full ordered quantity (K2/I3); deletion-with-receipts (reversal) awaits its own command",
    cls: DeletePurchaseOrderCommand,
  },
  {
    name: "deletePurchaseOrderWithHistory",
    summary:
      "PARKED — modeled the original C5 refusal of deletion-with-history; the owner amended C5 (deleting reverses receipts, #760), so this command is off the menus until the reversal semantics are blind-authored",
    cls: DeletePurchaseOrderWithHistoryCommand,
  },
  {
    name: "createSalesOrder",
    summary: "creating a sales order books demand at once (K1)",
    cls: CreateSalesOrderCommand,
  },
  {
    name: "fulfillSalesOrder",
    summary:
      "ship part or all of the remainder (K3); stock may go negative behind the override (C2); the order stays until deleted (K2)",
    cls: FulfillSalesOrderCommand,
  },
];

// For the journal/observatory; the drawn tally is the ground truth if this
// ever drifts.
const MENU = {
  active: [
    "createItem",
    "createPurchaseOrder",
    "receivePurchaseOrder",
    "receiveClosedPurchaseOrder",
    "deletePurchaseOrder",
    "createSalesOrder",
    "fulfillSalesOrder",
  ],
  parked: [
    {
      name: "deletePurchaseOrderWithHistory",
      reason:
        "C5 amended: deleting an order with receipts is now legal — the app reverses them (#760). This command models the OLD refusal rule; green does not cover deletion-with-receipts until a blind pass models the reversal (on-hand sheds received, claims release).",
    },
  ],
  next: [
    { name: "deletePurchaseOrderWithReceipts", note: "blind-author the C5 reversal semantics: deletion sheds received from on-hand, releases the remaining claim" },
    { name: "deleteSalesOrder", note: "releases demand; brings I2 liveness" },
    { name: "receiveDeletedPurchaseOrder", note: "deferred by owner: dangling-id rejections queue with the idempotency-contract work" },
  ],
};

// ---------------------------------------------------------------------------
// The property. Replay a failure with INVARIANTS_SEED (and INVARIANTS_PATH
// for the exact shrunk case). A path only means something under the
// generator that produced it, so also set INVARIANTS_PROPERTY to the
// journal line's property (default "integration") — the other property is
// skipped for that run.
// ---------------------------------------------------------------------------

const VERBOSE = process.env.INVARIANTS_VERBOSE === "1";
// Defaults sized so the coverage floors are reliably reachable — smaller
// budgets go red on the floor, honestly. Depth matters more than breadth:
// rejection commands need multi-command chains before they have a target.
const NUM_RUNS = Number(process.env.INVARIANTS_NUM_RUNS ?? 25);
const MAX_COMMANDS = Number(process.env.INVARIANTS_MAX_COMMANDS ?? 25);
// Self-chosen seed so every run — green or red — is replayable from its
// journal line.
const SEED = process.env.INVARIANTS_SEED
  ? Number(process.env.INVARIANTS_SEED)
  : Math.floor(Math.random() * 2 ** 31);
const REPLAY_PATH = process.env.INVARIANTS_PATH;

// One property run: generate sequences from the given menu, journal the
// outcome under `property`. Module tallies reset here — properties run
// serially and each owns its stats. requiredSituations are that property's
// binding semantic floors: green must mean those states were actually
// visited, not merely that commands executed.
async function runProperty(
  property: string,
  active: string[],
  requiredSituations: string[] = [],
  // per-property draw budget — env overrides still win for replays/tuning
  numRuns = NUM_RUNS
) {
  commandTally.clear();
  drawnTally.clear();
  situationTally.clear();
  trace.length = 0;
  failureTrace = [];

  // one pinned supplier and customer for the whole run
  const suffix = randomUUID().slice(0, 8);
  const supplier = await createSupplier({ name: `Invariants ${suffix}` });
  expect(supplier.status, "supplier setup").toBe(201);
  const supplierId = (supplier.body as { id: string }).id;
  const customer = await createCustomer({ name: `Invariants ${suffix}` });
  expect(customer.status, "customer setup").toBe(201);
  const customerId = (customer.body as { id: string }).id;

  // per-sequence executed counts and command mixes for the journal
  const lengths: number[] = [];
  const mixTally = new Map<string, number>();
  const executedSoFar = () =>
    [...commandTally.values()].reduce((a, b) => a + b, 0);
  const startedAt = Date.now();
  let gitRef = "";
  try {
    gitRef = execSync("git rev-parse --short HEAD").toString().trim();
    if (execSync("git status --porcelain -uno").toString().trim() !== "")
      gitRef += "+dirty";
  } catch {
    // journal line just goes without it
  }

  let failure: Error | null = null;
  // After the first failure every further attempt is a shrink attempt; stats
  // freeze at that point so the journal describes the run, not the shrinking.
  let shrinkPhase = false;
  const shrinkLengths: number[] = [];
  let tallyAtFailure: Map<string, number> | null = null;
  let drawnAtFailure: Map<string, number> | null = null;
  let situationsAtFailure: Map<string, number> | null = null;
  try {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(menuArbitraries(active), { maxCommands: MAX_COMMANDS, size: "max" }),
        async (cmds) => {
          const isShrink = shrinkPhase;
          if (VERBOSE)
            console.log(`  sequence ${lengths.length + shrinkLengths.length + 1}:`);
          const before = executedSoFar();
          const snapshot = new Map(commandTally);
          trace.length = 0;
          await wipeOrg(getOrgId());
          const setup = () => ({
            model: initialModel(),
            real: { orgId: getOrgId(), supplierId, customerId },
          });
          try {
            await fc.asyncModelRun(setup, cmds);
          } catch (error) {
            if (!shrinkPhase) {
              shrinkPhase = true;
              tallyAtFailure = new Map(commandTally);
              drawnAtFailure = new Map(drawnTally);
              situationsAtFailure = new Map(situationTally);
            }
            // shrinking runs more attempts after this one and wipes `trace`
            failureTrace = trace.slice();
            throw error;
          } finally {
            (isShrink ? shrinkLengths : lengths).push(executedSoFar() - before);
            if (!isShrink) {
              const parts = [...commandTally.entries()]
                .map(([name, n]) => ({ name, n: n - (snapshot.get(name) ?? 0) }))
                .filter((p) => p.n > 0)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => `${p.n}× ${p.name.replace("create", "").toLowerCase()}`)
                .join(" · ");
              const label = parts === "" ? "(empty)" : parts;
              mixTally.set(label, (mixTally.get(label) ?? 0) + 1);
            }
          }
        }
      ),
      { numRuns, seed: SEED, path: REPLAY_PATH }
    );
    // Coverage floors: green must mean work was done. Skipped for targeted
    // replays; the per-command floor only applies when the draw budget could
    // plausibly reach every command.
    if (!REPLAY_PATH) {
      expect(
        executedSoFar(),
        "coverage floor: run executed zero commands"
      ).toBeGreaterThan(0);
      if (numRuns * MAX_COMMANDS >= 50)
        for (const name of active)
          expect(
            commandTally.get(name) ?? 0,
            `coverage floor: ${name} never executed`
          ).toBeGreaterThan(0);
      // Semantic floors: rarer than commands — they need whole histories to
      // form — so they only bind at a budget that reliably produces them.
      if (numRuns * MAX_COMMANDS >= 400)
        for (const name of requiredSituations)
          expect(
            situationTally.get(name) ?? 0,
            `coverage floor: situation "${name}" never reached`
          ).toBeGreaterThan(0);
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    const runTally = tallyAtFailure ?? commandTally;
    const runDrawn = drawnAtFailure ?? drawnTally;
    const executed = [...runTally.values()].reduce((a, b) => a + b, 0);
    const distribution = [...runTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${Math.round((100 * n) / executed)}%`)
      .join(", ");
    console.log(
      `${failure ? "FAILED after" : "OK, passed"} ${lengths.length} sequences ` +
        `(commands per sequence: ${lengths.join(", ")})` +
        (shrinkLengths.length ? ` + ${shrinkLengths.length} shrink attempts` : "")
    );
    console.log(
      executed === 0
        ? "no commands executed"
        : `${executed} commands executed: ${distribution}`
    );
    console.log(`observatory: ${getBaseUrl()}/dev/invariants`);

    // Spec snapshot for the overview page. Everything that CAN be extracted
    // from the live code is; prose fields are annotations, never the truth.
    const ownSource = (() => {
      try {
        return readFileSync("test/e2e/invariants.spec.ts", "utf8");
      } catch {
        return "";
      }
    })();
    const sourceBetween = (from: string, to: string) => {
      const a = ownSource.indexOf(from);
      const b = ownSource.indexOf(to);
      return a >= 0 && b > a ? ownSource.slice(a, b).trimEnd() : "";
    };
    // A targeted replay must not redefine the spec page — skip the rewrite.
    if (!REPLAY_PATH) writeFileSync(
      "test/e2e/invariants-spec.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          gitRef,
          spec: SPEC,
          model: MODEL_DEF,
          modelSource: sourceBetween(
            "type ModelItem",
            "// The handle commands receive"
          ),
          commands: COMMAND_DEFS.map((c) => {
            const source = c.cls.prototype.run.toString();
            const marker = source.indexOf("// postcondition");
            return {
              name: c.name,
              summary: c.summary,
              precondition: c.cls.prototype.check.toString(),
              postcondition:
                marker >= 0
                  ? source.slice(marker).replace(/\}\s*$/, "").trimEnd()
                  : "",
              source,
            };
          }),
          recordStepSource: recordStep.toString(),
          sweeps: SWEEP_DEFS,
          invariantSource: invariant.toString(),
          reads: [storedQuantities.toString(), storedLine.toString()],
          menu: MENU,
          // union across every property this process ran — the snapshot is
          // one file; per-property drawn stats live in the journal
          menuDrawn: [...drawnEver],
        },
        null,
        2
      )
    );

    // Run journal: one line per property run; the observatory renders it.
    const totalDrawn = [...runDrawn.values()].reduce((a, b) => a + b, 0);
    appendFileSync(
      "test/e2e/invariants-journal.jsonl",
      `${JSON.stringify({
        at: new Date().toISOString(),
        property,
        result: failure ? "red" : "green",
        seed: SEED,
        gitRef,
        duration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        numRuns,
        maxCommands: MAX_COMMANDS,
        executed,
        lengths,
        shrinkAttempts: shrinkLengths.length,
        distribution,
        dist: [...runTally.entries()]
          .map(([name, count]) => ({
            name,
            count,
            exec: executed === 0 ? 0 : Math.round((100 * count) / executed),
            drawn:
              totalDrawn === 0
                ? 0
                : Math.round((100 * (runDrawn.get(name) ?? 0)) / totalDrawn),
          }))
          .sort((a, b) => b.count - a.count),
        mix: [...mixTally.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([label, n]) => ({
            label,
            pct: Math.round((100 * n) / Math.max(1, lengths.length)),
          })),
        sweeps: SWEEP_DEFS.map((d) => ({ ...d, checks: executed })),
        situations: SITUATIONS.map((name) => ({
          name,
          count: (situationsAtFailure ?? situationTally).get(name) ?? 0,
          required: requiredSituations.includes(name),
        })),
        menu: { active, parked: MENU.parked, next: MENU.next },
        fail: failure
          ? {
              assertion:
                (failure.cause as Error | undefined)?.message?.split("\n")[0] ??
                failure.message.split("\n")[0],
              seed: SEED,
              path: failure.message.match(/path:\s*"([^"]+)"/)?.[1],
              counterexample: failure.message.match(/Counterexample:\s*(.+)/)?.[1],
              shrunk: Number(failure.message.match(/Shrunk (\d+) time/)?.[1] ?? 0),
              ledger: failureTrace,
            }
          : undefined,
      })}\n`
    );
  }
}

// Purchasing-only menu: same model and commands, restricted draws — sales
// commands cannot dilute the probability of deep purchasing histories.
// Scope, precisely: the single-line, factor-one create/receive lifecycle
// plus pristine deletion is complete here. Deletion-with-receipts (C5
// reversal) is parked pending its model; edits, reopening, multi-line
// orders, unit conversion, costs, locations, and lots are future slices.
const PURCHASING_MENU = [
  "createItem",
  "createPurchaseOrder",
  "receivePurchaseOrder",
  "receiveClosedPurchaseOrder",
  "deletePurchaseOrder",
];

// Binding semantic floors for the purchasing property: a green run must
// have visited every lifecycle state, not merely executed every command.
// Pristine deletion and the closed-receipt refusal are already guaranteed
// one-to-one by the command floors.
const PURCHASING_REQUIRED_SITUATIONS = [
  "partial receipt",
  "purchase order completed exactly",
  "over-receipt",
];

// A replay path is only meaningful under the generator that produced it, so
// INVARIANTS_PATH runs one property alone: the one INVARIANTS_PROPERTY names
// (default "integration" — journal lines carry the property name).
const REPLAY_PROPERTY = process.env.INVARIANTS_PROPERTY ?? "integration";
const skipForReplay = (property: string) =>
  Boolean(REPLAY_PATH) && REPLAY_PROPERTY !== property;

// One lock for the WHOLE suite: the per-sequence wipe would destroy a
// concurrent run's world, and the promise is one run per database at a
// time — not per property. Fail fast instead of silently interleaving.
// afterAll guarantees the client (and with it the session lock) is released
// even when setup or a property fails mid-run.
let suiteLock: Client | null = null;
test.beforeAll(async () => {
  const lock = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP,
  });
  await lock.connect();
  try {
    const { rows } = await lock.query(
      "SELECT pg_try_advisory_lock(hashtext('erp-invariants-harness')::bigint) AS ok"
    );
    if (!rows[0]?.ok)
      throw new Error(
        "another invariants run holds this database — one run per database at a time"
      );
  } catch (error) {
    await lock.end();
    throw error;
  }
  suiteLock = lock;
});
test.afterAll(async () => {
  await suiteLock?.end();
  suiteLock = null;
});

test("inventory quantity invariants hold under generated command sequences", async () => {
  test.skip(skipForReplay("integration"), "replay targets another property");
  test.setTimeout(Number(process.env.INVARIANTS_TIMEOUT_MS ?? 600_000));
  // Integration situations stay display-only until the sales lifecycle gets
  // its own scoped property and floors.
  await runProperty("integration", MENU.active);
});

test("purchasing lifecycle invariants hold under generated command sequences", async () => {
  test.skip(skipForReplay("purchasing"), "replay targets another property");
  test.setTimeout(Number(process.env.INVARIANTS_TIMEOUT_MS ?? 600_000));
  // 40 sequences, not 25: the situation floors bind here, and the rarest
  // states (exact completion, deletion refused mid-receipt) need the larger
  // budget to occur reliably. An env override still wins.
  await runProperty(
    "purchasing",
    PURCHASING_MENU,
    PURCHASING_REQUIRED_SITUATIONS,
    process.env.INVARIANTS_NUM_RUNS ? NUM_RUNS : 40
  );
});
