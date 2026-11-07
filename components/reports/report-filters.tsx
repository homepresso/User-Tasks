'use client'

import { SegmentedControl } from '@/components/ui/segmented-control'

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'YTD', days: -1 },
  { label: 'All time', days: 0 },
]

interface ReportFiltersProps {
  days: number
  onDaysChange: (days: number) => void
}

export function ReportDateFilter({ days, onDaysChange }: ReportFiltersProps) {
  return (
    <SegmentedControl
      aria-label="Period"
      size="sm"
      value={String(days)}
      onValueChange={(v) => onDaysChange(Number(v))}
      options={PRESETS.map((p) => ({ value: String(p.days), text: p.label }))}
    />
  )
}

export function getDateFrom(days: number): Date | null {
  if (days === 0) return null // all time
  const d = new Date()
  if (days === -1) { // YTD
    d.setMonth(0, 1)
    d.setHours(0, 0, 0, 0)
    return d
  }
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
}
