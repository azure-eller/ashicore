"use client"

import dynamic from "next/dynamic"
import * as React from "react"

import { canReadModule } from "@/lib/authz"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Layers01Icon,
  PackageIcon,
  Store04Icon,
  ShoppingBag02Icon,
} from "@hugeicons/core-free-icons"

const AgentChatPanel = dynamic(
  () =>
    import("@/components/agent/agent-chat-panel").then(
      (module) => module.AgentChatPanel
    ),
  { ssr: false }
)

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
  assignedRoles: string[]
  agentEnabled?: boolean
}

export function AppSidebar({
  user,
  organizationName,
  assignedRoles,
  agentEnabled = false,
  ...props
}: AppSidebarProps) {
  const navMain = ([
    canReadModule(assignedRoles, "inventory") ? {
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
          title: "Sub-assemblies",
          url: "/inventory/sub-assemblies",
        },
        {
          title: "Stocktakes",
          url: "/inventory/stocktakes",
        },
      ],
    } : null,
    canReadModule(assignedRoles, "sales") ? {
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
        {
          title: "Pricing",
          url: "/sales/pricing",
        },
      ],
    } : null,
    canReadModule(assignedRoles, "manufacturing") ? {
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
    canReadModule(assignedRoles, "purchasing") ? {
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

  const [chatExpanded, setChatExpanded] = React.useState(false)

  return (
    <Sidebar collapsible="icon" variant="floating" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <NavUser user={user} organizationName={organizationName} />
          </div>
          <SidebarTrigger className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden">
        <ScrollArea
          type="auto"
          aria-hidden={chatExpanded}
          className={cn(
            "min-h-0 overflow-hidden transition-[max-height,opacity] duration-300 ease-out group-data-[collapsible=icon]:hidden",
            chatExpanded
              ? "pointer-events-none max-h-0 opacity-0"
              : "flex-1 opacity-100"
          )}
        >
          <NavMain items={navMain} />
        </ScrollArea>

        {agentEnabled ? (
          <AgentChatPanel
            className="flex-1 basis-0 min-h-0 group-data-[collapsible=icon]:hidden"
            expanded={chatExpanded}
            onComposerFocus={() => setChatExpanded(true)}
            onComposerBlur={() => setChatExpanded(false)}
          />
        ) : null}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
