export const REPORT_TYPES = {
  DAILY_MANUFACTURING: "daily_manufacturing",
} as const;

export type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

export const NOTIFICATION_TYPES = {
  DAILY_MANUFACTURING_REPORT: "daily_manufacturing_report",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const NOTIFICATION_ENTITY_TYPES = {
  REPORT_RUN: "report_run",
} as const;

export type NotificationEntityType =
  (typeof NOTIFICATION_ENTITY_TYPES)[keyof typeof NOTIFICATION_ENTITY_TYPES];

export const DAILY_MANUFACTURING_REPORT_PAYLOAD_VERSION = 1;
