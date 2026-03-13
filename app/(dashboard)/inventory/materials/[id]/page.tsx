import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getItem, getLots } from "@/app/(dashboard)/inventory/queries";
import { formatPrice } from "@/lib/format";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, itemLots] = await Promise.all([getItem(id), getLots(id)]);
  if (!item) redirect("/inventory/materials");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href="/inventory/materials"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span aria-hidden>←</span> Back to Materials
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {item.name}
          </h1>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/inventory/materials/${id}/edit`}>Edit</Link>
        </Button>
      </div>
      <Separator />
      {item.description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
      )}
      <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">SKU</dt>
          <dd className="mt-1 text-sm">{item.sku ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Category
          </dt>
          <dd className="mt-1 text-sm">{item.category ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Unit</dt>
          <dd className="mt-1 text-sm">
            {item.unitName} ({parseFloat(item.unitSize)} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Purchase Price
          </dt>
          <dd className="mt-1 text-sm">
            {formatPrice(item.defaultPurchasePrice) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            In Stock
          </dt>
          <dd className="mt-1 text-sm">{parseFloat(item.inStock)} {item.unitName}</dd>
        </div>
      </dl>

      <Separator />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Lots</h2>
        {itemLots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lots recorded.</p>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Lot Number</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Quantity</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Cost / Unit</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Received</th>
                </tr>
              </thead>
              <tbody>
                {itemLots.map((lot) => (
                  <tr key={lot.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">{lot.lotNumber}</td>
                    <td className="px-4 py-2 text-right">{parseFloat(lot.quantity)}</td>
                    <td className="px-4 py-2 text-right">{formatPrice(lot.costPerUnit) ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{lot.receivedAt.toLocaleDateString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
