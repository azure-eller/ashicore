"use client"

import * as React from "react"
import { Menubar as MenubarPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        "flex h-(--height-input-md) items-center gap-(--space-1) rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-1)",
        className
      )}
      {...props}
    />
  )
}

function MenubarMenu({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return (
    <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
  )
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "flex items-center rounded-[var(--radius-md)] px-(--space-3) py-(--space-1) text-[length:var(--text-sm)] font-medium text-[var(--color-ink)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) select-none hover:bg-[var(--color-surface-alt)] aria-expanded:bg-[var(--color-accent-soft)] aria-expanded:text-[var(--color-accent-ink)] focus-visible:shadow-[0_0_0_4px_var(--color-accent-soft)]",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPortal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn("z-50 min-w-36 origin-(--radix-menubar-content-transform-origin) overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-2) text-[var(--color-ink)] shadow-[var(--shadow-overlay)] duration-(--duration-2) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95", className )}
        {...props}
      />
    </MenubarPortal>
  )
}

function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/menubar-item relative flex cursor-default items-center gap-(--space-3) rounded-[var(--radius-md)] px-(--space-3) py-(--space-2) text-[length:var(--text-sm)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) select-none focus:bg-[var(--color-surface-alt)] focus:text-[var(--color-ink)] not-data-[variant=destructive]:focus:**:text-[var(--color-ink)] data-inset:pl-(--space-7) data-[variant=destructive]:text-[var(--status-danger-ink)] data-[variant=destructive]:focus:bg-[var(--color-danger-soft)] data-[variant=destructive]:focus:text-[var(--status-danger-ink)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--space-7) data-[variant=destructive]:*:[svg]:text-[var(--status-danger-ink)]!",
        className
      )}
      {...props}
    />
  )
}

function MenubarCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-(--space-3) rounded-[var(--radius-md)] py-(--space-2) pr-(--space-3) pl-(--space-7) text-[length:var(--text-sm)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) select-none focus:bg-[var(--color-accent-soft)] focus:text-[var(--color-accent-ink)] focus:**:text-[var(--color-accent-ink)] data-inset:pl-(--space-7) data-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-(--space-3) flex size-(--space-7) items-center justify-center [&_svg:not([class*='size-'])]:size-(--space-7)">
        <MenubarPrimitive.ItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  )
}

function MenubarRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-(--space-3) rounded-[var(--radius-md)] py-(--space-2) pr-(--space-3) pl-(--space-7) text-[length:var(--text-sm)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) select-none focus:bg-[var(--color-accent-soft)] focus:text-[var(--color-accent-ink)] focus:**:text-[var(--color-accent-ink)] data-inset:pl-(--space-7) data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--space-7)",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-(--space-3) flex size-(--space-7) items-center justify-center [&_svg:not([class*='size-'])]:size-(--space-7)">
        <MenubarPrimitive.ItemIndicator>
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  )
}

function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "px-(--space-3) py-(--space-2) text-[length:var(--text-sm)] font-medium data-inset:pl-(--space-7)",
        className
      )}
      {...props}
    />
  )
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-[var(--color-line)]", className)}
      {...props}
    />
  )
}

function MenubarShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "ml-auto text-[length:var(--text-xs)] tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] group-focus/menubar-item:text-[var(--color-ink)]",
        className
      )}
      {...props}
    />
  )
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />
}

function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-(--space-3) rounded-[var(--radius-md)] px-(--space-3) py-(--space-2) text-[length:var(--text-sm)] outline-none transition-colors duration-(--duration-1) ease-(--ease-out) select-none focus:bg-[var(--color-surface-alt)] focus:text-[var(--color-ink)] data-inset:pl-(--space-7) data-open:bg-[var(--color-accent-soft)] data-open:text-[var(--color-accent-ink)] [&_svg:not([class*='size-'])]:size-(--space-7)",
        className
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="ml-auto size-(--space-7)" />
    </MenubarPrimitive.SubTrigger>
  )
}

function MenubarSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.SubContent
      data-slot="menubar-sub-content"
      className={cn("z-50 min-w-32 origin-(--radix-menubar-content-transform-origin) overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-2) text-[var(--color-ink)] shadow-[var(--shadow-overlay)] duration-(--duration-2) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
      {...props}
    />
  )
}

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
}
