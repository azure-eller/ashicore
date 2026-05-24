export const ALLOCATION_MODES = ["manual", "demand_queue"] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];
