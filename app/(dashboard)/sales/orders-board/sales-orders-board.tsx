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
import type { DeleteTarget } from "./sales-order-card";

export function SalesOrdersBoard({
  initialData,
}: {
  initialData: SalesOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
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
      }),
    [orders, search, showCancelled]
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

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Sales Orders</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kanban + Queue Control Room
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {filteredOrders.length} of {orders.length} orders
          </div>
        </div>

        <SalesOrdersBoardMetrics orders={orders} />

        <SalesOrdersBoardToolbar
          search={search}
          onSearchChange={setSearch}
          showCancelled={showCancelled}
          onShowCancelledChange={setShowCancelled}
          cancelledCount={cancelledCount}
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
