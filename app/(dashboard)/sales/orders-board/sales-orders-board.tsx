"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SalesOrderListRow } from "../types";
import { filterOrdersForBoard } from "./sales-order-board-filters";
import { useSalesOrderBoardCommands } from "./sales-order-board-commands";
import { SalesOrderKanban } from "./sales-order-kanban";
import { SalesOrdersBoardFooter } from "./sales-orders-board-footer";
import { SalesOrdersBoardMetrics } from "./sales-orders-board-metrics";
import { SalesOrdersBoardToolbar } from "./sales-orders-board-toolbar";
import {
  ACTIVE_LANE_DEFINITIONS,
  CANCELLED_LANE_DEFINITION,
  groupSalesOrdersByLane,
} from "./sales-order-lane-model";
import {
  getProductLensOptions,
  orderContainsProductLensItem,
} from "./sales-order-product-lens";
import type { DeleteTarget } from "./sales-order-card";

export function SalesOrdersBoard({
  initialData,
}: {
  initialData: SalesOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [showUnallocateAllDialog, setShowUnallocateAllDialog] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const boardCommands = useSalesOrderBoardCommands();

  const { data: orders = initialData } = useQuery<SalesOrderListRow[]>({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });

  const cancelledCount = useMemo(
    () => orders.filter((order) => order.status === "cancelled").length,
    [orders]
  );
  const filteredOrders = useMemo(
    () =>
      filterOrdersForBoard(orders, {
        search,
        laneFilter: "all",
        customerFilter: "all",
        showCancelled,
        sortMode: "shipDate",
      }).filter((order) => orderContainsProductLensItem(order, selectedItemId)),
    [orders, search, showCancelled, selectedItemId]
  );
  const productLensOptions = useMemo(
    () => getProductLensOptions(orders.filter((order) => order.status !== "cancelled")),
    [orders]
  );
  const visibleLanes = useMemo(
    () =>
      showCancelled
      ? [...ACTIVE_LANE_DEFINITIONS, CANCELLED_LANE_DEFINITION]
      : ACTIVE_LANE_DEFINITIONS,
    [showCancelled]
  );
  const ordersByLane = useMemo(
    () => groupSalesOrdersByLane(filteredOrders),
    [filteredOrders]
  );
  const allocatedLineCount = useMemo(
    () =>
      orders
        .filter((order) =>
          ["draft", "confirmed", "partially_shipped"].includes(order.status)
        )
        .flatMap((order) => order.lines)
        .filter((line) => Number(line.allocatedQty ?? 0) > 0).length,
    [orders]
  );

  const deleteMutation = useMutation({
    mutationFn: async (target: NonNullable<DeleteTarget>) => {
      await apiJson<void>("/api/sales-orders", {
        method: "DELETE",
        idempotencyKey: "sales-orders-delete",
        body: { ids: [target.id] },
        fallbackError: "Failed to delete order.",
      });
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setDeleteTarget(null);
    },
    onError: (error) => {
      setFormError(error.message);
    },
  });

  const unallocateAllMutation = useMutation({
    mutationFn: async () => {
      await apiJson<void>("/api/sales-orders/allocations", {
        method: "DELETE",
        idempotencyKey: "sales-orders-unallocate-all",
        fallbackError: "Failed to unallocate sales orders.",
      });
    },
    onMutate: () => {
      setFormError(null);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setShowUnallocateAllDialog(false);
    },
    onError: (error) => {
      setFormError(error.message);
    },
  });

  return (
    <>
      <div className="space-y-4">
        <SalesOrdersBoardMetrics orders={orders} />

        <SalesOrdersBoardToolbar
          search={search}
          onSearchChange={setSearch}
          productLensOptions={productLensOptions}
          selectedItemId={selectedItemId}
          onSelectedItemIdChange={(itemId) => {
            setSelectedItemId(itemId);
            setExpandedOrderId(null);
          }}
          showCancelled={showCancelled}
          onShowCancelledChange={setShowCancelled}
          cancelledCount={cancelledCount}
          allocatedLineCount={allocatedLineCount}
          onUnallocateAll={() => setShowUnallocateAllDialog(true)}
          isUnallocatingAll={unallocateAllMutation.isPending}
          resultCount={filteredOrders.length}
          totalCount={orders.length}
        />

        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        {filteredOrders.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {search ? `No results for "${search}"` : "No orders match the current filters."}
          </div>
        ) : null}

        <SalesOrderKanban
          visibleLanes={visibleLanes}
          ordersByLane={ordersByLane}
          selectedItemId={selectedItemId}
          expandedOrderId={expandedOrderId}
          density="compact"
          onToggleExpanded={(orderId) =>
            setExpandedOrderId((current) => (current === orderId ? null : orderId))
          }
          onDelete={setDeleteTarget}
          onDropCommand={boardCommands.openDropCommand}
        />

        <SalesOrdersBoardFooter
          filteredCount={filteredOrders.length}
          totalCount={orders.length}
        />
      </div>

      {boardCommands.dialogs}

      <AlertDialog
        open={showUnallocateAllDialog}
        onOpenChange={(open) => {
          if (!open) setShowUnallocateAllDialog(false);
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Unallocate all sales orders?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears allocations for all open sales orders on the board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep allocations</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unallocateAllMutation.isPending}
              onClick={() => unallocateAllMutation.mutate()}
            >
              {unallocateAllMutation.isPending ? "Unallocating..." : "Unallocate all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This order will be soft-deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending || deleteTarget == null}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
