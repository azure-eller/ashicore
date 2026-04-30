"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { Button } from "@/components/ui/button";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  AVAILABLE_QTY_TOOLTIP,
  MANUFACTURING_NEEDED_QTY_TOOLTIP,
  MANUFACTURING_SHORTAGE_TOOLTIP,
} from "@/lib/tooltip-copy";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";
import type { ManufacturingReleaseWarningPayload } from "./types";

type ApiError = {
  status: number;
  error: string;
  shortage?: ManufacturingReleaseWarningPayload;
};

export function MoStageAction({
  orderId,
  status,
}: {
  orderId: string;
  status: ManufacturingOrderStatus;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [releaseWarning, setReleaseWarning] =
    useState<ManufacturingReleaseWarningPayload | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasRequirementWarning =
    releaseWarning?.ingredients.some((ingredient) => ingredient.requirement) ??
    false;

  const releaseMutation = useMutation({
    mutationFn: async (confirmShortage: boolean) => {
      const response = await fetch(`/api/manufacturing-orders/${orderId}/release`, {
        method: "POST",
        headers: createIdempotencyHeaders(`manufacturing-order-release-${orderId}`, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ confirmShortage }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw {
          status: response.status,
          error: body?.error ?? "Failed to release order.",
          shortage: body?.shortage,
        } satisfies ApiError;
      }
    },
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["items"] }),
      ]);
      setReleaseWarning(null);
      router.refresh();
    },
    onError: (error: ApiError) => {
      if (error.status === 409 && error.shortage) {
        setReleaseWarning(error.shortage);
        return;
      }
      setActionError(error.error ?? "Failed to release order.");
    },
  });

  if (status === "draft") {
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            disabled={releaseMutation.isPending}
            onClick={(event) => {
              event.stopPropagation();
              releaseMutation.mutate(false);
            }}
          >
            {releaseMutation.isPending ? "Releasing..." : "Release"}
          </Button>
          {actionError ? (
            <p className="max-w-xs text-xs text-destructive">{actionError}</p>
          ) : null}
        </div>

        <AlertDialog
          open={releaseWarning != null}
          onOpenChange={(open) => {
            if (!open) setReleaseWarning(null);
          }}
        >
          <AlertDialogContent
            size="2xl"
            className="max-h-[calc(100vh-2rem)] overflow-y-auto bg-background text-foreground"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {hasRequirementWarning
                  ? "Release with warnings?"
                  : "Release with shortages?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {hasRequirementWarning
                  ? "Releasing is still allowed, but picking may need more eligible stock or confirmation."
                  : "Releasing is still allowed, but completion will require enough available ingredients."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Needed" tooltip={MANUFACTURING_NEEDED_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader label="Available" tooltip={AVAILABLE_QTY_TOOLTIP} />
                    </TableHead>
                    <TableHead className="text-right">
                      <TooltipHeader
                        label="Shortage"
                        tooltip={MANUFACTURING_SHORTAGE_TOOLTIP}
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releaseWarning?.ingredients.map((ingredient) => (
                    <TableRow key={ingredient.itemId}>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{ingredient.itemName}</p>
                          {ingredient.requirement ? (
                            <p className="text-xs text-muted-foreground">
                              {ingredient.requirement}
                              {ingredient.nextEligibleDate
                                ? ` Next eligible date: ${ingredient.nextEligibleDate}.`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {ingredient.needed} {ingredient.unitName}
                      </TableCell>
                      <TableCell className="text-right">
                        {ingredient.available} {ingredient.unitName}
                      </TableCell>
                      <TableCell className="text-right">
                        {ingredient.shortage} {ingredient.unitName}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <AlertDialogFooter>
              <Button variant="outline" asChild>
                <Link href="/purchasing/orders/new">Create PO</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/manufacturing/orders/new">Create MO</Link>
              </Button>
              <AlertDialogCancel>Back</AlertDialogCancel>
              <AlertDialogAction
                disabled={releaseMutation.isPending}
                onClick={() => releaseMutation.mutate(true)}
              >
                {releaseMutation.isPending ? "Releasing..." : "Release Anyway"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (status === "released") {
    return (
      <div className="flex justify-end">
        <Button size="sm" asChild>
          <Link href={`/manufacturing/orders/${orderId}/execute`}>Execute</Link>
        </Button>
      </div>
    );
  }

  return null;
}
