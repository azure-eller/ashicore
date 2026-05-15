"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ManufacturingOrderStatus } from "@/lib/schemas/manufacturing-orders";

export function MoStageAction({
  orderId,
  status,
  trigger,
  triggerAriaLabel,
  menuAlign = "end",
}: {
  orderId: string;
  status: ManufacturingOrderStatus;
  trigger?: ReactNode;
  triggerAriaLabel?: string;
  menuAlign?: "start" | "center" | "end";
}) {
  if (trigger && status === "open") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
            aria-label={triggerAriaLabel ?? "Manufacturing order actions"}
          >
            {trigger}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={menuAlign} className="w-48">
          <DropdownMenuItem asChild className="py-2.5 text-lg">
            <Link href={`/manufacturing/orders/${orderId}/execute`}>Execute</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (status === "open") {
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
