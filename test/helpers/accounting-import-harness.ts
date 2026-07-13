// Runs the real accounting PO import against the local DB with an injected
// provider document (no Xero connection). Executed as a child process by
// specs via tsx with tsconfig.accounting-import.json, which stubs the
// `server-only` marker so DAL modules load in plain Node.
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: "../../.env.local" });

async function main() {
  const input = JSON.parse(process.argv[2] ?? "{}") as {
    orgId: string;
    document: unknown;
  };
  const { applyAccountingPurchaseOrderImport } = await import(
    "../../lib/accounting/import-purchase-orders"
  );
  const document = input.document as { id: string };
  const result = await applyAccountingPurchaseOrderImport(
    input.orgId,
    [document.id],
    {
      provider: "xero",
      providerData: {
        tenantId: "harness-tenant",
        tenantName: "Harness Tenant",
        purchaseOrders: [document as never],
      },
    },
  );
  console.log(JSON.stringify(result));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
