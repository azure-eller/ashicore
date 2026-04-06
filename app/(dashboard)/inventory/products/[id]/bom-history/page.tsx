import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { getBomRevisionHistory, getItem } from "@/app/(dashboard)/inventory/queries";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import { cn } from "@/lib/utils";

export default async function ProductBomHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const context = await getAuthedMemberContext();
  const { id } = await params;
  const { revision: selectedRevisionId } = await searchParams;

  const item = await getItem(id);

  if (!item || item.itemType !== "product") {
    redirect("/inventory/products");
  }

  const canViewBom = item.bomLocked
    ? canViewLockedBom(context.assignedRoles)
    : canViewUnlockedBom(context.assignedRoles);

  if (!canViewBom) {
    redirect(`/inventory/products/${id}`);
  }

  const revisions = await getBomRevisionHistory(id);

  if (revisions.length === 0) {
    redirect(`/inventory/products/${id}`);
  }

  const selectedRevision =
    revisions.find((entry) => entry.id === selectedRevisionId) ?? revisions[0];

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="space-y-6">
        <div className="space-y-2">
          <Link
            href={`/inventory/products/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
            Back to Product
          </Link>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">BOM Revision History</h1>
            <p className="text-sm text-muted-foreground">{item.name}</p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-2">
            {revisions.map((revision) => {
              const isSelected = revision.id === selectedRevision.id;

              return (
                <Button
                  key={revision.id}
                  variant="ghost"
                  asChild
                  className={cn(
                    "h-auto w-full justify-start rounded-lg border px-3 py-3 text-left",
                    isSelected
                      ? "border-foreground bg-accent hover:bg-accent"
                      : "border-border hover:bg-accent/60"
                  )}
                >
                  <Link href={`/inventory/products/${id}/bom-history?revision=${revision.id}`}>
                    <span className="flex w-full flex-col items-start gap-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">Rev {revision.revisionNumber}</span>
                        {revision.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {revision.createdAt.toLocaleDateString("en-US")}
                      </span>
                      {revision.note ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {revision.note}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </Button>
              );
            })}
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  Revision {selectedRevision.revisionNumber}
                </h2>
                {selectedRevision.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedRevision.createdAt.toLocaleDateString("en-US")}
                {selectedRevision.createdByName
                  ? ` by ${selectedRevision.createdByName}`
                  : ""}
              </p>
              {selectedRevision.note ? (
                <p className="text-sm text-muted-foreground">{selectedRevision.note}</p>
              ) : null}
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Stocking Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRevision.components.map((component) => (
                    <TableRow key={component.id}>
                      <TableCell>{component.componentName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{component.componentItemType}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(component.quantity)}
                      </TableCell>
                      <TableCell className="text-right">{component.unitName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
