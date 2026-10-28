'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const HOURS_12 = ['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null
  const [datePart, timePart] = value.split('T')
  if (!datePart || !timePart) return null
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return null
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function formatLocalDateTimeInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function getDisplayValue(date: Date | null, placeholder?: string) {
  if (!date) return placeholder || 'Set date and time'
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function DateTimePicker({
  value,
  onChange,
  disabled,
  className,
  placeholder,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const selected = useMemo(() => parseLocalDateTime(value), [value])
  const [viewDate, setViewDate] = useState<Date>(() => selected ?? new Date())
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (selected) setViewDate(selected)
  }, [selected])

  useEffect(() => {
    if (!open) return
    function updatePosition() {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(576, window.innerWidth - 32)
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16)
      const estimatedHeight = panelRef.current?.offsetHeight ?? 420
      const preferredTop = rect.bottom + 8
      const fitsBelow = preferredTop + estimatedHeight <= window.innerHeight - 16
      const top = fitsBelow ? preferredTop : Math.max(16, rect.top - estimatedHeight - 8)
      setPanelRect({ top, left, width })
    }
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    updatePosition()
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const selectedDate = selected ?? new Date()
  const selectedHour24 = selectedDate.getHours()
  const selectedMinute = selectedDate.getMinutes()
  const selectedIsPm = selectedHour24 >= 12
  const selectedHour12 = HOURS_12[selectedHour24 % 12]

  function updateDate(next: Date) {
    onChange(formatLocalDateTimeInput(next))
  }

  function withSelectedTime(base: Date) {
    const next = new Date(base)
    if (selected) {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0)
    } else {
      next.setHours(9, 0, 0, 0)
    }
    return next
  }

  function selectDay(day: number, monthOffset = 0) {
    const next = withSelectedTime(new Date(year, month + monthOffset, day))
    updateDate(next)
  }

  function setHour(hourLabel: string) {
    const current = selected ?? withSelectedTime(new Date())
    const hourNum = Number(hourLabel) % 12
    const hour24 = selectedIsPm ? hourNum + 12 : hourNum
    const next = new Date(current)
    next.setHours(hour24, current.getMinutes(), 0, 0)
    updateDate(next)
  }

  function setMinute(minuteLabel: string) {
    const current = selected ?? withSelectedTime(new Date())
    const next = new Date(current)
    next.setMinutes(Number(minuteLabel), 0, 0)
    updateDate(next)
  }

  function setMeridiem(nextPeriod: 'AM' | 'PM') {
    const current = selected ?? withSelectedTime(new Date())
    const hours = current.getHours()
    const isPm = hours >= 12
    if ((nextPeriod === 'PM' && isPm) || (nextPeriod === 'AM' && !isPm)) return
    const next = new Date(current)
    next.setHours(nextPeriod === 'PM' ? hours + 12 : hours - 12)
    updateDate(next)
  }

  function clearValue() {
    onChange('')
    setOpen(false)
  }

  function setToday() {
    const now = new Date()
    const next = selected ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), selected.getHours(), selected.getMinutes()) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0)
    updateDate(next)
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        className={cn(
          'flex h-10 w-full items-center gap-2.5 rounded-xl border px-3 text-left shadow-sm transition-all',
          disabled && 'cursor-not-allowed opacity-70'
        )}
        style={{
          borderColor: open ? 'color-mix(in srgb, var(--theme-primary) 55%, var(--theme-surface-border))' : 'var(--theme-surface-border)',
          backgroundColor: 'var(--theme-card-bg)',
          color: selected ? 'var(--theme-card-text)' : 'var(--theme-muted-text)',
          boxShadow: open ? '0 0 0 3px color-mix(in srgb, var(--theme-primary) 14%, transparent), var(--shadow-sm)' : 'var(--shadow-sm)',
        }}
      >
        <CalendarClock size={16} style={{ color: 'var(--theme-primary-text)' }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {getDisplayValue(selected, placeholder)}
        </span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 transition-transform', open && 'rotate-180')}
          style={{ color: 'var(--theme-muted-text)' }}
        />
      </button>

      {open && panelRect && createPortal((
        <div
          ref={panelRef}
          className="fixed z-[240] overflow-hidden rounded-[20px] border shadow-xl"
          style={{
            top: panelRect.top,
            left: panelRect.left,
            width: panelRect.width,
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            boxShadow: 'var(--shadow-xl)',
          }}
        >
          <div className="grid gap-0 md:grid-cols-[1.2fr_0.8fr]">
            <div className="border-b p-3 md:border-b-0 md:border-r" style={{ borderColor: 'var(--theme-surface-border)' }}>
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setViewDate(new Date(year, month - 1, 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewDate(selected ?? new Date())}
                  className="flex items-center gap-1 text-sm font-semibold"
                  style={{ color: 'var(--theme-card-text)' }}
                >
                  {MONTHS[month]} {year}
                  <ChevronDown size={13} style={{ color: 'var(--theme-muted-text)' }} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewDate(new Date(year, month + 1, 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center">
                {DAYS.map((day, index) => (
                  <div key={`${day}-${index}`} className="py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                    {day}
                  </div>
                ))}

                {Array.from({ length: firstDay }, (_, index) => {
                  const day = daysInPrevMonth - firstDay + index + 1
                  return (
                    <button
                      key={`prev-${day}`}
                      type="button"
                      onClick={() => selectDay(day, -1)}
                      className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-xs transition-opacity hover:opacity-75"
                      style={{ color: 'color-mix(in srgb, var(--theme-muted-text) 80%, transparent)' }}
                    >
                      {day}
                    </button>
                  )
                })}

                {Array.from({ length: daysInMonth }, (_, index) => {
                  const day = index + 1
                  const dateObj = new Date(year, month, day)
                  const isSelected = !!selected &&
                    dateObj.getFullYear() === selected.getFullYear() &&
                    dateObj.getMonth() === selected.getMonth() &&
                    dateObj.getDate() === selected.getDate()
                  const isToday = dateObj.getTime() === today.getTime()

                  return (
                    <button
                      key={`day-${day}`}
                      type="button"
                      onClick={() => selectDay(day)}
                      className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-xs font-medium transition-all hover:opacity-85"
                      style={{
                        backgroundColor: isSelected ? 'var(--theme-primary-light)' : isToday ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : 'transparent',
                        color: isSelected ? 'var(--theme-primary-text)' : 'var(--theme-card-text)',
                        boxShadow: isSelected ? 'inset 0 0 0 2px var(--theme-primary)' : 'none',
                      }}
                    >
                      {day}
                    </button>
                  )
                })}

                {Array.from({ length: 42 - (firstDay + daysInMonth) }, (_, index) => {
                  const day = index + 1
                  return (
                    <button
                      key={`next-${day}`}
                      type="button"
                      onClick={() => selectDay(day, 1)}
                      className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-xs transition-opacity hover:opacity-75"
                      style={{ color: 'color-mix(in srgb, var(--theme-muted-text) 80%, transparent)' }}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 flex items-center justify-between border-t pt-2.5" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <button type="button" onClick={clearValue} className="text-xs font-medium transition-opacity hover:opacity-75" style={{ color: 'var(--theme-primary-text)' }}>
                  Clear
                </button>
                <button type="button" onClick={setToday} className="text-xs font-medium transition-opacity hover:opacity-75" style={{ color: 'var(--theme-primary-text)' }}>
                  Today
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3">
              <TimeColumn label="Hour" items={HOURS_12} selected={selectedHour12} onSelect={setHour} />
              <TimeColumn label="Minute" items={MINUTES} selected={String(selectedMinute).padStart(2, '0')} onSelect={setMinute} />
              <TimeColumn label="Period" items={['AM', 'PM']} selected={selectedIsPm ? 'PM' : 'AM'} onSelect={(item) => setMeridiem(item as 'AM' | 'PM')} />
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

function TimeColumn({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string
  items: string[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
        {label}
      </div>
      <div className="max-h-[16rem] space-y-1 overflow-y-auto pr-1">
        {items.map((item) => {
          const active = item === selected
          return (
            <button
              key={item}
              type="button"
              onClick={() => onSelect(item)}
              className="flex h-9 w-full items-center justify-center rounded-lg text-sm font-semibold transition-all hover:opacity-85"
              style={{
                backgroundColor: active ? 'var(--theme-surface)' : 'transparent',
                color: active ? 'var(--theme-card-text)' : 'var(--theme-card-text)',
                boxShadow: active ? 'inset 0 0 0 1px var(--theme-surface-border)' : 'none',
              }}
            >
              {item}
            </button>
          )
        })}
      </div>
    </div>
  )
}
