import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ItemDetailActions } from "./item-detail-actions";
import { ItemDetailTabs } from "./item-detail-tabs";
import { ItemHistorySparklineCard } from "./item-history-sparkline-card";
import { LotDispositionActions } from "./lot-disposition-actions";
import { LotQuantityAdjuster } from "./lot-quantity-adjuster";
import { InventoryCommitmentDonut } from "./inventory-commitment-donut";
import { DateTimeText } from "@/components/date-time-text";
import type { ItemCommitmentSummary } from "./commitment-summary";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CircleLock01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { calcStock, ITEM_TYPE_SEGMENTS, itemDetailHref, type ItemType } from "@/app/(dashboard)/inventory/types";
import {
  formatCost,
  formatInventoryDisposition,
  formatMovementType,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AVAILABLE_QTY_TOOLTIP,
  BATCH_YIELD_TOOLTIP,
  BOM_QTY_PER_BATCH_TOOLTIP,
  BOM_QTY_PER_UNIT_TOOLTIP,
  CALCULATED_STOCK_ALERT_TOOLTIP,
  CALCULATED_STOCK_TOOLTIP,
  CURRENT_STOCK_UNIT_COST_TOOLTIP,
  DEMAND_QTY_TOOLTIP,
  EXPECTED_QTY_TOOLTIP,
  ITEM_CATEGORY_TOOLTIP,
  ITEM_SKU_TOOLTIP,
  ITEM_TYPE_TOOLTIP,
  LEDGER_CHANGE_TOOLTIP,
  LEDGER_LOT_TOOLTIP,
  LOT_DISPOSITION_TOOLTIP,
  LOT_PHYSICAL_TOOLTIP,
  LOT_UNIT_COST_TOOLTIP,
  LOT_NUMBER_TOOLTIP,
  ON_HAND_STOCK_TOOLTIP,
  PURCHASE_CONVERSION_TOOLTIP,
  PURCHASE_PRICE_TOOLTIP,
  PURCHASE_UNIT_TOOLTIP,
  SAFETY_STOCK_TOOLTIP,
  SELLING_PRICE_TOOLTIP,
  STOCKING_UNIT_TOOLTIP,
  VARIANT_AXES_TOOLTIP,
} from "@/lib/tooltip-copy";
import { formatMinimumLotAgeRequirement } from "@/lib/bom/constraints";

export type ItemDetailTab = "overview" | "lots" | "recipe" | "movements";

export function normalizeItemDetailTab(
  value: string | string[] | undefined,
  itemType: ItemType
): ItemDetailTab {
  const tab = Array.isArray(value) ? value[0] : value;
  if (tab === "lots" || tab === "movements") return tab;
  if (tab === "recipe" && itemType === "product") return tab;
  return "overview";
}

interface ItemDetailProps {
  item: {
    id: string;
    name: string;
    displayName?: string;
    sku: string | null;
    category: string | null;
    description: string | null;
    unitName: string | null;
    unitSize: string | null;
    unitUom: string | null;
    purchaseUnitName: string | null;
    purchaseUnitSize: string | null;
    purchaseUnitUom: string | null;
    purchaseToStockFactor: string | null;
    defaultPurchasePrice: string | null;
    xeroItemCode: string | null;
    xeroItemName: string | null;
    xeroPurchaseDescription: string | null;
    accountingPurchaseAccountCode: string | null;
    xeroPurchaseTaxType: string | null;
    xeroUpdatedAt: Date | null;
    currentStockUnitCost: string | null;
    defaultSellingPrice: string | null;
    sellable?: boolean | null;
    stock: string;
    committedQty: string;
    demandQty: string;
    shortageQty: string;
    availableQty: string;
    expectedQty: string;
    safetyStock: string;
    manufacturingMode?: string;
    expectedBatchYield?: string | null;
    isMaster?: boolean;
    variantAxes?: string[] | null;
    parentId?: string | null;
    parentName?: string | null;
    bomLocked?: boolean;
    currentBomRevision?: {
      id: string;
      revisionNumber: number;
      isCurrent: boolean;
      note: string | null;
      createdByName: string | null;
      createdAt: Date;
    } | null;
    supplierSources?: {
      id: string;
      supplierName: string;
      supplierSku: string | null;
      unitCost: string | null;
      isPreferred: boolean;
    }[];
  };
  itemType: ItemType;
  bom?: {
    id: string;
    componentId: string;
    componentName: string;
    componentItemType: string;
    componentUnit: string;
    quantity: string | null;
    minimumLotAgeDays?: number | null;
  }[];
  lots: {
    id: string;
    lotNumber: string;
    quantity: string;
    costPerUnit: string | null;
    soldQuantity: string | null;
    realizedRevenue: string | null;
    realizedCogs: string | null;
    realizedGrossProfit: string | null;
    realizedMarginPercent: string | null;
    receivedAt: Date;
    allocations: Array<{
      type: "sales_order" | "manufacturing_order";
      label: string;
      contextLabel: string | null;
      href: string;
      quantity: string;
    }>;
    dispositionBalances: Array<{
      disposition: "available" | "blocked" | "rejected";
      quantity: string;
    }>;
  }[];
  movements: {
    id: string;
    quantity: string;
    movementType: string | null;
    referenceType: string | null;
    referenceId: string | null;
    lotNumber: string | null;
    createdAt: Date;
  }[];
  usedInParents?: {
    id: string;
    name: string;
    displayName: string;
  }[];
  variants?: {
    id: string;
    name: string;
    sku: string | null;
    stock: string;
    committedQty: string;
    demandQty: string;
    shortageQty: string;
    availableQty: string;
    expectedQty: string;
    safetyStock: string;
    defaultSellingPrice: string | null;
    unit: string | null;
    variantAttrs: Record<string, string> | null;
  }[];
  canEdit?: boolean;
  canViewBom?: boolean;
  canViewLedger?: boolean;
  commitmentSummary?: ItemCommitmentSummary;
  activeTab?: ItemDetailTab;
}

type DetailItem = ItemDetailProps["item"];
type DetailLot = ItemDetailProps["lots"][number];
type DetailMovement = ItemDetailProps["movements"][number];
type DetailBomLine = NonNullable<ItemDetailProps["bom"]>[number];

function toQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityValue(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function formatUnit(item: Pick<DetailItem, "unitName" | "unitSize" | "unitUom">) {
  if (!item.unitName) return "\u2014";
  if (!item.unitSize || !item.unitUom) return item.unitName;
  return `${item.unitName} (${item.unitSize} ${item.unitUom})`;
}

function formatPurchaseUnit(
  item: Pick<DetailItem, "purchaseUnitName" | "purchaseUnitSize" | "purchaseUnitUom">
) {
  if (!item.purchaseUnitName || !item.purchaseUnitSize || !item.purchaseUnitUom) {
    return "\u2014";
  }
  return `${item.purchaseUnitName} (${item.purchaseUnitSize} ${item.purchaseUnitUom})`;
}

function formatPurchaseConversion(
  item: Pick<DetailItem, "purchaseUnitName" | "purchaseToStockFactor" | "unitName">
) {
  if (!item.purchaseUnitName || !item.purchaseToStockFactor) return "\u2014";
  return `1 ${item.purchaseUnitName} = ${formatQuantity(item.purchaseToStockFactor)} ${
    item.unitName ?? "stock unit"
  }`;
}

function formatMode(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "discrete";
}

function formatQuantityValue(value: string | number | null | undefined) {
  return formatQuantity(value == null ? null : String(value));
}

function EqTerm({
  label,
  value,
  tooltip,
  operator,
  dim,
}: {
  label: string;
  value: string | number;
  tooltip: string;
  operator?: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {operator ? (
        <span className="text-2xl font-light leading-none text-muted-foreground/60">
          {operator}
        </span>
      ) : null}
      <div>
        <div className="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
          <TooltipHeader label={label} tooltip={tooltip} />
        </div>
        <div
          className={cn(
            "mt-1 font-mono text-2xl font-semibold leading-none tracking-tight md:text-3xl",
            dim ? "text-muted-foreground/70" : "text-foreground"
          )}
        >
          {formatQuantityValue(value)}
        </div>
      </div>
    </div>
  );
}

function StockEquation({
  item,
  calculatedStock,
}: {
  item: DetailItem;
  calculatedStock: number;
}) {
  const safetyStock = parseFloat(item.safetyStock);
  return (
    <div className="flex flex-wrap items-center gap-4 border-t py-5">
      <EqTerm label="Physical" value={item.stock} tooltip={ON_HAND_STOCK_TOOLTIP} />
      <EqTerm
        label="Demand"
        value={item.demandQty}
        tooltip={DEMAND_QTY_TOOLTIP}
        operator="-"
        dim={parseFloat(item.demandQty) === 0}
      />
      <EqTerm
        label="Expected"
        value={item.expectedQty}
        tooltip={EXPECTED_QTY_TOOLTIP}
        operator="+"
        dim={parseFloat(item.expectedQty) === 0}
      />
      <EqTerm
        label="Safety"
        value={item.safetyStock}
        tooltip={SAFETY_STOCK_TOOLTIP}
        operator="-"
        dim={!Number.isFinite(safetyStock) || safetyStock === 0}
      />
      <span className="text-2xl font-light leading-none text-muted-foreground/60">=</span>
      <div className="rounded-lg bg-foreground px-4 py-3 text-background">
        <div className="text-[0.68rem] font-medium uppercase tracking-wide text-background/60">
          <TooltipHeader label="Calculated" tooltip={CALCULATED_STOCK_TOOLTIP} />
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold leading-none tracking-tight md:text-3xl">
          {formatQuantityValue(calculatedStock)}
        </div>
      </div>
      <div className="min-w-32 flex-1 text-right">
        <div className="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
          <TooltipHeader label="Available now" tooltip={AVAILABLE_QTY_TOOLTIP} />
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold leading-none tracking-tight text-success md:text-3xl">
          {formatQuantity(item.availableQty)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {item.unitName ?? "units"}
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}

function InfoRows({
  rows,
}: {
  rows: Array<{
    label: string;
    value: ReactNode;
    mono?: boolean;
    dim?: boolean;
    tooltip?: string;
  }>;
}) {
  return (
    <div>
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={cn(
            "flex items-center justify-between gap-4 px-4 py-3 text-sm",
            index < rows.length - 1 && "border-b"
          )}
        >
          <dt className="text-xs text-muted-foreground">
            {row.tooltip ? (
              <TooltipHeader label={row.label} tooltip={row.tooltip} />
            ) : (
              row.label
            )}
          </dt>
          <dd
            className={cn(
              "min-w-0 text-right font-medium",
              row.mono && "font-mono",
              row.dim && "text-muted-foreground"
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </div>
  );
}

function weightedLotCost(lots: DetailLot[]) {
  let totalQuantity = 0;
  let totalCost = 0;

  for (const lot of lots) {
    const quantity = parseFloat(lot.quantity);
    const cost = lot.costPerUnit == null ? NaN : parseFloat(lot.costPerUnit);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost)) {
      continue;
    }
    totalQuantity += quantity;
    totalCost += quantity * cost;
  }

  if (totalQuantity <= 0) return null;
  return String(totalCost / totalQuantity);
}

function ItemInfoCards({
  item,
  itemType,
  lots,
}: {
  item: DetailItem;
  itemType: ItemType;
  lots: DetailLot[];
}) {
  const costPerUnit = item.currentStockUnitCost ?? weightedLotCost(lots);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <SectionCard title="Identity">
        <dl>
          <InfoRows
            rows={[
              {
                label: "SKU",
                value: item.sku ?? "\u2014",
                mono: true,
                dim: item.sku == null,
                tooltip: ITEM_SKU_TOOLTIP,
              },
              {
                label: "Xero SKU",
                value: item.xeroItemCode ?? "\u2014",
                mono: true,
                dim: item.xeroItemCode == null,
              },
              {
                label: "Xero item",
                value: item.xeroItemName ?? "\u2014",
                dim: item.xeroItemName == null,
              },
              {
                label: "Category",
                value: item.category ?? "\u2014",
                dim: item.category == null,
                tooltip: ITEM_CATEGORY_TOOLTIP,
              },
              ...(item.parentName
                ? [
                    {
                      label: "Variant of",
                      value: (
                        <Link
                          href={`/inventory/products/${item.parentId}`}
                          className="hover:underline"
                        >
                          {item.parentName}
                        </Link>
                      ),
                    },
                  ]
                : []),
              ...(itemType === "product"
                ? [
                    {
                      label: "Mfg mode",
                      value: formatMode(item.manufacturingMode),
                    },
                    ...(item.currentBomRevision
                      ? [
                          {
                            label: "Recipe",
                            value: `Rev ${item.currentBomRevision.revisionNumber}`,
                          },
                        ]
                      : []),
                  ]
                : [
                    {
                      label: "Item type",
                      value: "Material",
                      tooltip: ITEM_TYPE_TOOLTIP,
                    },
                  ]),
            ]}
          />
        </dl>
      </SectionCard>

      <SectionCard title="Units">
        <dl>
          <InfoRows
            rows={[
              {
                label: "Stocking unit",
                value: formatUnit(item),
                tooltip: STOCKING_UNIT_TOOLTIP,
              },
              {
                label: "Purchase unit",
                value: formatPurchaseUnit(item),
                dim: !item.purchaseUnitName,
                tooltip: PURCHASE_UNIT_TOOLTIP,
              },
              {
                label: "Purchase conv.",
                value: formatPurchaseConversion(item),
                dim: !item.purchaseToStockFactor,
                tooltip: PURCHASE_CONVERSION_TOOLTIP,
              },
              ...(itemType === "product" && item.manufacturingMode === "batch"
                ? [
                    {
                      label: "Batch yield",
                      value:
                        item.expectedBatchYield != null
                          ? `${formatQuantity(item.expectedBatchYield)} ${item.unitName ?? "units"}`
                          : "\u2014",
                      mono: true,
                      dim: item.expectedBatchYield == null,
                      tooltip: BATCH_YIELD_TOOLTIP,
                    },
                  ]
                : []),
            ]}
          />
        </dl>
      </SectionCard>

      <SectionCard title="Economics">
        <dl>
          <InfoRows
            rows={[
              ...(itemType === "material"
                ? [
                    {
                      label: "Purchase price",
                      value: formatPrice(item.defaultPurchasePrice) ?? "\u2014",
                      mono: true,
                      dim: item.defaultPurchasePrice == null,
                      tooltip: PURCHASE_PRICE_TOOLTIP,
                    },
                    {
                      label: "Xero purchase account",
                      value: item.accountingPurchaseAccountCode ?? "\u2014",
                      mono: true,
                      dim: item.accountingPurchaseAccountCode == null,
                    },
                    {
                      label: "Xero tax type",
                      value: item.xeroPurchaseTaxType ?? "\u2014",
                      mono: true,
                      dim: item.xeroPurchaseTaxType == null,
                    },
                  ]
                : []),
              {
                label: "Selling price",
                value: formatPrice(item.defaultSellingPrice) ?? "\u2014",
                mono: true,
                dim: item.defaultSellingPrice == null,
                tooltip: SELLING_PRICE_TOOLTIP,
              },
              {
                label: "Cost / unit",
                value: formatCost(costPerUnit) ?? "\u2014",
                mono: true,
                dim: costPerUnit == null,
                tooltip: CURRENT_STOCK_UNIT_COST_TOOLTIP,
              },
              {
                label: "Safety stock",
                value: formatQuantity(item.safetyStock),
                mono: true,
                tooltip: SAFETY_STOCK_TOOLTIP,
              },
            ]}
          />
        </dl>
      </SectionCard>
    </div>
  );
}

function SupplierSources({ item }: { item: DetailItem }) {
  const sources = item.supplierSources ?? [];
  const hasXeroDescription = item.xeroPurchaseDescription != null;

  if (sources.length === 0 && !hasXeroDescription) return null;

  return (
    <SectionCard title="Supplier Sources">
      {hasXeroDescription ? (
        <div className="border-b p-4 text-sm">
          <div className="text-xs font-medium text-muted-foreground">
            Xero purchase description
          </div>
          <div className="mt-1">{item.xeroPurchaseDescription}</div>
          {item.xeroUpdatedAt ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Updated <DateTimeText value={item.xeroUpdatedAt} />
            </div>
          ) : null}
        </div>
      ) : null}
      {sources.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Supplier SKU</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">Default</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell>{source.supplierName}</TableCell>
                <TableCell className="font-mono">
                  {source.supplierSku ?? "\u2014"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPrice(source.unitCost) ?? "\u2014"}
                </TableCell>
                <TableCell className="text-right">
                  {source.isPreferred ? <Badge variant="secondary">Preferred</Badge> : "\u2014"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </SectionCard>
  );
}

function UsedInCard({
  usedInParents,
}: {
  usedInParents: ItemDetailProps["usedInParents"];
}) {
  const count = usedInParents?.length ?? 0;

  return (
    <SectionCard
      title="Used In"
      action={
        count > 0 ? (
          <Badge variant="secondary">
            {count} {count === 1 ? "product" : "products"}
          </Badge>
        ) : null
      }
    >
      {usedInParents && usedInParents.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-2 p-4">
          {usedInParents.map((parent) => (
            <Badge
              asChild
              key={parent.id}
              variant="outline"
              className="max-w-full justify-start sm:max-w-72"
            >
              <Link href={`/inventory/products/${parent.id}`}>
                {parent.displayName}
              </Link>
            </Badge>
          ))}
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          Not used in any current product recipes.
        </div>
      )}
    </SectionCard>
  );
}

function LotDispositionOverview({
  item,
  lots,
}: {
  item: DetailItem;
  lots: DetailLot[];
}) {
  const actionableBalances = lots.flatMap((lot) =>
    lot.dispositionBalances
      .filter((balance) => balance.disposition !== "available")
      .map((balance) => ({ lot, balance }))
  );

  if (actionableBalances.length === 0) return null;

  return (
    <SectionCard title="Lot Disposition">
      <div className="divide-y">
        {actionableBalances.map(({ lot, balance }) => (
          <div
            key={`${lot.id}-${balance.disposition}-overview`}
            className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="font-mono text-sm">{lot.lotNumber}</span>
              <Badge
                variant={
                  balance.disposition === "rejected" ? "destructive" : "secondary"
                }
              >
                {formatInventoryDisposition(balance.disposition)}
              </Badge>
              <span className="font-mono text-sm text-muted-foreground">
                {formatQuantity(balance.quantity)} {item.unitName ?? "units"}
              </span>
            </div>
            <LotDispositionActions
              itemId={item.id}
              lotId={lot.id}
              fromDisposition={balance.disposition}
              maxQuantity={balance.quantity}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function OverviewPanel({
  item,
  itemType,
  lots,
  usedInParents,
  commitmentSummary,
}: {
  item: DetailItem;
  itemType: ItemType;
  lots: DetailLot[];
  usedInParents: ItemDetailProps["usedInParents"];
  commitmentSummary: ItemCommitmentSummary | undefined;
}) {
  return (
    <div className="space-y-4">
      <ItemInfoCards item={item} itemType={itemType} lots={lots} />
      <SupplierSources item={item} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ItemHistorySparklineCard itemId={item.id} itemType={itemType} />
        <SectionCard title="Stock Commitments">
          <div className="p-4">
            {commitmentSummary && commitmentSummary.slices.length > 0 ? (
              <InventoryCommitmentDonut
                slices={commitmentSummary.slices}
                onHandQty={commitmentSummary.onHandQty}
                unitName={commitmentSummary.unitName}
              />
            ) : (
              <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                No on-hand stock to chart.
              </div>
            )}
          </div>
        </SectionCard>
      </div>
      <LotDispositionOverview item={item} lots={lots} />
      <UsedInCard usedInParents={usedInParents} />
    </div>
  );
}

function LotsPanel({ item, lots }: { item: DetailItem; lots: DetailLot[] }) {
  const visibleLots = lots.filter(
    (lot) => toQuantity(lot.quantity) > 0 || lot.allocations.length > 0
  );

  return (
    <SectionCard
      title="Lots"
      action={
        <Badge variant="secondary">
          {visibleLots.length} {visibleLots.length === 1 ? "active lot" : "active lots"}
        </Badge>
      }
    >
      {visibleLots.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No lots recorded.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <TooltipHeader label="Lot Number" tooltip={LOT_NUMBER_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="On Hand" tooltip={LOT_PHYSICAL_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">Free</TableHead>
              <TableHead>Claimed By</TableHead>
              <TableHead>
                <TooltipHeader label="Disposition" tooltip={LOT_DISPOSITION_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Cost / Unit" tooltip={LOT_UNIT_COST_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="w-10 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLots.map((lot) => {
              const availableQuantity = lot.dispositionBalances
                .filter((balance) => balance.disposition === "available")
                .reduce((sum, balance) => sum + toQuantity(balance.quantity), 0);
              const claimedQuantity = lot.allocations.reduce(
                (sum, allocation) => sum + toQuantity(allocation.quantity),
                0
              );
              const freeQuantity = Math.max(availableQuantity - claimedQuantity, 0);
              const fullyClaimed = availableQuantity > 0 && freeQuantity === 0;

              return (
                <TableRow key={lot.id}>
                  <TableCell className="font-mono">{lot.lotNumber}</TableCell>
                  <TableCell className="text-right font-mono">
                    <LotQuantityAdjuster
                      itemId={item.id}
                      lotId={lot.id}
                      lotNumber={lot.lotNumber}
                      quantity={lot.quantity}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span
                        className={cn(
                          "font-mono",
                          fullyClaimed ? "text-destructive" : "text-foreground"
                        )}
                      >
                        {formatQuantity(quantityValue(freeQuantity))}
                      </span>
                      {fullyClaimed ? (
                        <span className="text-xs font-medium text-destructive">
                          fully claimed
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {lot.allocations.length > 0 ? (
                      <ul className="flex flex-col gap-1" role="list">
                        {lot.allocations.map((allocation) => (
                          <li
                            key={`${lot.id}-${allocation.type}-${allocation.label}-${allocation.quantity}`}
                            className="flex flex-wrap items-center gap-1.5 text-xs"
                          >
                            <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono font-medium text-destructive">
                              {formatQuantity(allocation.quantity)}
                            </span>
                            <Link
                              href={allocation.href}
                              className="font-mono text-foreground underline-offset-4 hover:underline"
                            >
                              {allocation.label}
                            </Link>
                            {allocation.contextLabel ? (
                              <span className="text-muted-foreground">
                                {allocation.contextLabel}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">{"\u2014"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lot.dispositionBalances.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        {lot.dispositionBalances.map((balance) => (
                          <div
                            key={`${lot.id}-${balance.disposition}`}
                            className="flex items-center justify-between gap-3"
                          >
                            <Badge
                              variant={
                                balance.disposition === "available"
                                  ? "success"
                                  : balance.disposition === "rejected"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {formatInventoryDisposition(balance.disposition)}
                            </Badge>
                            <span className="font-mono text-muted-foreground">
                              {formatQuantity(balance.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      "\u2014"
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCost(lot.costPerUnit) ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    <DateTimeText value={lot.receivedAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    {lot.dispositionBalances.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${lot.lotNumber}`}
                          >
                            <HugeiconsIcon
                              icon={MoreVerticalIcon}
                              size={16}
                              strokeWidth={2}
                              aria-hidden
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-64 bg-popover p-2 text-popover-foreground"
                        >
                          <div className="space-y-3">
                            {lot.dispositionBalances.map((balance) => (
                              <div
                                key={`${lot.id}-${balance.disposition}-actions`}
                                className="space-y-2"
                              >
                                <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
                                  <span>{formatInventoryDisposition(balance.disposition)}</span>
                                  <span className="font-mono">
                                    {formatQuantity(balance.quantity)}
                                  </span>
                                </div>
                                <LotDispositionActions
                                  itemId={item.id}
                                  lotId={lot.id}
                                  fromDisposition={balance.disposition}
                                  maxQuantity={balance.quantity}
                                />
                              </div>
                            ))}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

function RecipePanel({
  item,
  bom,
  canViewBom,
  basePath,
}: {
  item: DetailItem;
  bom: DetailBomLine[] | undefined;
  canViewBom: boolean;
  basePath: string;
}) {
  const revision = item.currentBomRevision;

  if (item.bomLocked && !canViewBom) {
    return (
      <SectionCard title="Recipe / Bill of Materials">
        <div className="p-4 text-sm text-muted-foreground">
          This recipe is locked. Inventory or manufacturing admin access is required to view
          its ingredients.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Recipe / Bill of Materials"
      action={
        revision ? (
          <Button type="button" variant="outline" size="xs" asChild>
            <Link href={`${basePath}/${item.id}/bom-history`}>History</Link>
          </Button>
        ) : null
      }
    >
      <div className="border-b px-4 py-3 text-xs text-muted-foreground">
        {revision ? (
          <span>
            Rev {revision.revisionNumber} · <DateTimeText value={revision.createdAt} />
            {revision.createdByName ? ` · ${revision.createdByName}` : ""}
            {revision.note ? ` · ${revision.note}` : ""}
          </span>
        ) : (
          "No active BOM revision."
        )}
      </div>
      {bom && bom.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>
                <TooltipHeader label="Type" tooltip={ITEM_TYPE_TOOLTIP} />
              </TableHead>
              <TableHead className="text-right">
                <TooltipHeader
                  label={item.manufacturingMode === "batch" ? "Qty / Batch" : "Qty"}
                  tooltip={
                    item.manufacturingMode === "batch"
                      ? BOM_QTY_PER_BATCH_TOOLTIP
                      : BOM_QTY_PER_UNIT_TOOLTIP
                  }
                />
              </TableHead>
              {item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
                <TableHead className="text-right">
                  <TooltipHeader label="Qty / Unit" tooltip={BOM_QTY_PER_UNIT_TOOLTIP} />
                </TableHead>
              )}
              <TableHead>Requirements</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bom.map((line) => {
              const batchQty = line.quantity ? parseFloat(line.quantity) : null;
              const yieldValue = item.expectedBatchYield
                ? parseFloat(item.expectedBatchYield)
                : null;
              const perUnit =
                batchQty != null && yieldValue != null && yieldValue > 0
                  ? parseFloat((batchQty / yieldValue).toFixed(4).replace(/\.?0+$/, ""))
                  : null;

              return (
                <TableRow key={line.id}>
                  <TableCell>
                    <Link
                      href={itemDetailHref(line.componentItemType, line.componentId)}
                      className="font-medium hover:underline"
                    >
                      {line.componentName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{line.componentItemType}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {batchQty != null
                      ? `${formatQuantity(line.quantity)} ${line.componentUnit}`
                      : "\u2014"}
                  </TableCell>
                  {item.manufacturingMode === "batch" && item.expectedBatchYield != null && (
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {perUnit != null ? `${perUnit} ${line.componentUnit}` : "\u2014"}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">
                    {line.minimumLotAgeDays
                      ? formatMinimumLotAgeRequirement(line.minimumLotAgeDays)
                      : "\u2014"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          No active BOM ingredients on the current revision.
        </div>
      )}
    </SectionCard>
  );
}

function MovementsPanel({
  item,
  movements,
  canViewLedger,
}: {
  item: DetailItem;
  movements: DetailMovement[];
  canViewLedger: boolean;
}) {
  return (
    <SectionCard
      title="Stock Movements"
      action={
        canViewLedger ? (
          <Button variant="outline" size="xs" asChild>
            <Link href={`/inventory/ledger?itemId=${item.id}`}>View Ledger</Link>
          </Button>
        ) : null
      }
    >
      {movements.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No stock movements recorded.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">
                <TooltipHeader label="Quantity" tooltip={LEDGER_CHANGE_TOOLTIP} />
              </TableHead>
              <TableHead>
                <TooltipHeader label="Lot" tooltip={LEDGER_LOT_TOOLTIP} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => {
              const quantity = parseFloat(movement.quantity);
              return (
                <TableRow key={movement.id}>
                  <TableCell className="font-mono text-muted-foreground">
                    <DateTimeText value={movement.createdAt} />
                  </TableCell>
                  <TableCell>{formatMovementType(movement.movementType)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono font-semibold",
                      quantity > 0
                        ? "text-success"
                        : quantity < 0
                          ? "text-destructive"
                          : "text-foreground"
                    )}
                  >
                    {quantity > 0 ? "+" : ""}
                    {formatQuantity(movement.quantity)}
                  </TableCell>
                  <TableCell className="font-mono">{movement.lotNumber ?? "\u2014"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

export function ItemDetail({
  item,
  itemType,
  bom,
  lots,
  movements,
  usedInParents,
  variants,
  canEdit = false,
  canViewBom = true,
  canViewLedger = false,
  commitmentSummary,
  activeTab = "overview",
}: ItemDetailProps) {
  const isMaster = item.isMaster === true;
  const isVariant = item.parentId != null;
  const headingTitle = item.displayName ?? item.name;
  const calculatedStock = calcStock(item);
  const basePath = `/inventory/${ITEM_TYPE_SEGMENTS[itemType]}`;
  const typeLabel = itemType === "product" ? "Products" : "Materials";

  if (isMaster) {
    const axes = item.variantAxes ?? [];
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Link
              href={basePath}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden /> Back to {typeLabel}
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
            <Badge variant="outline">Variant Master</Badge>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/inventory/products/${item.id}/edit`}>Edit</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href={`/inventory/products/${item.id}/variants/new`}>Add Variant</Link>
                </Button>
              </>
            )}
          </div>
        </div>
        <Separator />

        {item.description && (
          <p className="max-w-2xl text-sm text-muted-foreground">{item.description}</p>
        )}

        <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Category" tooltip={ITEM_CATEGORY_TOOLTIP} />
            </dt>
            <dd className="mt-1 text-sm">{item.category ?? "\u2014"}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">
              <TooltipHeader label="Variant Axes" tooltip={VARIANT_AXES_TOOLTIP} />
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {axes.length > 0
                ? axes.map((axis) => (
                    <Badge key={axis} variant="secondary">
                      {axis}
                    </Badge>
                  ))
                : "\u2014"}
            </dd>
          </div>
        </dl>

        <Separator />
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Variants
            {variants && variants.length > 0 && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                ({variants.length})
              </span>
            )}
          </h2>
          {variants && variants.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variant</TableHead>
                    <TableHead>
                      <TooltipHeader label="SKU" tooltip={ITEM_SKU_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Calculated Stock" tooltip={CALCULATED_STOCK_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Price" tooltip={SELLING_PRICE_TOOLTIP} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((v) => {
                    const attrLabel = axes.length > 0 && v.variantAttrs
                      ? axes.map((a) => v.variantAttrs![a]).filter(Boolean).join(" / ")
                      : v.name;
                    const calcStockVal = calcStock(v);
                    const isLow = calcStockVal < 0;
                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          <Link
                            href={`/inventory/products/${v.id}`}
                            className="font-medium hover:underline"
                          >
                            {attrLabel}
                          </Link>
                          {v.unit && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {v.unit}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {v.sku ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatQuantity(v.stock)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {isLow ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-end gap-1.5 text-destructive">
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
                                  {calcStockVal}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {CALCULATED_STOCK_ALERT_TOOLTIP}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            calcStockVal
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatPrice(v.defaultSellingPrice) ?? "\u2014"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No variants yet.{" "}
              <Link
                href={`/inventory/products/${item.id}/variants/new`}
                className="font-medium hover:underline"
              >
                Add the first one.
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  const tabs = [
    { value: "overview" as const, label: "Overview" },
    ...(itemType === "product"
      ? [{ value: "recipe" as const, label: "Recipe", count: bom?.length ?? 0 }]
      : []),
    { value: "lots" as const, label: "Lots", count: lots.length },
    { value: "movements" as const, label: "Movements", count: movements.length },
  ];

  return (
    <div className="min-h-full bg-muted/20">
        <div className="bg-card">
          <div className="mx-6 space-y-5 border-b pt-6">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
              <Link href={basePath} className="hover:text-foreground">
                {typeLabel}
              </Link>
              {isVariant && item.parentName ? (
                <>
                  <span>/</span>
                  <Link
                    href={`/inventory/products/${item.parentId}`}
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {item.parentName}
                  </Link>
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {headingTitle}
                  </h1>
                  {item.sku ? (
                    <Badge variant="secondary" className="font-mono">
                      {item.sku}
                    </Badge>
                  ) : null}
                  {item.category ? (
                    <Badge variant="secondary">{item.category}</Badge>
                  ) : null}
                  {itemType === "product" ? (
                    <Badge variant="secondary">{formatMode(item.manufacturingMode)}</Badge>
                  ) : (
                    <Badge variant="secondary">Material</Badge>
                  )}
                  {itemType === "product" && item.sellable === false ? (
                    <Badge variant="outline">Not sellable</Badge>
                  ) : null}
                  {itemType === "product" && item.bomLocked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"
                          aria-label="Locked recipe"
                        >
                          <HugeiconsIcon icon={CircleLock01Icon} size={14} strokeWidth={2} />
                          Locked recipe
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Only inventory admins can edit locked recipes.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                {item.description ? (
                  <p className="max-w-2xl text-sm text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ItemDetailActions
                  itemId={item.id}
                  itemType={itemType}
                  canEdit={canEdit}
                  canDelete={canEdit}
                  canViewLedger={canViewLedger}
                />
              </div>
            </div>

            <StockEquation item={item} calculatedStock={calculatedStock} />
          </div>
        </div>

        <ItemDetailTabs
          tabs={tabs}
          initialActiveTab={activeTab}
          panels={{
            overview: (
              <OverviewPanel
                item={item}
                itemType={itemType}
                lots={lots}
                usedInParents={usedInParents}
                commitmentSummary={commitmentSummary}
              />
            ),
            lots: <LotsPanel item={item} lots={lots} />,
            recipe:
              itemType === "product" ? (
                <RecipePanel
                  item={item}
                  bom={bom}
                  canViewBom={canViewBom}
                  basePath={basePath}
                />
              ) : null,
            movements: (
              <MovementsPanel
                item={item}
                movements={movements}
                canViewLedger={canViewLedger}
              />
            ),
          }}
        />
    </div>
  );
}
