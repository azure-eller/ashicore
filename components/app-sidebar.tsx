"use client"

import * as React from "react"

import {
  canManageTeam,
  canReadModule,
  type AppRole,
} from "@/lib/authz"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { LocationSwitcher } from "@/components/location-switcher"
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
  Layers01Icon,
  PackageIcon,
  LayoutBottomIcon,
  Notification03Icon,
  Store04Icon,
  Settings02Icon,
  ShoppingBag02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"

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
  role: AppRole
}

export function AppSidebar({ user, role, ...props }: AppSidebarProps) {
  const locations = [
    {
      name: "Paonia Soil Co",
      logo: (
        <HugeiconsIcon icon={LayoutBottomIcon} strokeWidth={2} />
      ),
      plan: "Production",
    },
  ]

  const navMain = ([
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
    canManageTeam(role) ? {
      title: "Settings",
      url: "/settings",
      icon: (
        <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
      ),
      isActive: true,
      items: [
        {
          title: "Team",
          url: "/settings/team",
        },
      ],
    } : null,
  ] as Array<NavMainItem | null>).filter((item): item is NavMainItem => item !== null)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            <LocationSwitcher locations={locations} />
          </div>
          <div className="flex items-center group-data-[collapsible=icon]:hidden">
            <ThemeToggle />
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} className="h-4 w-4" />
              <span className="sr-only">Notifications</span>
            </Button>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} canManageTeam={canManageTeam(role)} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
