"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ListSettingIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { apiJson } from "@/lib/client/api";
import { formatDate, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  AllocationSourceRow,
  AllocationSourceType,
  AllocationWorkspace,
} from "@/lib/inventory/allocation/types";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";

const ALLOCATOR_PREFERENCE_ENDPOINT = "/api/preferences/sales-orders-allocator";
const OPEN_SALES_STATUSES = ["draft", "confirmed", "partially_shipped"] as const;

type AllocatorPreference = {
  hiddenProductIds: string[];
};

type AllocatorProduct = {
  itemId: string;
  label: string;
  sku: string | null;
  unitName: string;
};

type AllocationTarget = {
  order: SalesOrderListRow;
  line: SalesOrderListLine & { id: string };
  product: AllocatorProduct;
  targetQty: string;
};

type SourceDraft = Record<string, string>;

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function productLabel(line: SalesOrderListLine) {
  return line.attrs.length > 0
    ? `${line.masterName} ${line.attrs.join(" ")}`
    : line.masterName;
}

function sourceInputKey(source: Pick<AllocationSourceRow, "sourceType" | "sourceId">) {
  return `${source.sourceType}:${source.sourceId}`;
}

function sourceTypeLabel(sourceType: AllocationSourceType) {
  if (sourceType === "inventory_lot") return "Lots";
  return "Manufacturing orders";
}

function getLineRemainingQty(line: SalesOrderListLine) {
  return line.remainingQty ?? line.quantity;
}

function getLineAllocatedQty(line: SalesOrderListLine) {
  return line.allocatedQty ?? "0";
}

function getAllocationTone(line: SalesOrderListLine) {
  const remaining = parseQuantity(getLineRemainingQty(line));
  const allocated = parseQuantity(getLineAllocatedQty(line));
  const short = parseQuantity(line.shortQty);

  if (remaining <= 0) return "success";
  if (short <= 0) return "success";
  if (allocated > 0) return "warning";
  return "destructive";
}

function getAllocationCellClass(line: SalesOrderListLine) {
  const tone = getAllocationTone(line);
  if (tone === "success") return "border-success/30 bg-success/10 text-success";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

function groupSources(sources: AllocationSourceRow[]) {
  return [
    {
      sourceType: "inventory_lot" as const,
      label: sourceTypeLabel("inventory_lot"),
      sources: sources.filter((source) => source.sourceType === "inventory_lot"),
    },
    {
      sourceType: "manufacturing_order" as const,
      label: sourceTypeLabel("manufacturing_order"),
      sources: sources.filter(
        (source) => source.sourceType === "manufacturing_order"
      ),
    },
  ];
}

export function SalesOrderAllocator({ orders }: { orders: SalesOrderListRow[] }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AllocationTarget | null>(null);
  const openOrders = useMemo(() => orders.filter(isOpenSalesOrder), [orders]);

  const products = useMemo(() => {
    const byId = new Map<string, AllocatorProduct>();

    openOrders.forEach((order) => {
      order.lines.forEach((line) => {
        if (line.itemType !== "product") return;
        if (byId.has(line.itemId)) return;

        byId.set(line.itemId, {
          itemId: line.itemId,
          label: productLabel(line),
          sku: line.itemSku ?? null,
          unitName: line.unitName,
        });
      });
    });

    return [...byId.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [openOrders]);

  const preferenceQuery = useQuery({
    queryKey: ["sales-orders-allocator-preference"],
    queryFn: () =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        fallbackError: "Failed to load allocator preferences.",
      }),
    initialData: { hiddenProductIds: [] },
  });
  const hiddenProductIds = preferenceQuery.data.hiddenProductIds;
  const hiddenProductIdSet = useMemo(
    () => new Set(hiddenProductIds),
    [hiddenProductIds]
  );
  const visibleProducts = products.filter(
    (product) => !hiddenProductIdSet.has(product.itemId)
  );

  const preferenceMutation = useMutation({
    mutationFn: (nextHiddenProductIds: string[]) =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        method: "PUT",
        body: { hiddenProductIds: nextHiddenProductIds },
        fallbackError: "Failed to save allocator preferences.",
      }),
    onMutate: async (nextHiddenProductIds) => {
      await queryClient.cancelQueries({
        queryKey: ["sales-orders-allocator-preference"],
      });
      const previous = queryClient.getQueryData<AllocatorPreference>([
        "sales-orders-allocator-preference",
      ]);
      queryClient.setQueryData<AllocatorPreference>(
        ["sales-orders-allocator-preference"],
        { hiddenProductIds: nextHiddenProductIds }
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["sales-orders-allocator-preference"],
          context.previous
        );
      }
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(
        ["sales-orders-allocator-preference"],
        preference
      );
    },
  });

  function setProductHidden(productId: string, hidden: boolean) {
    const next = new Set(hiddenProductIds);
    if (hidden) {
      next.add(productId);
    } else {
      next.delete(productId);
    }
    preferenceMutation.mutate([...next]);
  }

  return (
    <>
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{openOrders.length} open</Badge>
            <Badge variant="outline">{visibleProducts.length} products</Badge>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Columns
                  <HugeiconsIcon
                    icon={ListSettingIcon}
                    className="h-4 w-4"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Product columns</DropdownMenuLabel>
                {products.length === 0 ? (
                  <div className="px-1.5 py-2 text-sm text-muted-foreground">
                    No open order products.
                  </div>
                ) : (
                  products.map((product) => (
                    <DropdownMenuCheckboxItem
                      key={product.itemId}
                      checked={!hiddenProductIdSet.has(product.itemId)}
                      onCheckedChange={(checked) =>
                        setProductHidden(product.itemId, checked !== true)
                      }
                    >
                      <span className="min-w-0 truncate">{product.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="default" size="sm" asChild>
              <Link href="/sales/orders/new" prefetch={false}>
                New Order
                <HugeiconsIcon
                  icon={Add01Icon}
                  className="h-4 w-4"
                  data-icon="inline-end"
                  aria-hidden
                />
              </Link>
            </Button>
          </div>
        </div>

        <div className="rounded-md border">
          <Table containerClassName="max-h-[calc(100vh-15rem)] overflow-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky top-0 left-0 z-40 min-w-48">
                  Customer
                </TableHead>
                <TableHead className="sticky top-0 left-48 z-40 min-w-32">
                  Order
                </TableHead>
                <TableHead className="sticky top-0 z-30 min-w-28">Ship</TableHead>
                <TableHead className="sticky top-0 z-30 min-w-28">Delivery</TableHead>
                <TableHead className="sticky top-0 z-30 min-w-32">Status</TableHead>
                {visibleProducts.map((product) => (
                  <TableHead
                    key={product.itemId}
                    className="sticky top-0 z-30 min-w-36 max-w-48"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate">{product.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {product.sku ?? product.unitName}
                      </span>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {openOrders.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5 + visibleProducts.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No open sales orders.
                  </TableCell>
                </TableRow>
              ) : (
                openOrders.map((order) => {
                  const lineByItemId = new Map(
                    order.lines
                      .filter((line): line is SalesOrderListLine & { id: string } =>
                        Boolean(line.id)
                      )
                      .map((line) => [line.itemId, line])
                  );

                  return (
                    <TableRow key={order.id}>
                      <TableCell className="sticky left-0 z-20 min-w-48 bg-background font-medium">
                        {order.customerName}
                      </TableCell>
                      <TableCell className="sticky left-48 z-20 min-w-32 bg-background">
                        <Link
                          href={`/sales/orders/${order.id}`}
                          className="hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(order.shipDate)}</TableCell>
                      <TableCell>{formatDate(order.requestedDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {order.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      {visibleProducts.map((product) => {
                        const line = lineByItemId.get(product.itemId);
                        return (
                          <TableCell key={product.itemId}>
                            {line ? (
                              <AllocatorCell
                                key={`${line.id}:${getLineAllocatedQty(line)}`}
                                line={line}
                                onCommit={(targetQty) =>
                                  setTarget({ order, line, product, targetQty })
                                }
                              />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AllocationSourceDialog
        target={target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      />
    </>
  );
}

function AllocatorCell({
  line,
  onCommit,
}: {
  line: SalesOrderListLine & { id: string };
  onCommit: (targetQty: string) => void;
}) {
  const allocatedQty = getLineAllocatedQty(line);
  const remainingQty = getLineRemainingQty(line);
  const [value, setValue] = useState(allocatedQty);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const next = value.trim();
    const parsed = Number(next);
    const remaining = parseQuantity(remainingQty);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter zero or a positive quantity.");
      return;
    }

    if (parsed > remaining) {
      setError(`Cannot allocate more than ${formatQuantity(remainingQty)}.`);
      return;
    }

    const normalized = quantityString(parsed);
    setValue(normalized);
    setError(null);

    if (normalized !== quantityString(parseQuantity(allocatedQty))) {
      onCommit(normalized);
    }
  }

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex h-8 w-32 items-center rounded-md border px-1.5",
          getAllocationCellClass(line)
        )}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          inputMode="decimal"
          aria-label={`Allocated ${line.masterName}`}
          className="h-6 border-0 bg-transparent px-0 text-right shadow-none focus-visible:ring-0"
        />
        <span className="px-1 text-muted-foreground">/</span>
        <span className="min-w-8 text-right text-sm">
          {formatQuantity(remainingQty)}
        </span>
      </div>
      {error ? <p className="max-w-36 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function AllocationSourceDialog({
  target,
  onOpenChange,
}: {
  target: AllocationTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const workspaceQuery = useQuery({
    queryKey: [
      "allocation-workspace",
      target?.line.id ?? null,
      target?.line.itemId ?? null,
    ],
    enabled: target != null,
    queryFn: () => {
      if (!target) {
        throw new Error("Allocation target missing.");
      }
      const params = new URLSearchParams({
        demandType: "sales_order_line",
        demandId: target.line.id,
        itemId: target.line.itemId,
      });
      return apiJson<AllocationWorkspace>(`/api/allocation/workspace?${params}`, {
        fallbackError: "Failed to load allocation sources.",
      });
    },
  });

  const workspace = workspaceQuery.data;

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent size="3xl" className="max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Allocate {target?.product.label}</DialogTitle>
          <DialogDescription>
            {target
              ? `${target.order.customerName} · ${target.order.orderNumber}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {workspaceQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Spinner className="text-foreground" />
          </div>
        ) : workspaceQuery.error ? (
          <p className="text-sm text-destructive">
            {workspaceQuery.error instanceof Error
              ? workspaceQuery.error.message
              : "Failed to load allocation sources."}
          </p>
        ) : (
          target &&
          workspace && (
            <AllocationSourceEditor
              key={`${target.line.id}:${target.targetQty}:${workspace.assignments
                .map((assignment) => `${sourceInputKey(assignment)}:${assignment.quantity}`)
                .join("|")}`}
              target={target}
              workspace={workspace}
              onSaved={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildInitialDraft(targetQty: number, workspace: AllocationWorkspace) {
  let remaining = targetQty;
  const nextDraft: SourceDraft = {};

  for (const assignment of workspace.primaryDemand?.assignments ?? []) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, parseQuantity(assignment.quantity));
    if (qty <= 0) continue;
    nextDraft[sourceInputKey(assignment)] = quantityString(qty);
    remaining -= qty;
  }

  return nextDraft;
}

function AllocationSourceEditor({
  target,
  workspace,
  onSaved,
  onCancel,
}: {
  target: AllocationTarget;
  workspace: AllocationWorkspace;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const targetQty = parseQuantity(target.targetQty);
  const [draft, setDraft] = useState(() => buildInitialDraft(targetQty, workspace));
  const [formError, setFormError] = useState<string | null>(null);
  const sourceGroups = groupSources(workspace.sources);
  const selectedTotal = Object.values(draft).reduce(
    (sum, value) => sum + parseQuantity(value),
    0
  );
  const remainingToAssign = targetQty - selectedTotal;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const total = Object.values(draft).reduce(
        (sum, value) => sum + parseQuantity(value),
        0
      );
      if (Math.abs(total - targetQty) > 0.0001) {
        throw new Error("Source quantities must match the target allocation.");
      }

      await apiJson<AllocationWorkspace>("/api/allocation/save", {
        method: "POST",
        body: {
          demandType: "sales_order_line",
          demandId: target.line.id,
          itemId: target.line.itemId,
          allocations: Object.entries(draft)
            .map(([key, value]) => {
              const [sourceType, sourceId] = key.split(":") as [
                AllocationSourceType,
                string,
              ];
              return {
                sourceType,
                sourceId,
                quantity: quantityString(parseQuantity(value)),
              };
            })
            .filter((allocation) => parseQuantity(allocation.quantity) > 0),
        },
        fallbackError: "Failed to save allocation.",
      });
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
        queryClient.invalidateQueries({ queryKey: ["allocation-workspace"] }),
      ]);
      onSaved();
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Failed to save allocation."
      );
    },
  });

  function updateSource(source: AllocationSourceRow, value: string) {
    const key = sourceInputKey(source);
    setDraft((current) => {
      const next = { ...current };
      const parsed = Number(value);
      if (value.trim() === "" || !Number.isFinite(parsed) || parsed <= 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  return (
    <>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Demand</div>
            <div className="font-medium">
              {formatQuantity(target.line.remainingQty ?? "0")} {target.line.unitName}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Target</div>
            <div className="font-medium">
              {formatQuantity(target.targetQty)} {target.line.unitName}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Remaining</div>
            <div
              className={cn(
                "font-medium",
                Math.abs(remainingToAssign) > 0.0001 && "text-destructive"
              )}
            >
              {formatQuantity(quantityString(remainingToAssign))} {target.line.unitName}
            </div>
          </div>
        </div>

        {sourceGroups.map((group) => (
          <div key={group.sourceType} className="space-y-2">
            <h3 className="text-sm font-medium">{group.label}</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="w-32 text-right">Allocate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.sources.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-16 text-center text-muted-foreground"
                      >
                        No sources.
                      </TableCell>
                    </TableRow>
                  ) : (
                    group.sources.map((source) => {
                      const key = sourceInputKey(source);
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{source.label}</span>
                              {source.contextLabel ? (
                                <span className="text-xs text-muted-foreground">
                                  {source.contextLabel}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(source.maxQtyForPrimaryDemand)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatQuantity(source.currentPrimaryQty)}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={draft[key] ?? ""}
                              onChange={(event) =>
                                updateSource(source, event.target.value)
                              }
                              inputMode="decimal"
                              aria-label={`Allocate from ${source.label}`}
                              className="text-right"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saveMutation.isPending || Math.abs(remainingToAssign) > 0.0001}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving..." : "Save allocation"}
        </Button>
      </DialogFooter>
    </>
  );
}
