"use client"

import * as React from "react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  WheelPicker,
  WheelPickerWrapper,
} from "@ncdai/react-wheel-picker"
import "@ncdai/react-wheel-picker/style.css"

import { cn } from "@/lib/utils"
import {
  formatLocalDateTimeInput,
  formatLongLocalDateTime,
  parseLocalDateTime,
} from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type DateTimePickerProps = {
  id?: string
  value?: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
}

type PickerStep = "date" | "time"

function timeOption(value: number): string {
  return String(value).padStart(2, "0")
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: timeOption(i),
  label: timeOption(i),
}))

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: timeOption(i),
  label: timeOption(i),
}))

function DateTimePicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "Pick a date and time",
  disabled,
  className,
  ...props
}: DateTimePickerProps) {
  const parsed = React.useMemo(() => parseLocalDateTime(value), [value])
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<PickerStep>("date")

  React.useEffect(() => {
    if (!open) setStep("date")
  }, [open])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) onBlur?.()
  }

  function handleDateSelect(nextDate?: Date) {
    if (!nextDate) {
      onChange("")
      setOpen(false)
      return
    }

    const next = new Date(nextDate)
    if (parsed) {
      next.setHours(
        parsed.getHours(),
        parsed.getMinutes(),
        parsed.getSeconds(),
        0
      )
    } else {
      next.setHours(0, 0, 0, 0)
    }

    onChange(formatLocalDateTimeInput(next))
    setStep("time")
  }

  function handleHourChange(hour: string) {
    if (!parsed) return
    const next = new Date(parsed)
    next.setHours(Number(hour), next.getMinutes(), next.getSeconds(), 0)
    onChange(formatLocalDateTimeInput(next))
  }

  function handleMinuteChange(minute: string) {
    if (!parsed) return
    const next = new Date(parsed)
    next.setHours(next.getHours(), Number(minute), next.getSeconds(), 0)
    onChange(formatLocalDateTimeInput(next))
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
          aria-label={props["aria-label"]}
          aria-invalid={props["aria-invalid"]}
        >
          {parsed ? formatLongLocalDateTime(parsed) : <span>{placeholder}</span>}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="inline-end"
            strokeWidth={2}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className={step !== "date" ? "h-0 overflow-hidden" : undefined}>
          <Calendar
            mode="single"
            selected={parsed}
            onSelect={handleDateSelect}
            defaultMonth={parsed ?? new Date()}
            showOutsideDays={false}
          />
        </div>
        {step === "time" && (
          <div className="flex flex-col gap-3 p-3">
            <WheelPickerWrapper>
              <WheelPicker
                options={HOUR_OPTIONS}
                value={parsed ? timeOption(parsed.getHours()) : "00"}
                onValueChange={handleHourChange}
              />
              <WheelPicker
                options={MINUTE_OPTIONS}
                value={parsed ? timeOption(parsed.getMinutes()) : "00"}
                onValueChange={handleMinuteChange}
              />
            </WheelPickerWrapper>
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("date")}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  onBlur?.()
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { DateTimePicker }
