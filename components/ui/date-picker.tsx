"use client"

import * as React from "react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type DatePickerProps = {
  id?: string
  value?: string
  onChange?: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  "aria-invalid"?: boolean
  "aria-label"?: string
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0")
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined
  const m = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return undefined

  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])

  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined

  const date = new Date(y, mo - 1, d)
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return undefined
  }

  return date
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`
}

function formatDisplay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function DatePicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "Pick a date",
  disabled,
  className,
  ...props
}: DatePickerProps) {
  const parsed = React.useMemo(() => parseDate(value), [value])
  const [open, setOpen] = React.useState(false)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) onBlur?.()
  }

  function handleSelect(date?: Date) {
    onChange?.(date ? toDateString(date) : "")
    setOpen(false)
    onBlur?.()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!parsed}
          className={cn(
            "w-full justify-between text-left font-normal data-[empty=true]:text-muted-foreground",
            className
          )}
          {...props}
        >
          {parsed ? formatDisplay(parsed) : <span>{placeholder}</span>}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="inline-end"
            strokeWidth={2}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsed}
          onSelect={handleSelect}
          defaultMonth={parsed}
          showOutsideDays={false}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
