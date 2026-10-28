'use client'

/**
 * Every report view that draws recharts charts, behind ONE module. Pages load
 * these only through components/reports/lazy-charts.tsx (next/dynamic), so
 * recharts ends up in a single async chunk shared by all report routes
 * instead of being bundled into each route group's own chunk.
 */

export { ReportChart } from './report-chart'
export { IndividualReportView } from './individual-report-view'
export { ProcessesHubView } from '@/app/(dashboard)/reports/workflows/processes-hub-view'
export { ProcessOverviewView } from '@/app/(dashboard)/reports/workflows/[id]/process-overview-view'
