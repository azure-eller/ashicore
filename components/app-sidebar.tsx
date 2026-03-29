"use client"

import * as React from "react"

import {
  canReadModule,
  type AppRole,
} from "@/lib/authz"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Activity02Icon,
  Layers01Icon,
  PackageIcon,
  LayoutBottomIcon,
  Store04Icon,
  ShoppingBag02Icon,
} from "@hugeicons/core-free-icons"

type NavMainItem = {
  title: string
  url: string
  icon?: React.ReactNode
  isActive?: boolean
  items?: {
    title: string
    url: string
  }[]
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: {
    name: string
    email: string
    avatar?: string
  }
  organizationName: string
  role: AppRole
}

export function AppSidebar({
  user,
  organizationName,
  role,
  ...props
}: AppSidebarProps) {
  const navMain = ([
    {
      title: "Operations",
      url: "/",
      icon: (
        <HugeiconsIcon icon={Activity02Icon} strokeWidth={2} />
      ),
    },
    canReadModule(role, "inventory") ? {
      title: "Inventory",
      url: "/inventory",
      icon: (
        <HugeiconsIcon icon={PackageIcon} strokeWidth={2} />
      ),
      isActive: true,
      items: [
        {
          title: "Products",
          url: "/inventory/products",
        },
        {
          title: "Materials",
          url: "/inventory/materials",
        },
        {
          title: "Stocktakes",
          url: "/inventory/stocktakes",
        },
      ],
    } : null,
    canReadModule(role, "sales") ? {
      title: "Sales",
      url: "/sales",
      icon: (
        <HugeiconsIcon icon={ShoppingBag02Icon} strokeWidth={2} />
      ),
      isActive: true,
      items: [
        {
          title: "Orders",
          url: "/sales/orders",
        },
        {
          title: "Customers",
          url: "/sales/customers",
        },
      ],
    } : null,
    canReadModule(role, "manufacturing") ? {
      title: "Manufacturing",
      url: "/manufacturing",
      icon: (
        <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} />
      ),
      isActive: true,
      items: [
        {
          title: "Orders",
          url: "/manufacturing/orders",
        },
      ],
    } : null,
    canReadModule(role, "purchasing") ? {
      title: "Purchasing",
      url: "/purchasing",
      icon: (
        <HugeiconsIcon icon={Store04Icon} strokeWidth={2} />
      ),
      isActive: true,
      items: [
        {
          title: "Orders",
          url: "/purchasing/orders",
        },
        {
          title: "Suppliers",
          url: "/purchasing/suppliers",
        },
      ],
    } : null,
  ] as Array<NavMainItem | null>).filter((item): item is NavMainItem => item !== null)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <HugeiconsIcon icon={LayoutBottomIcon} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-medium">{organizationName}</p>
              <p className="truncate text-xs text-muted-foreground">Single site</p>
            </div>
          </div>
          <div className="flex items-center group-data-[collapsible=icon]:hidden">
            <ThemeToggle />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
