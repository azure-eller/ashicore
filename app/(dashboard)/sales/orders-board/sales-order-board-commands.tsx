"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateManufacturingOrdersDialog } from "../create-manufacturing-orders-dialog";
import type { SalesOrderListRow } from "../types";
import type { PrepareForShippingResponse } from "@/app/api/sales-orders/[id]/prepare-for-shipping/route";
import { useConfirmSalesOrderFlow } from "./use-confirm-sales-order-flow";
import type { SalesOrderDropCommand } from "./sales-order-drop-rules";

type PendingDrop = {
  command: SalesOrderDropCommand;
  order: SalesOrderListRow;
} | null;

export function useSalesOrderBoardCommands() {
  const [pendingDrop, setPendingDrop] = useState<PendingDrop>(null);

  return {
    openDropCommand: (command: SalesOrderDropCommand, order: SalesOrderListRow) => {
      if (command.type === "noop") return;
      setPendingDrop({ command, order });
    },
    dialogs: (
      <SalesOrderDropActionDialogs
        pendingDrop={pendingDrop}
        onPendingDropChange={setPendingDrop}
      />
    ),
  };
}

function SalesOrderDropActionDialogs({
  pendingDrop,
  onPendingDropChange,
}: {
  pendingDrop: PendingDrop;
  onPendingDropChange: (pendingDrop: PendingDrop) => void;
}) {
  if (!pendingDrop) return null;

  if (pendingDrop.command.type === "blocked") {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onPendingDropChange(null)}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDrop.command.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDrop.command.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDrop.command.suggestedAction ? (
            <p className="text-sm text-muted-foreground">
              Suggested action: {pendingDrop.command.suggestedAction}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => onPendingDropChange(null)}>
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (pendingDrop.command.type === "confirm-order") {
    return (
      <ConfirmDropDialog
        order={pendingDrop.order}
        onClose={() => onPendingDropChange(null)}
      />
    );
  }

  if (pendingDrop.command.type === "open-create-mos") {
    return (
      <CreateManufacturingOrdersDialog
        salesOrderId={pendingDrop.order.id}
        salesOrderLabel={`${pendingDrop.order.orderNumber} - ${pendingDrop.order.customerName}`}
        open
        onOpenChange={(open) => {
          if (!open) onPendingDropChange(null);
        }}
        showTrigger={false}
      />
    );
  }

  if (pendingDrop.command.type === "prepare-for-shipping") {
    return (
      <PrepareForShippingDialog
        order={pendingDrop.order}
        onClose={() => onPendingDropChange(null)}
        onCreateMos={() =>
          onPendingDropChange({
            command: { type: "open-create-mos", orderId: pendingDrop.order.id },
            order: pendingDrop.order,
          })
        }
      />
    );
  }

  if (pendingDrop.command.type === "open-ship-dialog") {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onPendingDropChange(null)}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Ship {pendingDrop.order.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Shipping is completed from the order detail shipment workflow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Link href={`/sales/orders/${pendingDrop.order.id}`}>Open Order</Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onPendingDropChange(null)}>
      <AlertDialogContent className="bg-background text-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>Move is not available</AlertDialogTitle>
          <AlertDialogDescription>
            This board action is not supported yet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onPendingDropChange(null)}>
            Close
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmDropDialog({
  order,
  onClose,
}: {
  order: SalesOrderListRow;
  onClose: () => void;
}) {
  const confirmFlow = useConfirmSalesOrderFlow(order.id, { onSuccess: onClose });

  return (
    <>
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {order.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmation will make the order live. The resulting lane will be
              determined by stock, production, and readiness after refresh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmFlow.errorMessage ? (
            <p className="text-sm text-destructive">{confirmFlow.errorMessage}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmFlow.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmFlow.confirm();
              }}
            >
              {confirmFlow.isPending ? "Confirming..." : "Confirm Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {confirmFlow.dialogs}
    </>
  );
}

function PrepareForShippingDialog({
  order,
  onClose,
  onCreateMos,
}: {
  order: SalesOrderListRow;
  onClose: () => void;
  onCreateMos: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [result, setResult] = useState<PrepareForShippingResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiJson<PrepareForShippingResponse>(
        `/api/sales-orders/${order.id}/prepare-for-shipping`,
        {
          method: "POST",
          fallbackError: "Failed to prepare order for shipping.",
        }
      ),
    onSuccess: async (response) => {
      setResult(response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["sales-order-detail", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      router.refresh();
    },
  });

  const blocked = result?.ok === false ? result : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="2xl" className="bg-background text-foreground">
        <DialogHeader>
          <DialogTitle>Prepare {order.orderNumber} for shipping?</DialogTitle>
          <DialogDescription>
            This checks current readiness and only uses available stock allocation
            rules. It will not set a ready status.
          </DialogDescription>
        </DialogHeader>
        {mutation.error ? (
          <p className="text-sm text-destructive">{mutation.error.message}</p>
        ) : null}
        {result?.ok ? (
          <p className="rounded-md border bg-card p-3 text-sm">
            {result.message ?? "Order is ready to ship."}
          </p>
        ) : null}
        {blocked ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The order is still blocked after checking current readiness.
            </p>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Needed</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Short</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocked.blockers.map((blocker, index) => (
                    <TableRow key={`${blocker.lineId}-${index}`}>
                      <TableCell>{blocker.itemName}</TableCell>
                      <TableCell className="text-right">{blocker.neededQty}</TableCell>
                      <TableCell className="text-right">
                        {blocker.availableQty}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {blocker.shortQty}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {blocked?.suggestedAction === "create_mos" && order.hasManufacturableLines ? (
            <Button type="button" variant="secondary" onClick={onCreateMos}>
              Create MOs
            </Button>
          ) : null}
          {!result ? (
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Checking..." : "Check Readiness"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
