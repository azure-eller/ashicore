"use client";

import { SegmentedCountFilter } from "@/components/segmented-count-filter";

export type WorkflowStatusFilterValue = "open" | "done";

export function WorkflowStatusFilter({
  value,
  openCount,
  doneCount,
  ariaLabel,
  openAriaLabel = "Show open orders",
  doneAriaLabel = "Show done orders",
  onValueChange,
}: {
  value: WorkflowStatusFilterValue;
  openCount: number;
  doneCount: number;
  ariaLabel: string;
  openAriaLabel?: string;
  doneAriaLabel?: string;
  onValueChange: (value: WorkflowStatusFilterValue) => void;
}) {
  return (
    <SegmentedCountFilter
      value={value}
      options={[
        {
          value: "open",
          label: "Open",
          count: openCount,
          ariaLabel: openAriaLabel,
        },
        {
          value: "done",
          label: "Done",
          count: doneCount,
          ariaLabel: doneAriaLabel,
        },
      ]}
      onValueChange={(nextValue) => {
        if (nextValue === "open" || nextValue === "done") {
          onValueChange(nextValue);
        }
      }}
      ariaLabel={ariaLabel}
    />
  );
}
