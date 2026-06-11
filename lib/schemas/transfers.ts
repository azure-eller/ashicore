import { z } from "zod";

const transferQuantity = z
  .string()
  .trim()
  .refine((value) => /^\d+(\.\d{1,4})?$/.test(value), {
    message: "Quantity must be a positive number with up to 4 decimal places",
  })
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "Quantity must be greater than zero",
  });

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
