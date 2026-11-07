'use client'

import { StatCard, StatGrid } from '@/components/ui/stat-card'

interface Metric {
  label: string
  value: string | number
  subtitle?: string
  /** Percentage change: positive = up, negative = down. */
  trend?: number
  /** Whether up is good (default) or bad, for the trend colour. */
  goodWhen?: 'up' | 'down'
  /** Info tooltip after the label. */
  hint?: string
  /** Colour of the value (status counts only). */
  tone?: 'default' | 'success' | 'warning' | 'danger'
  /** @deprecated ignored; use `tone`. */
  color?: string
}

/**
 * A report's KPI row: an auto-fit StatGrid of StatCards (no orphan row).
 * Numbers are formatted with grouping and tabular figures.
 */
export function ReportMetricRow({ metrics }: { metrics: Metric[] }) {
  return (
    <StatGrid>
      {metrics.map((m) => (
        <StatCard
          key={m.label}
          label={m.label}
          value={typeof m.value === 'number' ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(m.value) : m.value}
          hint={m.hint}
          tone={m.tone === 'default' ? undefined : m.tone}
          delta={m.trend !== undefined && m.trend !== 0
            ? { label: `${m.trend > 0 ? '+' : '−'}${Math.abs(m.trend)}%`, direction: m.trend > 0 ? 'up' : 'down', goodWhen: m.goodWhen ?? 'up', caption: m.subtitle }
            : m.subtitle ? { label: m.subtitle, direction: 'flat' } : undefined}
        />
      ))}
    </StatGrid>
  )
}
