import { sql, type AnyColumn, type SQLWrapper } from "drizzle-orm";
import {
  inventoryEvents,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";

type SqlExpression = AnyColumn | SQLWrapper;

function defaultLocationIdSubquery(organizationId: SqlExpression) {
  return sql`(
    SELECT ${inventoryLocations.id}
    FROM ${inventoryLocations}
    WHERE ${inventoryLocations.organizationId} = ${organizationId}
      AND ${inventoryLocations.isDefault} = true
      AND ${inventoryLocations.deletedAt} IS NULL
    LIMIT 1
  )`;
}

function itemBalanceSubquery(
  organizationId: SqlExpression,
  itemId: SqlExpression,
  column: typeof inventoryItemBalances.onHandQty
    | typeof inventoryItemBalances.committedQty
    | typeof inventoryItemBalances.demandQty
    | typeof inventoryItemBalances.shortageQty
    | typeof inventoryItemBalances.expectedQty
    | typeof inventoryItemBalances.availableToPromise
) {
  return sql`(
    SELECT ${column}
    FROM ${inventoryItemBalances}
    WHERE ${inventoryItemBalances.organizationId} = ${organizationId}
      AND ${inventoryItemBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryItemBalances.itemId} = ${itemId}
    LIMIT 1
  )`;
}

function lotBalanceSubquery(
  organizationId: SqlExpression,
  lotId: SqlExpression,
  column:
    | typeof inventoryLotBalances.quantity
    | typeof inventoryLotBalances.unitCost
    | typeof inventoryLotBalances.receivedAt
) {
  return sql`(
    SELECT ${column}
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryLotBalances.lotId} = ${lotId}
    LIMIT 1
  )`;
}

export function projectedOnHandQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedOnHandQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedCommittedQty(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return trimScale(projectedCommittedQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedExpectedQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedExpectedQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedDemandQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedDemandQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedShortageQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedShortageQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedAvailableQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedAvailableQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedAvailableToPromise(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return trimScale(projectedAvailableToPromiseExpr(
    organizationId,
    itemId,
  ));
}

export function projectedLotQuantity(organizationId: SqlExpression, lotId: SqlExpression) {
  return trimScale(sql`COALESCE(${lotBalanceSubquery(
    organizationId,
    lotId,
    inventoryLotBalances.quantity
  )}, 0)`);
}

export function projectedLotUnitCost(organizationId: SqlExpression, lotId: SqlExpression) {
  return trimScaleNullable(lotBalanceSubquery(
    organizationId,
    lotId,
    inventoryLotBalances.unitCost
  ));
}

export function projectedLotReceivedAt(
  organizationId: SqlExpression,
  lotId: SqlExpression
) {
  return lotBalanceSubquery(organizationId, lotId, inventoryLotBalances.receivedAt);
}

export function ledgerLotUnitCostByOrigin(
  organizationId: SqlExpression,
  lotId: SqlExpression
) {
  return trimScaleNullable(sql`(
    SELECT ${inventoryEvents.unitCost}
    FROM ${inventoryEvents}
    WHERE ${inventoryEvents.organizationId} = ${organizationId}
      AND ${inventoryEvents.lotId} = ${lotId}
      AND ${inventoryEvents.eventType} IN (
        'opening_balance',
        'purchase_receipt',
        'manufacturing_output',
        'manual_adjustment_increase',
        'stocktake_gain',
        'manufacturing_variance_gain',
        'unpick_restock'
      )
    ORDER BY ${inventoryEvents.occurredAt} ASC, ${inventoryEvents.id} ASC
    LIMIT 1
  )`);
}

export function projectedOnHandQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`COALESCE(${itemBalanceSubquery(
    organizationId,
    itemId,
    inventoryItemBalances.onHandQty
  )}, 0)`;
}

export function projectedCommittedQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`COALESCE(${itemBalanceSubquery(
    organizationId,
    itemId,
    inventoryItemBalances.committedQty
  )}, 0)`;
}

export function projectedExpectedQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`COALESCE(${itemBalanceSubquery(
    organizationId,
    itemId,
    inventoryItemBalances.expectedQty
  )}, 0)`;
}

export function projectedDemandQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`COALESCE(${itemBalanceSubquery(
    organizationId,
    itemId,
    inventoryItemBalances.demandQty
  )}, 0)`;
}

export function projectedShortageQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`COALESCE(${itemBalanceSubquery(
    organizationId,
    itemId,
    inventoryItemBalances.shortageQty
  )}, 0)`;
}

export function projectedReservableOnHandQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`COALESCE((
    SELECT SUM(${inventoryLotBalances.quantity})
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryLotBalances.itemId} = ${itemId}
      AND ${inventoryLotBalances.stockStatus} = 'available'
      AND ${inventoryLotBalances.quantity} > 0
  ), 0)`;
}

export function projectedAvailableQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`GREATEST(
    0,
    ${projectedReservableOnHandQtyExpr(organizationId, itemId)}
    - ${projectedCommittedQtyExpr(organizationId, itemId)}
  )`;
}

export function projectedAvailableToPromiseExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return sql`
    ${projectedReservableOnHandQtyExpr(organizationId, itemId)}
    - ${projectedDemandQtyExpr(organizationId, itemId)}
    + ${projectedExpectedQtyExpr(organizationId, itemId)}
  `;
}
