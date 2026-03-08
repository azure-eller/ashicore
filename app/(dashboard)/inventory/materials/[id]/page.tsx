import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/inventory/materials"
            className="text-sm text-muted-foreground hover:underline"
          >
            &larr; Back to Materials
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {item.name}
          </h1>
        </div>
        <Button asChild>
          <Link href={`/inventory/materials/${id}/edit`}>Edit</Link>
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">SKU</dt>
          <dd className="text-sm">{item.sku ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Category
          </dt>
          <dd className="text-sm">{item.category ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">Unit</dt>
          <dd className="text-sm">
            {item.unitName} ({item.unitSize} {item.unitUom})
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            Purchase Price
          </dt>
          <dd className="text-sm">{item.defaultPurchasePrice ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            In Stock
          </dt>
          <dd className="text-sm">{item.inStock}</dd>
        </div>
      </dl>
    </div>
  );
}
