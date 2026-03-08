import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getItem } from "@/app/(dashboard)/inventory/queries";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getItem(id);
  if (!item) redirect("/inventory/materials");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href="/inventory/materials"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Back to Materials
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
            {item.unitName} ({item.unitSize} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Purchase Price
          </dt>
          <dd className="mt-1 text-sm">{item.defaultPurchasePrice ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            In Stock
          </dt>
          <dd className="mt-1 text-sm">{item.inStock}</dd>
        </div>
      </dl>
    </div>
  );
}
