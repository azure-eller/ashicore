import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { Separator } from "@/components/ui/separator";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHeaderCell,
  FramedTableHead,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import { TooltipHeader } from "@/components/tooltip-header";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { getBomRevisionHistory, getItem } from "@/app/(dashboard)/inventory/queries";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { canViewLockedBom, canViewUnlockedBom } from "@/lib/authz";
import { cn } from "@/lib/utils";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import { BOM_QTY_PER_UNIT_TOOLTIP } from "@/lib/tooltip-copy";
import {
  formatMinimumLotAgeRequirement,
  getMinimumLotAgeDays,
} from "@/lib/bom/constraints";
import { formatDate, toDateOnlyString } from "@/lib/format";

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

        <div className="flex gap-8">
          <nav className="hidden w-[180px] shrink-0 lg:block" aria-label="BOM revisions">
            <div className="sticky top-16 flex flex-col">
              {revisions.map((revision) => {
                const isSelected = revision.id === selectedRevision.id;

                return (
                  <Link
                    key={revision.id}
                    href={`/inventory/products/${id}/bom-history?revision=${revision.id}`}
                    className={cn(
                      "border-l-2 px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">Rev {revision.revisionNumber}</span>
                        {revision.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(toDateOnlyString(revision.createdAt))}
                      </span>
                      {revision.note ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {revision.note}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  Revision {selectedRevision.revisionNumber}
                </h2>
                {selectedRevision.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDate(toDateOnlyString(selectedRevision.createdAt))}
                {selectedRevision.createdByName
                  ? ` by ${selectedRevision.createdByName}`
                  : ""}
              </p>
              {selectedRevision.note ? (
                <p className="text-sm text-muted-foreground">{selectedRevision.note}</p>
              ) : null}
            </div>

            <TableFrame>
              <FramedTable>
                <FramedTableHead>
                  <FramedTableRow>
                    <FramedTableHeaderCell>Component</FramedTableHeaderCell>
                    <FramedTableHeaderCell>Type</FramedTableHeaderCell>
                    <FramedTableHeaderCell className="text-right">
                      <TooltipHeader label="Qty" tooltip={BOM_QTY_PER_UNIT_TOOLTIP} />
                    </FramedTableHeaderCell>
                    <FramedTableHeaderCell>Requirements</FramedTableHeaderCell>
                  </FramedTableRow>
                </FramedTableHead>
                <FramedTableBody>
                  {selectedRevision.components.map((component) => {
                    const minimumLotAgeDays = getMinimumLotAgeDays(component.constraints);

                    return (
                      <FramedTableRow key={component.id}>
                        <FramedTableCell>
                          <Link
                            href={itemDetailHref(component.componentItemType, component.componentId)}
                            className="hover:underline"
                          >
                            {component.componentName}
                          </Link>
                        </FramedTableCell>
                        <FramedTableCell>
                          <Badge variant="outline">{component.componentItemType}</Badge>
                        </FramedTableCell>
                        <FramedTableCell className="text-right">
                          <QuantityWithUnit
                            value={component.quantity}
                            unitName={component.unitName}
                            className="justify-end"
                          />
                        </FramedTableCell>
                        <FramedTableCell className="text-sm text-muted-foreground">
                          {minimumLotAgeDays
                            ? formatMinimumLotAgeRequirement(minimumLotAgeDays)
                            : "\u2014"}
                        </FramedTableCell>
                      </FramedTableRow>
                    );
                  })}
                </FramedTableBody>
              </FramedTable>
            </TableFrame>
          </div>
        </div>
      </div>
    </div>
  );
}
