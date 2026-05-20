"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import {
  SALES_SHIPMENT_COST_STATUSES,
  SALES_SHIPMENT_COST_TYPES,
  type SalesShipmentCostStatus,
  type SalesShipmentCostType,
} from "@/lib/schemas/sales-orders";
import type {
  SalesOrderDetail,
  SalesShipmentRow,
} from "@/app/(dashboard)/sales/types";

const COST_TYPE_LABELS: Record<SalesShipmentCostType, string> = {
  freight: "Freight",
  delivery_labor: "Delivery labor",
  fuel: "Fuel",
  packaging: "Packaging",
  accessorial: "Accessorial",
  other: "Other",
};

const COST_STATUS_LABELS: Record<SalesShipmentCostStatus, string> = {
  estimated: "Estimated",
  actual: "Actual",
};

type CostLine = {
  costType: SalesShipmentCostType;
  costStatus: SalesShipmentCostStatus;
  amount: string;
  vendorName: string;
  referenceNumber: string;
  incurredDate: string;
  notes: string;
};

function emptyCostLine(): CostLine {
  return {
    costType: "freight",
    costStatus: "estimated",
    amount: "",
    vendorName: "",
    referenceNumber: "",
    incurredDate: "",
    notes: "",
  };
}

export type ShipmentCostsDialogProps = {
  order: SalesOrderDetail;
  shipment: SalesShipmentRow | null;
  onClose: () => void;
};

export function ShipmentCostsDialog({ order, shipment, onClose }: ShipmentCostsDialogProps) {
  const open = shipment != null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        {shipment ? (
          <CostsForm order={order} shipment={shipment} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CostsForm({
  order,
  shipment,
  onClose,
}: {
  order: SalesOrderDetail;
  shipment: SalesShipmentRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [freight, setFreight] = useState(shipment.customerFreightChargeAmount ?? "");
  const [costs, setCosts] = useState<CostLine[]>(() =>
    shipment.costs.length > 0
      ? shipment.costs.map((cost) => ({
          costType: cost.costType,
          costStatus: cost.costStatus,
          amount: cost.amount,
          vendorName: cost.vendorName ?? "",
          referenceNumber: cost.referenceNumber ?? "",
          incurredDate: cost.incurredDate ?? "",
          notes: cost.notes ?? "",
        }))
      : [emptyCostLine()],
  );

  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", order.id, "shipment-costs", shipment.id),
    mutationFn: async () => {
      const payload = {
        customerFreightChargeAmount: freight.trim() === "" ? null : freight.trim(),
        costs: costs
          .filter((cost) => cost.amount.trim() !== "")
          .map((cost) => ({
            costType: cost.costType,
            costStatus: cost.costStatus,
            amount: cost.amount.trim(),
            vendorName: cost.vendorName.trim() || null,
            referenceNumber: cost.referenceNumber.trim() || null,
            incurredDate: cost.incurredDate || null,
            notes: cost.notes.trim() || null,
          })),
      };
      const response = await fetch(
        `/api/sales-orders/${order.id}/shipments/${shipment.id}/costs`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to save costs.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sales-order", order.id] });
      onClose();
    },
  });

  const updateCost = (index: number, patch: Partial<CostLine>) =>
    setCosts((prev) => prev.map((cost, i) => (i === index ? { ...cost, ...patch } : cost)));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Costs &amp; margin — {shipment.shipmentNumber}</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <label className="text-sm font-medium">Customer freight charge</label>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={freight}
          onChange={(event) => setFreight(event.target.value)}
          placeholder="0.00"
          className="max-w-48"
        />
      </div>

      <div className="space-y-2">
        {costs.map((cost, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-2 border border-[var(--color-line)] p-3 md:grid-cols-6"
          >
            <Select
              value={cost.costType}
              onValueChange={(value) =>
                updateCost(index, { costType: value as SalesShipmentCostType })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_SHIPMENT_COST_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {COST_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={cost.costStatus}
              onValueChange={(value) =>
                updateCost(index, { costStatus: value as SalesShipmentCostStatus })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_SHIPMENT_COST_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {COST_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={cost.amount}
              onChange={(event) => updateCost(index, { amount: event.target.value })}
              placeholder="Amount"
            />
            <Input
              value={cost.vendorName}
              onChange={(event) => updateCost(index, { vendorName: event.target.value })}
              placeholder="Vendor"
            />
            <Input
              value={cost.referenceNumber}
              onChange={(event) =>
                updateCost(index, { referenceNumber: event.target.value })
              }
              placeholder="Reference"
            />
            <div className="flex items-center gap-1">
              <Input
                value={cost.notes}
                onChange={(event) => updateCost(index, { notes: event.target.value })}
                placeholder="Notes"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setCosts((prev) =>
                    prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
                  )
                }
                aria-label="Remove cost line"
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCosts((prev) => [...prev, emptyCostLine()])}
        >
          <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
          Add cost
        </Button>
      </div>

      {mutation.isError ? (
        <p className="text-sm text-destructive">
          {(mutation.error as Error).message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save costs"}
        </Button>
      </DialogFooter>
    </form>
  );
}
