"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import { pushRecent } from "@/lib/apps/access"
import type { AppSummary } from "@/lib/apps/schema"

export const MY_APPS_QUERY_KEY = ["apps", "mine"] as const

/** The apps the signed-in person can open (one cached query: Apps menu, Apps page). */
export function useMyApps() {
  const query = useQuery({
    queryKey: MY_APPS_QUERY_KEY,
    queryFn: async () => ((await serverQuery("apps.mine", {})) ?? []) as AppSummary[],
    staleTime: 60_000,
  })
  return { apps: query.data ?? [], loading: query.isPending, error: query.error }
}

export function useInvalidateApps() {
  const client = useQueryClient()
  return useCallback(() => client.invalidateQueries({ queryKey: ["apps"] }), [client])
}

const recentKey = (userId: string | null) => `ut:apps:recent:${userId ?? "anon"}`

const RECENT_EVENT = "ut:apps:recent"

function subscribeRecent(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(RECENT_EVENT, onChange)
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(RECENT_EVENT, onChange) }
}

function readStorage(key: string): string {
  try { return window.localStorage.getItem(key) ?? "[]" } catch { return "[]" }
}

function parseRecent(raw: string): string[] {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").slice(0, 8) : []
  } catch { return [] }
}

/** Recently opened app ids (most recent first), per person, in this browser. */
export function useRecentApps(): [string[], (id: string) => void] {
  const { userId } = usePermissions()
  const key = recentKey(userId)
  const raw = useSyncExternalStore(subscribeRecent, () => readStorage(key), () => "[]")
  const recent = useMemo(() => parseRecent(raw), [raw])
  const remember = useCallback((id: string) => {
    const next = pushRecent(parseRecent(readStorage(key)), id)
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(RECENT_EVENT))
  }, [key])
  return [recent, remember]
}

export function appHref(app: Pick<AppSummary, "slug" | "home_page">, page?: string | null): string {
  const target = page ?? app.home_page
  return target ? `/apps/${app.slug}/${target}` : `/apps/${app.slug}`
}
