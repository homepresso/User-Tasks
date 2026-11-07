"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import type { HomeWidgetId } from "@/lib/home/layout"
import { HOME_QUERY_KEY } from "../shared"
import { useHome } from "../home-context"
import { ChartSkeleton } from "./chart-card"
import { CompletedChart, DurationChart, TopProcessesChart } from "./charts"

export const periodKey = (userId: string | null | undefined) => `home_activity_period:${userId ?? "anon"}`

/** The browser's time zone (day buckets follow it), or undefined. */
export function browserTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined }
}

/**
 * Home → My activity: the signed-in person's own work in this workspace over
 * 7 / 30 / 90 days (one server read shared by every chart widget; aggregates
 * computed in SQL). The period comes from the Home header.
 */
export function useActivityStats() {
  const { can } = usePermissions()
  const { period, timezone: tz } = useHome()
  const enabled = can("tasks.view_own") || can("forms.submit")
  return useQuery({
    queryKey: [...HOME_QUERY_KEY, "activity", period, tz ?? ""],
    queryFn: () => serverQuery("home.activityStats", { period, ...(tz ? { timezone: tz } : {}) }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

const CHARTS = {
  "chart.completed": CompletedChart,
  "chart.duration": DurationChart,
  "chart.top_processes": TopProcessesChart,
} as const

/** One My activity chart as a Home widget (skeleton → chart, or a short error). */
export function ChartWidget({ id }: { id: HomeWidgetId }) {
  const stats = useActivityStats()
  if (stats.isPending) return <ChartSkeleton />
  const data = stats.data
  if (stats.isError || !data) {
    return (
      <p className="h-full rounded-lg border border-border bg-panel p-4 text-xs text-fg-muted" role="alert">
        Couldn’t load your activity. Try again later.
      </p>
    )
  }
  const refreshing = stats.isFetching && stats.isPlaceholderData
  const locale = undefined // the viewer's locale (Intl default)
  const Chart = CHARTS[id as keyof typeof CHARTS]
  if (!Chart || !data.tasks) return null
  return <Chart stats={data.tasks} locale={locale} refreshing={refreshing} />
}

/** The zone the charts' days follow, once the read says which it used. */
export function useActivityTimezone(): string | null {
  return useActivityStats().data?.timezone ?? null
}
