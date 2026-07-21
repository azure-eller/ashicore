#!/usr/bin/env bash
# Fault validation for the I3 liveness sweep in invariants.spec.ts.
# Seeds seven corruption classes directly into the database and demands the
# sweep's descriptor query flag each one — an oracle that has never seen a
# fault die is decoration. Re-run after any change to the sweep SQL and
# refresh test/e2e/invariants-i3-fault-validation.md with the output.
#
# The query below is a copy of sweep 6 ("I3 liveness: every open line
# contributes exactly once") — if it drifts from invariants.spec.ts, this
# validation is validating the wrong thing. Requires: dev server running,
# test/.test-env.json present (pnpm boot creates it), owner DATABASE_URL in
# .env.local.
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_JSON=test/.test-env.json
BASE_URL=$(python3 -c "import json;print(json.load(open('$ENV_JSON'))['TEST_BASE_URL'])")
COOKIE=$(python3 -c "import json;print(json.load(open('$ENV_JSON'))['TEST_SESSION_COOKIE'])")
ORG_ID=$(python3 -c "import json;print(json.load(open('$ENV_JSON'))['TEST_ORG_ID'])")
UNIT_ID=$(python3 -c "import json;print(json.load(open('$ENV_JSON'))['TEST_UNIT_ID'])")
DB_URL=$(grep -oP '^DATABASE_URL=\K.*' .env.local | head -1)

api() { # method path json-body
  curl -sf -X "$1" "$BASE_URL$2" \
    -H "Content-Type: application/json" \
    -H "Cookie: $COOKIE" \
    -H "Idempotency-Key: $(uuidgen)" \
    -d "$3"
}
q() { psql "$DB_URL" -qtAX -c "$1"; }

# A corruption tool must not leak corruption: whatever happens — a failed
# call, an assertion, Ctrl-C — remove every row this script created or
# corrupted. (The harness's per-sequence wipe would also clear the org on
# its next run; this trap just makes the script safe standalone.)
cleanup() {
  [ -n "${GHOST:-}" ] && q "DELETE FROM inventory.inventory_expected_summary WHERE reference_id='${GHOST}'" >/dev/null 2>&1 || true
  if [ -n "${LINE_ID:-}" ]; then
    q "DELETE FROM inventory.inventory_expected_summary WHERE reference_id='${LINE_ID}'" >/dev/null 2>&1 || true
    q "DELETE FROM purchasing.purchase_order_lines WHERE id='${LINE_ID}'" >/dev/null 2>&1 || true
  fi
  [ -n "${PO_ID:-}" ] && q "DELETE FROM purchasing.purchase_orders WHERE id='${PO_ID}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The sweep query (copy of sweep 6). Prints one line per violation.
SWEEP="
SELECT entity_id || ' | stored: ' || stored || ' | live: ' || recomputed FROM (
  SELECT COALESCE(es.reference_id, src.line_id)::text AS entity_id,
         CASE WHEN es.reference_id IS NULL THEN 'no rows'
              ELSE format('qty=%s rows=%s item=%s', es.qty::numeric(18,4), es.n, es.item_id)
         END AS stored,
         CASE WHEN src.line_id IS NULL THEN 'no live line'
              WHEN src.remainder = 0 THEN 'no rows'
              ELSE format('qty=%s rows=%s item=%s', src.remainder::numeric(18,4), 1, src.item_id)
         END AS recomputed
  FROM (SELECT reference_id, COUNT(*) AS n, SUM(quantity) AS qty,
               MIN(item_id::text) AS item_id
        FROM inventory.inventory_expected_summary
        WHERE organization_id = '$ORG_ID' AND reference_type = 'purchase_order_line'
        GROUP BY 1) es
  FULL JOIN (SELECT pol.id AS line_id, pol.item_id::text AS item_id,
                    GREATEST(0, pol.stock_quantity_ordered - pol.stock_quantity_received) AS remainder
             FROM purchasing.purchase_order_lines pol
             JOIN purchasing.purchase_orders po ON po.id = pol.purchase_order_id
             WHERE po.organization_id = '$ORG_ID' AND po.deleted_at IS NULL) src
    ON src.line_id = es.reference_id
) x WHERE stored <> recomputed"

check() { # fault-name expectation(kill|clean)
  local hits
  hits=$(q "$SWEEP")
  if [ "$2" = kill ]; then
    if [ -n "$hits" ]; then echo "  KILLED: $hits"; else echo "  MISSED — sweep stayed green under fault '$1'"; exit 1; fi
  else
    if [ -z "$hits" ]; then echo "  clean"; else echo "  DIRTY after cleanup of '$1': $hits"; exit 1; fi
  fi
}

echo "== I3 liveness fault validation — $(date -u +%Y-%m-%dT%H:%M:%SZ) =="
echo "== git $(git rev-parse --short HEAD)$(git status --porcelain -uno | grep -q . && echo +dirty) =="

SUF=$(uuidgen | cut -c1-8)
SUP_ID=$(api POST /api/suppliers "{\"name\":\"I3 Fault $SUF\"}" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
mkitem() {
  api POST /api/items "{\"name\":\"I3 $1 $SUF\",\"itemType\":\"material\",\"unitDefinitionId\":\"$UNIT_ID\",\"sku\":\"I3-$1-$SUF\",\"category\":\"Invariants\",\"description\":null,\"defaultPurchasePrice\":\"2.00\",\"defaultSellingPrice\":null,\"sellable\":true,\"stock\":\"0\",\"safetyStock\":\"0\",\"bom\":[]}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])"
}
ITEM_A=$(mkitem A); ITEM_B=$(mkitem B)
PO_ID=$(api POST /api/purchase-orders "{\"supplierId\":\"$SUP_ID\",\"lines\":[{\"itemId\":\"$ITEM_A\",\"quantityOrdered\":\"10\",\"unitCost\":\"2.00\"}]}" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
LINE_ID=$(q "SELECT id FROM purchasing.purchase_order_lines WHERE purchase_order_id='$PO_ID'")
LOC_ID=$(q "SELECT location_id FROM inventory.inventory_expected_summary WHERE organization_id='$ORG_ID' AND reference_id='$LINE_ID'")
echo "setup: PO $PO_ID line $LINE_ID (10 ordered, 0 received) — sweep must be clean"
check setup clean

echo "fault 1: wrong quantity (expected row inflated by 1)"
q "UPDATE inventory.inventory_expected_summary SET quantity = quantity + 1 WHERE reference_id='$LINE_ID'" >/dev/null
check wrong-quantity kill
q "UPDATE inventory.inventory_expected_summary SET quantity = quantity - 1 WHERE reference_id='$LINE_ID'" >/dev/null
check wrong-quantity clean

echo "fault 2: missing row (open line, expected row deleted)"
q "DELETE FROM inventory.inventory_expected_summary WHERE reference_id='$LINE_ID'" >/dev/null
check missing-row kill
q "INSERT INTO inventory.inventory_expected_summary (organization_id, location_id, item_id, reference_type, reference_id, quantity) VALUES ('$ORG_ID','$LOC_ID','$ITEM_A','purchase_order_line','$LINE_ID',10)" >/dev/null
check missing-row clean

echo "fault 3: orphan row (expected row pointing at a line that never existed)"
GHOST=$(uuidgen)
q "INSERT INTO inventory.inventory_expected_summary (organization_id, location_id, item_id, reference_type, reference_id, quantity) VALUES ('$ORG_ID','$LOC_ID','$ITEM_A','purchase_order_line','$GHOST',5)" >/dev/null
check orphan-row kill
q "DELETE FROM inventory.inventory_expected_summary WHERE reference_id='$GHOST'" >/dev/null
check orphan-row clean

echo "fault 4: deleted order still contributing (soft-deleted, row left behind)"
q "UPDATE purchasing.purchase_orders SET deleted_at = now() WHERE id='$PO_ID'" >/dev/null
check deleted-order kill
q "UPDATE purchasing.purchase_orders SET deleted_at = NULL WHERE id='$PO_ID'" >/dev/null
check deleted-order clean

echo "fault 5: closed line still contributing (received = ordered, row left behind)"
q "UPDATE purchasing.purchase_order_lines SET quantity_received = quantity_ordered, stock_quantity_received = stock_quantity_ordered WHERE id='$LINE_ID'" >/dev/null
check closed-line kill
q "UPDATE purchasing.purchase_order_lines SET quantity_received = 0, stock_quantity_received = 0 WHERE id='$LINE_ID'" >/dev/null
check closed-line clean

echo "fault 6: wrong item identity (right quantity, row on the wrong item)"
q "UPDATE inventory.inventory_expected_summary SET item_id='$ITEM_B' WHERE reference_id='$LINE_ID'" >/dev/null
check wrong-item kill
q "UPDATE inventory.inventory_expected_summary SET item_id='$ITEM_A' WHERE reference_id='$LINE_ID'" >/dev/null
check wrong-item clean

echo "fault 7: duplicate row (two rows that sum to the correct remainder)"
q "UPDATE inventory.inventory_expected_summary SET quantity = 4 WHERE reference_id='$LINE_ID'" >/dev/null
q "INSERT INTO inventory.inventory_expected_summary (organization_id, location_id, item_id, reference_type, reference_id, quantity) VALUES ('$ORG_ID','$LOC_ID','$ITEM_B','purchase_order_line','$LINE_ID',6)" >/dev/null
check duplicate-row kill
q "DELETE FROM inventory.inventory_expected_summary WHERE reference_id='$LINE_ID' AND item_id='$ITEM_B'" >/dev/null
q "UPDATE inventory.inventory_expected_summary SET quantity = 10 WHERE reference_id='$LINE_ID'" >/dev/null
check duplicate-row clean

api DELETE "/api/purchase-orders/$PO_ID" "{}" >/dev/null
echo "== 7/7 faults killed, sweep clean between every fault =="
