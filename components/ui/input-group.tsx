"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex h-(--height-input-md) w-full min-w-0 items-center rounded-md border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] transition-colors duration-(--duration-1) ease-(--ease-out) outline-none hover:border-[var(--color-ink-soft)] in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:shadow-none has-disabled:cursor-not-allowed has-disabled:border-transparent has-disabled:bg-[var(--color-surface-sunk)] has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:border-[var(--color-accent)] has-[[data-slot=input-group-control]:focus-visible]:shadow-[0_0_0_4px_var(--color-accent-soft)] has-[[data-slot][aria-invalid=true]]:border-[var(--color-danger)] has-[[data-slot][aria-invalid=true]]:shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger),transparent_88%)] has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto has-[>[data-align=block-end]]:[&>input]:pt-(--space-3) has-[>[data-align=block-start]]:[&>input]:pb-(--space-3) has-[>[data-align=inline-end]]:[&>input]:pr-(--space-3) has-[>[data-align=inline-start]]:[&>input]:pl-(--space-3)",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-(--space-4) py-(--space-3) text-[length:var(--text-sm)] font-medium text-[var(--color-ink-faint)] select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-md [&>svg:not([class*='size-'])]:size-(--space-7)",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-(--space-5) has-[>button]:ml-[calc(var(--space-3)*-1)] has-[>kbd]:ml-[calc(var(--space-2)*-1)]",
        "inline-end":
          "order-last pr-(--space-5) has-[>button]:mr-[calc(var(--space-3)*-1)] has-[>kbd]:mr-[calc(var(--space-2)*-1)]",
        "block-start":
          "order-first w-full justify-start px-(--space-5) pt-(--space-4) group-has-[>input]/input-group:pt-(--space-4) [.border-b]:pb-(--space-4)",
        "block-end":
          "order-last w-full justify-start px-(--space-5) pb-(--space-4) group-has-[>input]/input-group:pb-(--space-4) [.border-t]:pt-(--space-4)",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-(--space-4) text-[length:var(--text-sm)] shadow-none",
  {
    variants: {
      size: {
        xs: "h-(--height-input-sm) gap-(--space-2) rounded-md px-(--space-3) [&>svg:not([class*='size-'])]:size-(--space-7)",
        sm: "",
        "icon-xs":
          "size-(--space-10) rounded-md p-0 has-[>svg]:p-0",
        "icon-sm": "size-(--height-input-md) p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-(--space-4) text-[length:var(--text-sm)] text-[var(--color-ink-faint)] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-(--space-7)",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:shadow-none disabled:bg-transparent aria-invalid:shadow-none",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-(--space-4) shadow-none focus-visible:shadow-none disabled:bg-transparent aria-invalid:shadow-none",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
