import { z } from "zod";

export const ALLOCATION_MODES = ["manual", "demand_queue"] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

export const updateAllocationModeSchema = z.object({
  allocationMode: z.enum(ALLOCATION_MODES),
});

export type UpdateAllocationModeInput = z.infer<typeof updateAllocationModeSchema>;
