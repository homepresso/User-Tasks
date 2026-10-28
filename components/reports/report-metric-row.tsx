'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Metric {
  label: string
  value: string | number
  subtitle?: string
  trend?: number // positive = up, negative = down
  color?: string // tailwind color class for accent
}

export function ReportMetricRow({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(metrics.length, 5)}, 1fr)` }}>
      {metrics.map((m, i) => (
        <div
          key={i}
          className="rounded-xl border p-4"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>{m.label}</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold" style={{ color: 'var(--theme-card-text)' }}>{m.value}</span>
            {m.trend !== undefined && m.trend !== 0 && (
              <span className={cn('flex items-center gap-0.5 text-xs font-medium mb-0.5', m.trend > 0 ? 'text-green-600' : 'text-red-500')}>
                {m.trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {Math.abs(m.trend)}%
              </span>
            )}
          </div>
          {m.subtitle && <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{m.subtitle}</p>}
        </div>
      ))}
    </div>
  )
}
