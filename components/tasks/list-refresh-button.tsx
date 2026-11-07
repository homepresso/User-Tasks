"use client"

import { useEffect, useState } from "react"
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import { NAV_COUNTS_QUERY_KEY } from "@/hooks/use-nav-counts"
import { formatRelative } from "@/lib/format/date"
import { cn } from "@/lib/utils"

/**
 * Refresh on the task lists (/tasks, Home My tasks): refetches the list's
 * queries and the nav counts, spins while it runs (not with reduced motion),
 * and says when the list was last refreshed.
 */

/** Refetch every query under `keys` plus the nav counts; resolves when they've all settled. */
export async function refreshQueryKeys(queryClient: QueryClient, keys: readonly QueryKey[]): Promise<void> {
  await Promise.all([...keys, NAV_COUNTS_QUERY_KEY].map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })))
}

/** "Updated just now" / "Updated 5 min ago". */
export function refreshedLabel(at: number, now: number = Date.now()): string {
  return now - at < 45_000 ? "Updated just now" : `Updated ${formatRelative(at, { now })}`
}

export function ListRefreshButton({ queryKeys, className }: { queryKeys: readonly QueryKey[]; className?: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Keep "Updated …" current while it's shown.
  useEffect(() => {
    if (at === null) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [at])

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      await refreshQueryKeys(queryClient, queryKeys)
    } finally {
      const t = Date.now()
      setAt(t)
      setNow(t)
      setBusy(false)
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-list-refresh>
      <IconButton size="sm" label="Refresh" icon={<RefreshCw className={cn(busy && "motion-safe:animate-spin")} />}
        disabled={busy} aria-busy={busy || undefined} onClick={() => void refresh()} data-list-refresh-button />
      {at !== null && <span className="whitespace-nowrap text-xs text-fg-muted" role="status">{refreshedLabel(at, now)}</span>}
    </span>
  )
}
