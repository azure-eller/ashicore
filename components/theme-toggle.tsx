"use client"

import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import { Sun03Icon, Moon02Icon } from "@hugeicons/core-free-icons"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="group-data-[collapsible=icon]:hidden"
        >
          <HugeiconsIcon
            icon={theme === "dark" ? Sun03Icon : Moon02Icon}
            strokeWidth={2}
          />
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
