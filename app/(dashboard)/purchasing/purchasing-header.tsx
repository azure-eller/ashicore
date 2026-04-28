"use client";

import { usePathname } from "next/navigation";
import { NavigationLink } from "@/components/navigation-pending";
import { Separator } from "@/components/ui/separator";
import { SidebarCollapsedBar } from "@/components/sidebar-collapsed-bar";

const tabs = [
  { label: "Orders", href: "/purchasing/orders" },
  { label: "Suppliers", href: "/purchasing/suppliers" },
];

export function PurchasingHeader() {
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
            const isActive = pathname.startsWith(tab.href);
            return isActive ? (
              <span key={tab.href} className="font-medium text-foreground">
                {tab.label}
              </span>
            ) : (
              <NavigationLink
                key={tab.href}
                href={tab.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {tab.label}
              </NavigationLink>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
