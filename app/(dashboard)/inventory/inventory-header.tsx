"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ITEM_TYPES, type ItemType } from "./types";

const tabs: { label: string; href: string; type: ItemType }[] = [
  { label: "Products", href: "/inventory/products", type: "product" },
  { label: "Materials", href: "/inventory/materials", type: "material" },
];

export function InventoryHeader() {
  const pathname = usePathname();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <nav className="flex items-center gap-4 text-sm">
          {tabs.map((tab) => {
            const isActive = pathname === tab.href;
            return isActive ? (
              <span
                key={tab.type}
                className="font-medium text-foreground"
              >
                {tab.label}
              </span>
            ) : (
              <Link
                key={tab.type}
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
