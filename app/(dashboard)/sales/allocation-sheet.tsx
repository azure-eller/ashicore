"use client";

import { AllocationManagerSheet } from "@/components/allocation-manager/allocation-manager-sheet";
import { CreateManufacturingOrdersDialog } from "./create-manufacturing-orders-dialog";

type Props = {
  lineId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetLineChange: (lineId: string) => void;
  outputManufacturingOrderId?: string | null;
  onOutputManufacturingOrderChange?: (id: string | null) => void;
};

export function AllocationSheet({
  lineId,
  open,
  onOpenChange,
  onTargetLineChange,
  outputManufacturingOrderId,
  onOutputManufacturingOrderChange,
}: Props) {
  return (
    <AllocationManagerSheet
      open={open}
      onOpenChange={onOpenChange}
      demandRef={
        lineId == null
          ? undefined
          : { demandType: "sales_order_line", demandId: lineId }
      }
      onTargetLineChange={onTargetLineChange}
      outputManufacturingOrderId={outputManufacturingOrderId}
      onOutputManufacturingOrderChange={onOutputManufacturingOrderChange}
      renderCreateManufacturingOrderAction={(props) => (
        <CreateManufacturingOrdersDialog
          salesOrderId={props.parentDemandId}
          salesOrderLabel={props.parentDemandLabel}
          initialPlannedDate={props.initialPlannedDate}
          openManufacturingOrders={props.openManufacturingOrders}
          initialLineQuantities={props.initialDemandQuantities.map((demand) => ({
            salesOrderLineId: demand.demandId,
            quantity: demand.quantity,
          }))}
          buttonLabel="Add MO"
          buttonVariant="outline"
          buttonSize="lg"
          buttonClassName="h-20 w-full flex-col border-dashed bg-card text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground [&_svg]:size-5"
        />
      )}
    />
  );
}
