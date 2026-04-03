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

function padTwo(n: number): string {
  return String(n).padStart(2, "0")
}

function toIsoLocal(date: Date): string {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}T${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`
}

function parseLocal(value?: string): Date | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const m = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  )
  if (!m) return undefined

  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const h = m[4] != null ? Number(m[4]) : 0
  const mi = m[5] != null ? Number(m[5]) : 0
  const s = m[6] != null ? Number(m[6]) : 0

  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  if (h > 23 || mi > 59 || s > 59) return undefined

  const date = new Date(y, mo - 1, d, h, mi, s, 0)

  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return undefined
  }

  return date
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: padTwo(i),
  label: padTwo(i),
}))

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: padTwo(i),
  label: padTwo(i),
}))

function formatDisplay(date: Date): string {
  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  return `${dateStr} at ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`
}

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
  const parsed = React.useMemo(() => parseLocal(value), [value])
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

    onChange(toIsoLocal(next))
    setStep("time")
  }

  function handleHourChange(hour: string) {
    if (!parsed) return
    const next = new Date(parsed)
    next.setHours(Number(hour), next.getMinutes(), next.getSeconds(), 0)
    onChange(toIsoLocal(next))
  }

  function handleMinuteChange(minute: string) {
    if (!parsed) return
    const next = new Date(parsed)
    next.setHours(next.getHours(), Number(minute), next.getSeconds(), 0)
    onChange(toIsoLocal(next))
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
          aria-label={props["aria-label"]}
          aria-invalid={props["aria-invalid"]}
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
                value={parsed ? padTwo(parsed.getHours()) : "00"}
                onValueChange={handleHourChange}
              />
              <WheelPicker
                options={MINUTE_OPTIONS}
                value={parsed ? padTwo(parsed.getMinutes()) : "00"}
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
