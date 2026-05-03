"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { DisabledTooltipButton } from "@/components/disabled-tooltip-button";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
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
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { itemDetailHref } from "@/app/(dashboard)/inventory/types";
import {
  ON_HAND_STOCK_TOOLTIP,
  OVERSELL_TOOLTIP_COPY,
  SALES_ADDED_QTY_TOOLTIP,
} from "@/lib/tooltip-copy";
import type {
  OversellWarningPayload,
  SalesOrderListRow,
} from "./types";

type ActionError = Error & {
  status: number;
  error: string;
  oversell?: OversellWarningPayload;
};

type Props = {
  order: Pick<
    SalesOrderListRow,
    | "id"
    | "status"
    | "hasManufacturableLines"
    | "shippingReadiness"
  >;
};

export function SoStageAction({ order }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [oversellWarning, setOversellWarning] =
    useState<OversellWarningPayload | null>(null);

  const refreshSalesList = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["items"] }),
    ]);
    router.refresh();
  };

  const confirmMutation = useMutation({
    mutationFn: async (confirmOversell: boolean) => {
      await apiJson<void>(`/api/sales-orders/${order.id}/confirm`, {
        method: "POST",
        idempotencyKey: `sales-order-confirm-${order.id}`,
        body: { confirmOversell },
        fallbackError: "Failed to confirm order.",
        mapError: (status, body) => {
          const payload = body as { error?: unknown; oversell?: OversellWarningPayload } | null;
          const message =
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to confirm order.";
          return Object.assign(new Error(message), {
            status,
            error: message,
            oversell: payload?.oversell,
          } satisfies Omit<ActionError, keyof Error>);
        },
      });
    },
    onMutate: () => {
      setActionError(null);
      setOversellWarning(null);
    },
    onSuccess: async () => {
      await refreshSalesList();
    },
    onError: (error: ActionError) => {
      if (error.status === 409 && error.oversell) {
        setOversellWarning(error.oversell);
        return;
      }

      setActionError(error);
    },
  });

  const errorMessage = actionError?.error ?? null;

  if (order.status === "draft") {
    return (
      <>
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={confirmMutation.isPending}
              onClick={(event) => {
                event.stopPropagation();
                confirmMutation.mutate(false);
              }}
            >
              {confirmMutation.isPending ? "Confirming..." : "Confirm"}
            </Button>
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
        </div>
        <AlertDialog
          open={oversellWarning != null}
          onOpenChange={(open) => {
            if (!open) {
              setOversellWarning(null);
            }
          }}
        >
          <AlertDialogContent
            size="content"
            className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Oversell?</AlertDialogTitle>
              <AlertDialogDescription>
                Confirming this order would oversell one or more items.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>
                      <TooltipHeader label="Current Stock" tooltip={ON_HAND_STOCK_TOOLTIP} />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Available"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentAvailable}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Reserved"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentReserved}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Demand"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentDemand}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Backorder"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentShortage}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Expected"
                        tooltip={OVERSELL_TOOLTIP_COPY.expected}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Safety"
                        tooltip={OVERSELL_TOOLTIP_COPY.safety}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Current Calculated"
                        tooltip={OVERSELL_TOOLTIP_COPY.currentCalculated}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader label="Added Qty" tooltip={SALES_ADDED_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Projected Demand"
                        tooltip={OVERSELL_TOOLTIP_COPY.projectedDemand}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Projected Backorder"
                        tooltip={OVERSELL_TOOLTIP_COPY.projectedShortage}
                      />
                    </TableHead>
                    <TableHead>
                      <TooltipHeader
                        label="Projected Calculated"
                        tooltip={OVERSELL_TOOLTIP_COPY.projectedCalculated}
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {oversellWarning?.products.map((product) => (
                    <TableRow key={product.itemId}>
                      <TableCell>
                        <Link
                          href={itemDetailHref("product", product.itemId)}
                          className="hover:underline"
                        >
                          <div className="font-medium">{product.itemName}</div>
                          {product.itemSku && (
                            <div className="text-xs text-muted-foreground">
                              {product.itemSku}
                            </div>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.inStock} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.availableQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.committedQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.demandQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.shortageQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.expectedQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.safetyStock} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.calculatedStock} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.addedQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell>
                        <QuantityWithUnit value={product.projectedDemandQty} unitName={product.unitName} />
                      </TableCell>
                      <TableCell
                        className={
                          product.projectedShortageQty > 0
                            ? "text-destructive"
                            : undefined
                        }
                      >
                        <QuantityWithUnit
                          value={product.projectedShortageQty}
                          unitName={product.unitName}
                          tone={product.projectedShortageQty > 0 ? "destructive" : "default"}
                        />
                      </TableCell>
                      <TableCell className="text-destructive">
                        <QuantityWithUnit
                          value={product.projectedCalculatedStock}
                          unitName={product.unitName}
                          tone="destructive"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate(true)}
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm Anyway"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (order.status === "confirmed") {
    const canCreateMOs = order.hasManufacturableLines;
    const shouldWaitForProduction = order.shippingReadiness.state === "in_production";

    return (
      <>
        <div className="flex items-center justify-end gap-2">
          <div className="flex flex-col items-end gap-1">
            {shouldWaitForProduction ? (
              <DisabledTooltipButton
                label="In production"
                tooltip={order.shippingReadiness.message}
              />
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sales/orders/${order.id}`}>Review</Link>
              </Button>
            )}
            {errorMessage ? (
              <Link
                href={`/sales/orders/${order.id}`}
                className="max-w-xs text-xs text-destructive hover:underline"
              >
                {errorMessage}
              </Link>
            ) : null}
          </div>
          {canCreateMOs ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/manufacturing/orders/new?salesOrderId=${order.id}`}>
                Create MOs
              </Link>
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  if (order.status === "partially_shipped") {
    return (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/sales/orders/${order.id}`}>Review</Link>
        </Button>
      </div>
    );
  }

  return null;
}
