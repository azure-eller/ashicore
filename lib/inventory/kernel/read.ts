import { sql, type AnyColumn, type SQLWrapper } from "drizzle-orm";
import {
  inventoryEvents,
  type InventoryEventType,
  inventoryItemBalances,
  inventoryLocations,
  inventoryLotBalances,
  organization,
} from "@/lib/db/schema";
import { trimScale, trimScaleNullable } from "@/lib/db/numeric";

type SqlExpression = AnyColumn | SQLWrapper;

export const ON_HAND_INCREASE_EVENT_TYPES = [
  "opening_balance",
  "purchase_receipt",
  "manufacturing_output",
  "manual_adjustment_increase",
  "stocktake_gain",
  "manufacturing_variance_gain",
  "unpick_restock",
  "transfer_in",
] as const satisfies readonly InventoryEventType[];

export const ON_HAND_DECREASE_EVENT_TYPES = [
  "manual_adjustment_decrease",
  "stocktake_loss",
  "sales_consumption",
  "manufacturing_ingredient_consumption",
  "manufacturing_variance_loss",
  "quality_scrap",
  "transfer_out",
] as const satisfies readonly InventoryEventType[];

export const ON_HAND_EVENT_TYPES = [
  ...ON_HAND_INCREASE_EVENT_TYPES,
  ...ON_HAND_DECREASE_EVENT_TYPES,
] as const satisfies readonly InventoryEventType[];

function sqlValueList(values: readonly string[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function organizationCurrentDateExpr(organizationId: SqlExpression) {
  return sql`(
    now() AT TIME ZONE COALESCE(
      (
        SELECT ${organization.timeZone}
        FROM ${organization}
        WHERE ${organization.id} = ${organizationId}
        LIMIT 1
      ),
      'America/Denver'
    )
  )::date`;
}

function ledgerIncreaseEventExpr(eventType: SqlExpression) {
  return sql`${eventType} IN (${sqlValueList(ON_HAND_INCREASE_EVENT_TYPES)})`;
}

function ledgerDecreaseEventExpr(eventType: SqlExpression) {
  return sql`${eventType} IN (${sqlValueList(ON_HAND_DECREASE_EVENT_TYPES)})`;
}

export function ledgerOnHandEventExpr(eventType: SqlExpression) {
  return sql`(${ledgerIncreaseEventExpr(eventType)} OR ${ledgerDecreaseEventExpr(eventType)})`;
}

export function ledgerOnHandDeltaExpr(
  eventType: SqlExpression,
  quantity: SqlExpression
) {
  return sql`CASE
    WHEN ${ledgerIncreaseEventExpr(eventType)} THEN ${quantity}
    WHEN ${ledgerDecreaseEventExpr(eventType)} THEN -${quantity}
    ELSE 0
  END`;
}

export function defaultLocationIdSubquery(organizationId: SqlExpression) {
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
    | typeof inventoryItemBalances.demandQty
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

function activeLotBalanceSubquery(
  organizationId: SqlExpression,
  lotId: SqlExpression,
  column:
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
      AND ${inventoryLotBalances.quantity} > 0
    ORDER BY ${inventoryLotBalances.receivedAt} ASC, ${inventoryLotBalances.disposition} ASC
    LIMIT 1
  )`;
}

export function projectedOnHandQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedOnHandQtyExpr(
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

export function projectedAvailableQty(organizationId: SqlExpression, itemId: SqlExpression) {
  return trimScale(projectedAvailableQtyExpr(
    organizationId,
    itemId,
  ));
}

export function projectedPotentialQty(
  organizationId: SqlExpression,
  productId: SqlExpression,
  itemType: SqlExpression
) {
  return trimScaleNullable(projectedPotentialQtyExpr(
    organizationId,
    productId,
    itemType
  ));
}

export function projectedReservableOnHandQty(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return trimScale(projectedReservableOnHandQtyExpr(
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
  return trimScale(sql`COALESCE((
    SELECT SUM(${inventoryLotBalances.quantity})
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryLotBalances.lotId} = ${lotId}
  ), 0)`);
}

export function projectedLotUnitCost(organizationId: SqlExpression, lotId: SqlExpression) {
  return trimScaleNullable(activeLotBalanceSubquery(
    organizationId,
    lotId,
    inventoryLotBalances.unitCost
  ));
}

export function projectedLotReceivedAt(
  organizationId: SqlExpression,
  lotId: SqlExpression
) {
  return activeLotBalanceSubquery(organizationId, lotId, inventoryLotBalances.receivedAt);
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

export function projectedReservableOnHandQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  const positiveAvailableQty = sql`COALESCE((
    SELECT SUM(${inventoryLotBalances.quantity})
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
	      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
	        organizationId
	      )}
	      AND ${inventoryLotBalances.itemId} = ${itemId}
	      AND ${inventoryLotBalances.disposition} = 'available'
        AND ${inventoryLotBalances.quantity} > 0
	  ), 0)`;
  const debtQty = sql`COALESCE((
    SELECT ABS(SUM(${inventoryLotBalances.quantity}))
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
	      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
	        organizationId
	      )}
	      AND ${inventoryLotBalances.itemId} = ${itemId}
	      AND ${inventoryLotBalances.disposition} = 'available'
        AND ${inventoryLotBalances.quantity} < 0
	  ), 0)`;

  return sql`GREATEST(0, ${positiveAvailableQty} - ${debtQty})`;
}

export function projectedAvailableQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  return projectedReservableOnHandQtyExpr(organizationId, itemId);
}

export function projectedAgeEligibleAvailableQtyExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression,
  minimumLotAgeDays: SqlExpression
) {
  const ageEligiblePositiveQty = sql`COALESCE((
      SELECT SUM(${inventoryLotBalances.quantity})
      FROM ${inventoryLotBalances}
      WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
        AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
          organizationId
        )}
	        AND ${inventoryLotBalances.itemId} = ${itemId}
	        AND ${inventoryLotBalances.disposition} = 'available'
	        AND ${inventoryLotBalances.quantity} > 0
	        AND ${inventoryLotBalances.receivedAt}::date <= (
          ${organizationCurrentDateExpr(organizationId)}
          - (${minimumLotAgeDays}::int * INTERVAL '1 day')
        )
    ), 0)`;
  const debtQty = sql`COALESCE((
    SELECT ABS(SUM(${inventoryLotBalances.quantity}))
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryLotBalances.itemId} = ${itemId}
      AND ${inventoryLotBalances.disposition} = 'available'
      AND ${inventoryLotBalances.quantity} < 0
  ), 0)`;

  return sql`GREATEST(
    0,
    GREATEST(0, ${ageEligiblePositiveQty} - ${debtQty})
  )`;
}

export function projectedPotentialQtyExpr(
  organizationId: SqlExpression,
  productId: SqlExpression,
  itemType: SqlExpression
) {
  return sql<string | null>`(
    CASE WHEN ${itemType} = 'product' AND EXISTS (
      SELECT 1
      FROM inventory.bom_revisions br
      INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
      WHERE br.product_id = ${productId}
        AND br.is_current = true
    ) THEN
      GREATEST(
        0,
        FLOOR(
        (
          SELECT MIN(
            (
              CASE WHEN constraint_values.minimum_lot_age_days IS NULL THEN
                ${projectedAvailableQtyExpr(organizationId, sql`brc.component_id`)}
              ELSE
                ${projectedAgeEligibleAvailableQtyExpr(
                  organizationId,
                  sql`brc.component_id`,
                  sql`constraint_values.minimum_lot_age_days`
                )}
              END
            )
            / NULLIF(
              CASE
                WHEN br.recipe_basis = 'batch' AND br.output_quantity > 0
                THEN brc.quantity / br.output_quantity
                ELSE brc.quantity
              END,
              0
            )
          )
          FROM inventory.bom_revisions br
          INNER JOIN inventory.bom_revision_components brc ON brc.bom_revision_id = br.id
          LEFT JOIN LATERAL (
            SELECT (brcc.config->>'days')::int AS minimum_lot_age_days
            FROM inventory.bom_revision_component_constraints brcc
            WHERE brcc.bom_revision_component_id = brc.id
              AND brcc.constraint_type = 'lot_age_min_days'
            LIMIT 1
          ) constraint_values ON true
          WHERE br.product_id = ${productId}
            AND br.is_current = true
        )
      )
      )
    ELSE NULL END
  )`;
}

export function projectedAvailableToPromiseExpr(
  organizationId: SqlExpression,
  itemId: SqlExpression
) {
  const positiveAvailableQty = sql`COALESCE((
    SELECT SUM(${inventoryLotBalances.quantity})
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryLotBalances.itemId} = ${itemId}
      AND ${inventoryLotBalances.disposition} = 'available'
      AND ${inventoryLotBalances.quantity} > 0
  ), 0)`;
  const debtQty = sql`COALESCE((
    SELECT ABS(SUM(${inventoryLotBalances.quantity}))
    FROM ${inventoryLotBalances}
    WHERE ${inventoryLotBalances.organizationId} = ${organizationId}
      AND ${inventoryLotBalances.locationId} = ${defaultLocationIdSubquery(
        organizationId
      )}
      AND ${inventoryLotBalances.itemId} = ${itemId}
      AND ${inventoryLotBalances.disposition} = 'available'
      AND ${inventoryLotBalances.quantity} < 0
  ), 0)`;

  return sql`
    GREATEST(
      0,
      ${positiveAvailableQty}
      + ${projectedExpectedQtyExpr(organizationId, itemId)}
      - ${debtQty}
    )
    - ${projectedDemandQtyExpr(organizationId, itemId)}
  `;
}
