"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarCollapsedBar } from "@/components/sidebar-collapsed-bar";
import type { InventoryTabCounts } from "./types";

type InventoryHeaderProps = {
  counts: InventoryTabCounts;
};

export function InventoryHeader({ counts }: InventoryHeaderProps) {
  const pathname = usePathname();
  const tabs = [
    { label: "Products", href: "/inventory/products", count: counts.products },
    { label: "Materials", href: "/inventory/materials", count: counts.materials },
    { label: "Sub-assemblies", href: "/inventory/sub-assemblies", count: counts.subAssemblies },
    { label: "Stocktakes", href: "/inventory/stocktakes" },
  ];

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarCollapsedBar />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <nav className="flex items-center gap-4 text-sm">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.href);
            const content = (
              <>
                <span>{tab.label}</span>
                {typeof tab.count === "number" ? (
                  <Badge variant="outline" className="ml-1 text-xs font-normal">
                    {tab.count}
                  </Badge>
                ) : null}
              </>
            );

            return isActive ? (
              <span
                key={tab.href}
                className="inline-flex items-center font-medium text-foreground"
              >
                {content}
              </span>
            ) : (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch={false}
                className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
              >
                {content}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
