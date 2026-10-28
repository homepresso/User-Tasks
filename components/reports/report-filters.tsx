'use client'

import { useState } from 'react'
import { Calendar, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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
    <div className="flex items-center gap-1.5">
      <Calendar size={13} style={{ color: 'var(--theme-muted-text)' }} />
      {PRESETS.map(p => (
        <button
          key={p.label}
          onClick={() => onDaysChange(p.days)}
          className={cn(
            'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
            days === p.days ? 'bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)]' : 'text-gray-500 hover:bg-gray-100',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
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
