import { z } from "zod";
import { positiveQuantityString } from "./shared";

const transferQuantity = positiveQuantityString("Quantity");

export const createTransferSchema = z
  .object({
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    note: z.string().trim().max(500).nullish(),
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          quantity: transferQuantity,
        })
      )
      .min(1, "Add at least one line"),
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "Source and destination locations must differ",
    path: ["toLocationId"],
  });

export type CreateTransfer = z.infer<typeof createTransferSchema>;
