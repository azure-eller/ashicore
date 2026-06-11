export const REPORT_TYPES = {
  DAILY_MANUFACTURING: "daily_manufacturing",
} as const;

export type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

export const NOTIFICATION_TYPES = {
  DAILY_MANUFACTURING_REPORT: "daily_manufacturing_report",
  MANUFACTURING_ORDER_CREATED: "manufacturing_order_created",
  MANUFACTURING_ORDER_COMPLETED: "manufacturing_order_completed",
  PURCHASE_ORDER_RECEIVED: "purchase_order_received",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const NOTIFICATION_ENTITY_TYPES = {
  REPORT_RUN: "report_run",
  MANUFACTURING_ORDER: "manufacturing_order",
  PURCHASE_ORDER: "purchase_order",
} as const;

export type NotificationEntityType =
  (typeof NOTIFICATION_ENTITY_TYPES)[keyof typeof NOTIFICATION_ENTITY_TYPES];

/**
 * Event types a user can subscribe to via notification_preferences. The daily
 * report is excluded: it has its own recipients model (report_recipients).
 */
export const SUBSCRIBABLE_EVENT_TYPES = [
  NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED,
  NOTIFICATION_TYPES.MANUFACTURING_ORDER_COMPLETED,
  NOTIFICATION_TYPES.PURCHASE_ORDER_RECEIVED,
] as const;

export type SubscribableEventType = (typeof SUBSCRIBABLE_EVENT_TYPES)[number];

export const NOTIFICATION_KINDS = {
  MFG: "mfg",
  SHIP: "ship",
  RECEIVE: "receive",
  STOCK: "stock",
  OTHER: "other",
} as const;

export type NotificationKind =
  (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

/**
 * Presentational kind that drives the mobile inbox icon tile. The server owns this taxonomy so
 * the client does not have to infer it from free-form strings. Known types map explicitly; future
 * ship, receive, and stock types rely on the keyword fallback until they get explicit mappings.
 */
export function notificationKindFor(
  type: string,
  entityType?: string | null
): NotificationKind {
  if (type === NOTIFICATION_TYPES.DAILY_MANUFACTURING_REPORT) {
    return NOTIFICATION_KINDS.MFG;
  }
  if (type === NOTIFICATION_TYPES.MANUFACTURING_ORDER_CREATED) {
    return NOTIFICATION_KINDS.MFG;
  }
  if (type === NOTIFICATION_TYPES.MANUFACTURING_ORDER_COMPLETED) {
    return NOTIFICATION_KINDS.MFG;
  }
  if (type === NOTIFICATION_TYPES.PURCHASE_ORDER_RECEIVED) {
    return NOTIFICATION_KINDS.RECEIVE;
  }
  // Keep these keyword sets in lockstep with the Android client fallback in
  // NotificationKind.kt (notificationKind). `po[_-]` matches po_/po-/_po_ (no
  // word boundary, which would miss underscore-prefixed forms); `count` is
  // bounded so words such as account/discount/headcount do not become stock.
  const haystack = `${type} ${entityType ?? ""}`.toLowerCase();
  if (/(receiv|purchase|po[_-])/.test(haystack)) return NOTIFICATION_KINDS.RECEIVE;
  if (/(ship|so[_-]|shipment)/.test(haystack)) return NOTIFICATION_KINDS.SHIP;
  if (/(stock|inventory|reorder|low_|lot|(?:^|[_\s-])count(?:$|[_\s-]))/.test(haystack)) {
    return NOTIFICATION_KINDS.STOCK;
  }
  return NOTIFICATION_KINDS.OTHER;
}

export const DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION = 2;
