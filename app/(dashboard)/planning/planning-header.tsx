"use client";

import { SidebarCollapsedBar } from "@/components/sidebar-collapsed-bar";

export function PlanningHeader() {
  return (
    <div className="pointer-events-none absolute left-0 top-0 z-30">
      <div className="pointer-events-auto">
        <SidebarCollapsedBar />
      </div>
    </div>
  );
}
