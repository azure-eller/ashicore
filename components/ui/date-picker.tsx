"use client"

import * as React from "react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { cn } from "@/lib/utils"
import {
  formatLocalDateInput,
  formatLongLocalDate,
  parseLocalDate,
} from "@/lib/format"
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
  const parsed = React.useMemo(() => parseLocalDate(value), [value])
  const [open, setOpen] = React.useState(false)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) onBlur?.()
  }

  function handleSelect(date?: Date) {
    onChange?.(date ? formatLocalDateInput(date) : "")
    setOpen(false)
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
            "w-full justify-between text-left font-normal data-[empty=true]:text-[var(--color-ink-faint)]",
            className
          )}
          {...props}
        >
          {parsed ? formatLongLocalDate(parsed) : <span>{placeholder}</span>}
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
