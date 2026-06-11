import "server-only";

import { z } from "zod";
import { getValidatedProductInTx } from "@/lib/manufacturing/queries/order-write";
import { getCurrentActiveBomIngredientsInTx } from "@/lib/bom/revisions";
import type { ProposalField } from "@/lib/agent/chat/proposals";
import { defineAgentAction } from "@/lib/agent/chat/actions/types";

const manufacturingOrderCreateInput = z.object({
  productId: z
    .string()
    .min(1)
    .describe(
      "UUID of the product to make (inventory.items.id with an active BOM — find it with the query tool)"
    ),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .describe('Quantity to make as a positive decimal string, e.g. "10"'),
  plannedDate: z.string().nullable().describe("Planned production date YYYY-MM-DD, or null"),
  notes: z.string().nullable().describe("Free-text note for the order, or null"),
});

export const manufacturingOrderCreateAction = defineAgentAction({
  name: "manufacturing_order.create",
  title: "Create manufacturing order",
  summary:
    "Raise a manufacturing order for a product with an active BOM; ingredients snapshot from the BOM automatically.",
  module: "manufacturing",
  capability: "operate",
  inputSchema: manufacturingOrderCreateInput,
  example: {
    productId: "00000000-0000-0000-0000-000000000000",
    quantity: "10",
    plannedDate: null,
    notes: null,
  },
  async build(input, { tx }) {
    const product = await getValidatedProductInTx(tx, input.productId);
    const bomIngredients = await getCurrentActiveBomIngredientsInTx(tx, input.productId);
    if (bomIngredients.length === 0) {
      throw new Error(
        `"${product.name}" has no active BOM, so a manufacturing order cannot be staged for it.`
      );
    }

    const fields: ProposalField[] = [
      { label: "Product", value: product.name },
      { label: "Quantity", value: `${input.quantity} ${product.unitName}` },
      {
        label: "Ingredients",
        value: bomIngredients
          .map((ingredient) => ingredient.itemName)
          .join(", "),
      },
    ];
    if (input.plannedDate) fields.push({ label: "Planned", value: input.plannedDate });
    if (input.notes) fields.push({ label: "Notes", value: input.notes });

    return {
      title: `Manufacturing order — ${product.name}`,
      appliedLabel: "Manufacturing order created",
      commitPath: "/api/manufacturing-orders",
      method: "POST",
      commitPayload: {
        productId: product.id,
        plannedQuantity: input.quantity,
        plannedDate: input.plannedDate,
        notes: input.notes,
        ingredients: bomIngredients.map((ingredient) => ({
          itemId: ingredient.itemId,
          quantityPerUnit: ingredient.quantityPerUnit,
        })),
      },
      fields,
    };
  },
});
