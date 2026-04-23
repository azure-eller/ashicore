"use client";

import { SidebarCollapsedBar } from "@/components/sidebar-collapsed-bar";

export function ManufacturingHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarCollapsedBar />
      </div>
    </header>
  );
}
