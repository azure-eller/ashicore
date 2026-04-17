import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { lookupCustomersForAgent } from "@/app/(dashboard)/sales/agent-queries";

const lookupCustomersInputSchema = z.strictObject({
  query: z.string().trim().describe("Free-text search query for customers."),
  limit: z.number().int().min(1).max(20).default(20).describe("Maximum number of customers to return."),
});

type LookupCustomersInput = z.infer<typeof lookupCustomersInputSchema>;

export const lookupCustomersTool = buildTool({
  name: "LookupCustomers",
  description: "Search existing customers by name, email, phone, or category.",
  inputSchema: lookupCustomersInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input: LookupCustomersInput) {
    return lookupCustomersForAgent({
      query: input.query,
      limit: input.limit,
    });
  },
});
