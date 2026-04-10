"use client"

import { usePathname, useRouter } from "next/navigation"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PackageIcon,
  ShoppingBag02Icon,
  Layers01Icon,
  Store04Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar"

const modules = [
  {
    title: "Inventory",
    url: "/inventory",
    icon: PackageIcon,
    items: [
      { title: "Products", url: "/inventory/products" },
      { title: "Materials", url: "/inventory/materials" },
      { title: "Stocktakes", url: "/inventory/stocktakes" },
    ],
  },
  {
    title: "Sales",
    url: "/sales",
    icon: ShoppingBag02Icon,
    items: [
      { title: "Sales Orders", url: "/sales/orders" },
      { title: "Customers", url: "/sales/customers" },
      { title: "Pricing", url: "/sales/pricing" },
    ],
  },
  {
    title: "Manufacturing",
    url: "/manufacturing",
    icon: Layers01Icon,
    items: [
      { title: "Manufacturing Orders", url: "/manufacturing/orders" },
    ],
  },
  {
    title: "Purchasing",
    url: "/purchasing",
    icon: Store04Icon,
    items: [
      { title: "Purchase Orders", url: "/purchasing/orders" },
      { title: "Suppliers", url: "/purchasing/suppliers" },
    ],
  },
]

export function SidebarCollapsedBar() {
  const { isMobile, state } = useSidebar()
  const pathname = usePathname()
  const router = useRouter()
  const collapsed = state === "collapsed"

  if (isMobile) {
    return <SidebarTrigger className="-ml-1" />
  }

  return (
    <div className="relative flex items-center">
      <div
        data-sidebar-bar=""
        className={cn(
          "origin-left transition-all duration-300 ease-out",
          collapsed
            ? "scale-100 opacity-100"
            : "pointer-events-none absolute scale-75 opacity-0 -translate-x-2"
        )}
      >
        <Menubar className="h-auto gap-0.5 rounded-xl border-0 bg-sidebar p-1 shadow-lg ring-1 ring-sidebar-border">
          <SidebarTrigger className="size-8 cursor-pointer text-sidebar-foreground/70 hover:bg-sidebar-accent! hover:text-sidebar-accent-foreground!" />
          {modules.map((mod) => {
            const isModuleActive = pathname.startsWith(mod.url)
            return (
              <MenubarMenu key={mod.url}>
                <MenubarTrigger
                  className={cn(
                    "flex size-8 cursor-pointer items-center justify-center rounded-md p-0 transition-colors",
                    isModuleActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    "aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
                  )}
                >
                  <HugeiconsIcon icon={mod.icon} strokeWidth={2} className="size-4" />
                </MenubarTrigger>
                <MenubarContent
                  align="start"
                  sideOffset={8}
                  className="min-w-36 rounded-lg bg-sidebar text-sidebar-foreground shadow-lg ring-1 ring-sidebar-border"
                >
                  {mod.items.map((item) => {
                    const isActive = pathname.startsWith(item.url)
                    return (
                      <MenubarItem
                        key={item.url}
                        className={cn(
                          "cursor-pointer rounded-md px-2.5 py-1.5 text-sm",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/70 focus:bg-sidebar-accent focus:text-sidebar-accent-foreground"
                        )}
                        onSelect={() => router.push(item.url)}
                      >
                        {item.title}
                      </MenubarItem>
                    )
                  })}
                </MenubarContent>
              </MenubarMenu>
            )
          })}
        </Menubar>
      </div>
    </div>
  )
}
