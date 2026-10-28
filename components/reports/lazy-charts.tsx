'use client'

import dynamic from 'next/dynamic'
import { PageSkeleton } from '@/components/ui/page-skeleton'

/**
 * Lazy entry points for the chart-drawing report views (see chart-views.tsx).
 * Import report charts from here, never from the view modules directly — a
 * direct import pulls recharts back into the route's first-load chunks.
 */

function ChartSkeleton() {
  return (
    <div
      className="w-full rounded-lg"
      style={{ height: 220, backgroundColor: 'var(--theme-surface)', animation: 'shimmer 1.5s ease-in-out infinite' }}
      aria-busy="true"
      aria-label="Loading chart"
    />
  )
}

const load = () => import('./chart-views')

export const ReportChart = dynamic(() => load().then((m) => m.ReportChart), { loading: ChartSkeleton })
export const IndividualReportView = dynamic(() => load().then((m) => m.IndividualReportView), {
  loading: () => <PageSkeleton variant="list" />,
})
export const ProcessesHubView = dynamic(() => load().then((m) => m.ProcessesHubView), {
  loading: () => <PageSkeleton variant="list" />,
})
export const ProcessOverviewView = dynamic(() => load().then((m) => m.ProcessOverviewView), {
  loading: () => <PageSkeleton variant="list" />,
})
