// The daily manufacturing report schedule has no per-org config options.
// The `report_schedules.config` jsonb column is retained (defaults to `{}`)
// for forward compatibility but currently holds nothing.
export type DailyManufacturingReportScheduleConfig = Record<string, never>;
