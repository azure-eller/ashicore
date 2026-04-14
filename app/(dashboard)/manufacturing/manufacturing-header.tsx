"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarCollapsedBar } from "@/components/sidebar-collapsed-bar";

const tabs = [
  { label: "Execution", href: "/manufacturing/execution" },
  { label: "Orders", href: "/manufacturing/orders" },
];

export function ManufacturingHeader() {
  const pathname = usePathname();

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
            const isActive =
              pathname.startsWith(tab.href) ||
              (tab.href === "/manufacturing/execution" &&
                pathname.startsWith("/manufacturing/orders/") &&
                pathname.includes("/execute"));
            return isActive ? (
              <span key={tab.href} className="font-medium text-foreground">
                {tab.label}
              </span>
            ) : (
              <Link
                key={tab.href}
                href={tab.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
