import { z } from "zod";
import { buildTool } from "@/lib/agent/core/Tool";
import { lookupCustomerCategoriesForAgent } from "@/app/(dashboard)/sales/agent-queries";

export const lookupCustomerCategoriesTool = buildTool({
  name: "LookupCustomerCategories",
  description: "Return the current active customer categories.",
  inputSchema: z.strictObject({}),
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call() {
    return lookupCustomerCategoriesForAgent();
  },
});
