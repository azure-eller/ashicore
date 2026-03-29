"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function OperationsHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="data-vertical:h-4 data-vertical:self-auto"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">Operations</p>
          <p className="hidden truncate text-xs text-muted-foreground md:block">
            Monitor delivery risk, supply risk, and production pressure.
          </p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline">Owner view</Badge>
        <Badge variant="secondary">Next 14 Days</Badge>
      </div>
    </header>
  );
}
