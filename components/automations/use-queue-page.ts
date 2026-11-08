"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import {
  advancedFilterCount, nextQueueFilters, parseQueueFilters, readLastQueueView, serializeQueueFilters, toReadFilters, writeLastQueueView,
  type QueueFilters,
} from "@/lib/automations/queue-filters"

/**
 * The workflow queue's view and filters in the URL (lib/automations/queue-filters)
 * and the page of items the server returns for them. With no `view` in the
 * URL the person's last-used view (localStorage) is restored, else Active.
 * Filter and page changes push a history entry (shallow, history API);
 * typing in the search replaces it after a pause.
 */
export function useQueuePage(options: { facets: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { userId } = usePermissions()
  const hasView = searchParams.has("view")
  const filters = useMemo(() => parseQueueFilters(searchParams), [searchParams])

  const navigate = useCallback((next: QueueFilters, mode: "push" | "replace") => {
    const qs = serializeQueueFilters(next, new URLSearchParams(searchParams.toString()))
    const href = qs ? `${pathname}?${qs}` : pathname
    // Shallow URL updates (the native history API syncs useSearchParams; no
    // server round trip — the page is all client-side reads).
    if (mode === "push") window.history.pushState(null, "", href)
    else window.history.replaceState(null, "", href)
  }, [pathname, searchParams])

  // No view in the URL: restore the last one used (after mount, storage is browser-only).
  useEffect(() => {
    if (hasView) return
    navigate({ ...filters, view: readLastQueueView(userId) ?? "active" }, "replace")
  }, [hasView, filters, navigate, userId])

  // Remember the view in use.
  useEffect(() => {
    if (hasView) writeLastQueueView(userId, filters.view)
  }, [hasView, filters.view, userId])

  const update = useCallback((patch: Partial<QueueFilters>) => {
    navigate(nextQueueFilters(filters, patch), "push")
  }, [filters, navigate])

  const replace = useCallback((next: QueueFilters) => navigate(next, "push"), [navigate])

  // Search: typed text shows at once, the URL (and the query) follow after 300ms.
  const [searchText, setSearchText] = useState(filters.search)
  // The URL's search changed from elsewhere (Back, Clear all): show it (state adjusted while rendering).
  const [urlSearch, setUrlSearch] = useState(filters.search)
  if (filters.search !== urlSearch) {
    setUrlSearch(filters.search)
    setSearchText(filters.search)
  }
  useEffect(() => {
    if (searchText === filters.search) return
    const timer = setTimeout(() => {
      navigate(nextQueueFilters(filters, { search: searchText }), "replace")
    }, 300)
    return () => clearTimeout(timer)
  }, [searchText, filters, navigate])

  const args = useMemo(() => ({
    ...toReadFilters(filters),
    sort: filters.sort, dir: filters.dir, page: filters.page, pageSize: filters.pageSize,
  }), [filters])

  const pageQuery = useQuery({
    queryKey: ["workflow-queue", "page", args],
    queryFn: () => serverQuery("automations.queue", args),
    placeholderData: keepPreviousData,
    enabled: hasView,
  })
  const facetsQuery = useQuery({
    queryKey: ["workflow-queue", "facets"],
    queryFn: () => serverQuery("automations.queueFacets"),
    // Facets also label the active filter chips: load them once any advanced filter is set.
    enabled: options.facets || advancedFilterCount(filters) > 0,
    staleTime: 60_000,
  })

  // Past the last page (a delete, a narrower filter): step back to the last page with rows.
  const total = pageQuery.data?.total ?? 0
  const rowsOnPage = pageQuery.data?.rows.length ?? 0
  useEffect(() => {
    if (pageQuery.isPlaceholderData || !pageQuery.data) return
    if (rowsOnPage === 0 && filters.page > 1) navigate({ ...filters, page: Math.max(1, Math.ceil(total / filters.pageSize)) }, "replace")
  }, [pageQuery.data, pageQuery.isPlaceholderData, rowsOnPage, total, filters, navigate])

  return {
    filters,
    update,
    replace,
    searchText,
    setSearchText,
    data: pageQuery.data ?? null,
    isLoading: !pageQuery.data,
    isFetching: pageQuery.isFetching,
    error: pageQuery.error as Error | null,
    facets: facetsQuery.data ?? null,
  }
}
