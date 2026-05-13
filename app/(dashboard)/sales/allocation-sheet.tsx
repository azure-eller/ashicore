"use client";

import { AllocationManagerSheet } from "@/components/allocation-manager/allocation-manager-sheet";

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
    />
  );
}
