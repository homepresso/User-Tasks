"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import { ReportChart } from "@/components/reports/lazy-charts"
import { ReportDataTable } from "@/components/reports/report-data-table"
import { Skeleton } from "@/components/ui/skeleton"
import { serverQuery } from "@/lib/server-read"

/* eslint-disable @typescript-eslint/no-explicit-any -- saved report config and result rows */

/**
 * A saved report, read-only, in an app page: the report's chart (when it has
 * one) and its rows, run as the viewer (reports.view and the report's own
 * sharing — the same preview the report page runs).
 */
export function ReportWidget({ reportId }: { reportId: string }) {
  const report = useQuery({ queryKey: ["report", reportId], queryFn: () => serverQuery("reports.get", { id: reportId }), retry: false })
  const config = (report.data as any)?.config ?? null
  const result = useQuery({
    queryKey: ["apps", "report-preview", reportId, config],
    enabled: !!config?.data_source,
    retry: false,
    queryFn: async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await fetch(`/api/v1/reports/preview${timezone ? `?timezone=${encodeURIComponent(timezone)}` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "The report couldn’t run")
      return (json.data ?? []) as any[]
    },
  })
  if (report.isPending || (config?.data_source && result.isPending)) return <div className="space-y-2" aria-busy><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div>
  if (!report.data) return <p className="text-sm text-fg-muted" role="alert">This report isn’t available to you.</p>
  if (result.error) return <p className="text-sm text-danger" role="alert">{(result.error as Error).message}</p>
  const rows = result.data ?? []
  const keys = rows[0] ? Object.keys(rows[0]).filter((k) => k !== "_count" && typeof rows[0][k] !== "object") : []
  const numberKey = keys.find((k) => typeof rows[0]?.[k] === "number")
  const viz = config?.visualization && config.visualization !== "table" ? config.visualization : null
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-widget-report>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-fg-muted">{(report.data as any).name}</span>
        <Link href={`/reports/${reportId}`} className="inline-flex shrink-0 items-center gap-1 text-xs text-primary-text hover:underline">Open report <ExternalLink className="size-3" aria-hidden /></Link>
      </div>
      {!rows.length ? <p className="text-sm text-fg-muted">No rows.</p> : (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {viz && numberKey && keys[0] && <ReportChart type={viz} data={rows} xKey={keys[0]} yKeys={[numberKey]} nameKey={keys[0]} valueKey={numberKey} height={220} />}
          <ReportDataTable columns={keys.map((k) => ({ key: k, label: k.replace(/_/g, " ") }))} data={rows} pageSize={10} />
        </div>
      )}
    </div>
  )
}
