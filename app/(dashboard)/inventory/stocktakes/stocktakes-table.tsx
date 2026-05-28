"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { Copy01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DateTimeText } from "@/components/date-time-text";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/client/api";
import {
  STOCKTAKE_STATUS_COLUMN_TOOLTIP,
  STOCKTAKE_COUNTED_TOOLTIP,
  STOCKTAKE_ITEM_COUNT_TOOLTIP,
  STOCKTAKE_SCOPE_TOOLTIP,
  STOCKTAKE_VARIANCE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { StocktakeStatusBadge } from "./status-badge";
import { CreateStocktakeDialog } from "./create-stocktake-dialog";
import {
  formatCloneSkippedItemsWarning,
  formatScope,
  type CloneStocktakeResult,
  type StocktakeListRow,
} from "./types";

const columns: ColDef<StocktakeListRow>[] = [
  {
    field: "name",
    headerName: "Name",
    width: 280,
    minWidth: 200,
    flex: 1.2,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? (
        <Link href={`/inventory/stocktakes/${data.id}`} className="hover:underline">
          {data.name}
        </Link>
      ) : null,
  },
  {
    field: "scope",
    headerName: "Scope",
    headerTooltip: STOCKTAKE_SCOPE_TOOLTIP,
    width: 190,
    valueFormatter: ({ value }) => formatScope(value),
  },
  {
    field: "status",
    headerName: "Status",
    headerTooltip: STOCKTAKE_STATUS_COLUMN_TOOLTIP,
    width: 150,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <StocktakeStatusBadge status={data.status} /> : null,
  },
  {
    field: "itemCount",
    headerName: "Items",
    headerTooltip: STOCKTAKE_ITEM_COUNT_TOOLTIP,
    width: 120,
  },
  {
    colId: "countedCount",
    headerName: "Counted",
    headerTooltip: STOCKTAKE_COUNTED_TOOLTIP,
    width: 140,
    valueGetter: ({ data }) =>
      data ? `${data.countedCount} / ${data.itemCount}` : "",
    comparator: (_left, _right, leftNode, rightNode) =>
      (leftNode.data?.countedCount ?? 0) - (rightNode.data?.countedCount ?? 0),
  },
  {
    field: "varianceCount",
    headerName: "Variance",
    headerTooltip: STOCKTAKE_VARIANCE_TOOLTIP,
    width: 130,
  },
  {
    field: "createdAt",
    headerName: "Created",
    width: 190,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <DateTimeText value={data.createdAt} /> : null,
  },
  {
    field: "completedAt",
    headerName: "Completed",
    width: 190,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <DateTimeText value={data.completedAt} /> : null,
  },
  {
    colId: "actions",
    headerName: "",
    width: 54,
    minWidth: 48,
    maxWidth: 60,
    resizable: false,
    sortable: false,
    pinned: "right",
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <StocktakeRowActions stocktake={data} /> : null,
    getQuickFilterText: () => "",
  },
];

export function StocktakesTable({ initialData }: { initialData: StocktakeListRow[] }) {
  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
      queryKey={["stocktakes"]}
      queryFn={async () => {
        const response = await fetch("/api/stocktakes");
        if (!response.ok) {
          throw new Error("Failed to fetch stocktakes");
        }

        return response.json();
      }}
      searchAriaLabel="Search stocktakes"
      actions={<CreateStocktakeDialog />}
      emptyMessage="No stocktakes yet."
      deleteAction={{
        endpoint: "/api/stocktakes",
        invalidateQueryKeys: [["stocktakes"]],
        defaultErrorMessage: "Failed to delete stocktakes.",
        confirmTitle: (count) =>
          `Delete ${count} stocktake${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected draft stocktake${count !== 1 ? "s" : ""} will be removed from normal views. Completed stocktakes cannot be deleted.`,
        isRowSelectable: (row) => row.status === "draft",
      }}
    />
  );
}

function StocktakeRowActions({ stocktake }: { stocktake: StocktakeListRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const cloneMutation = useMutation({
    mutationFn: () =>
      apiJson<CloneStocktakeResult>(`/api/stocktakes/${stocktake.id}/clone`, {
        method: "POST",
        idempotencyKey: "stocktake-clone",
        fallbackError: "Failed to clone stocktake.",
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
      const warning = formatCloneSkippedItemsWarning(created);
      if (warning) window.alert(warning);
      router.push(`/inventory/stocktakes/${created.id}`);
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`More actions for ${stocktake.name}`}
        >
          <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-popover text-popover-foreground"
      >
        <DropdownMenuItem
          disabled={cloneMutation.isPending}
          onSelect={(event) => {
            event.preventDefault();
            cloneMutation.mutate();
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} className="h-4 w-4" aria-hidden />
          {cloneMutation.isPending ? "Cloning..." : "Clone"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
