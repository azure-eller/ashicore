"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  DeliveryTruck02Icon,
  Factory01Icon,
  PackageIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

const LEGEND = [
  {
    label: "In Stock",
    icon: PackageIcon,
    className: "bg-success/20 text-success",
  },
  {
    label: "Shortage",
    icon: AlertCircleIcon,
    className: "bg-warning/20 text-warning",
  },
  {
    label: "Make-to-Order",
    icon: Factory01Icon,
    className: "bg-primary/15 text-primary",
  },
  {
    label: "Ready",
    icon: CheckmarkCircle02Icon,
    className: "bg-success/20 text-success",
  },
  {
    label: "Shipped",
    icon: DeliveryTruck02Icon,
    className: "bg-info/20 text-info",
  },
];

export function SalesOrdersBoardFooter({
  filteredCount,
  totalCount,
}: {
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-2 text-xs text-muted-foreground">
      <div className="shrink-0">
        Showing {filteredCount === 0 ? "0" : `1-${filteredCount}`} of {totalCount} orders
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="hidden items-center gap-1 rounded-full border bg-card/70 px-2 py-1 md:flex">
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1 px-1.5">
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-md",
                  item.className
                )}
              >
                <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-3" />
              </span>
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
