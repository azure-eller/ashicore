import { z } from "zod";
import { nonNegativeDecimalString, nullableString } from "./shared";

export const lotQuantityAdjustmentSchema = z.object({
  quantity: nonNegativeDecimalString("Quantity"),
  note: nullableString,
});

export type LotQuantityAdjustment = z.infer<typeof lotQuantityAdjustmentSchema>;
