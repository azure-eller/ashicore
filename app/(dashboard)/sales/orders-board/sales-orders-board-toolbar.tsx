"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SalesOrdersBoardToolbar({
  search,
  onSearchChange,
  showCancelled,
  onShowCancelledChange,
  cancelledCount,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  showCancelled: boolean;
  onShowCancelledChange: (value: boolean) => void;
  cancelledCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative w-full min-w-0 sm:w-80 lg:w-96">
        <HugeiconsIcon
          icon={Search01Icon}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search orders"
          placeholder="Search orders, customers, items..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-8"
        />
      </div>
      <div className="ml-auto flex items-center justify-end gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={showCancelled ? "secondary" : "outline"}
              size="icon-sm"
              aria-label={
                showCancelled
                  ? "Hide cancelled orders lane"
                  : `Show cancelled orders lane, ${cancelledCount} cancelled`
              }
              onClick={() => onShowCancelledChange(!showCancelled)}
              className="relative"
            >
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} className="size-4" />
              <Badge
                variant={showCancelled ? "default" : "secondary"}
                className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px]"
              >
                {cancelledCount}
              </Badge>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Cancelled orders.
          </TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="hidden h-7 sm:block" />
        <Button asChild size="sm">
          <Link href="/sales/orders/new" prefetch={false}>
            New Order
          </Link>
        </Button>
      </div>
    </div>
  );
}
