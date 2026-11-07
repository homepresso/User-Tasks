"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import {
  lastPage, nextWorkflowListState, parseWorkflowListParams, serializeWorkflowListParams,
  type WorkflowListState, type WorkflowListView,
} from "@/lib/automations/workflow-list-page"

// Stable empties: the list copies `rows` into state on change.
const NO_ROWS: never[] = []
const NO_FACETS = { tags: [] as string[], triggers: [] as string[], total: 0 }

/**
 * The Workflows list's state in the URL (lib/automations/workflow-list-page)
 * and the page of rows the server returns for it. Page / size / filter
 * changes push a history entry (Back returns to them); typing in the search
 * replaces it (debounced).
 */
export function useWorkflowListPage(view: WorkflowListView, enabled = true) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const state = useMemo(() => parseWorkflowListParams(searchParams, view), [searchParams, view])

  const navigate = useCallback((next: WorkflowListState, mode: "push" | "replace") => {
    const qs = serializeWorkflowListParams(next, view, new URLSearchParams(searchParams.toString()))
    const href = qs ? `${pathname}?${qs}` : pathname
    if (mode === "push") router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }, [pathname, router, searchParams, view])

  const update = useCallback((patch: Partial<WorkflowListState>) => {
    navigate(nextWorkflowListState(state, patch), "push")
  }, [navigate, state])

  // The search box: typed text shows at once, the URL (and the query) follow after a pause.
  const [searchText, setSearchText] = useState(state.q)
  const lastUrlQ = useRef(state.q)
  useEffect(() => {
    if (state.q !== lastUrlQ.current) { lastUrlQ.current = state.q; setSearchText(state.q) }
  }, [state.q])
  useEffect(() => {
    if (searchText === state.q) return
    const timer = setTimeout(() => {
      lastUrlQ.current = searchText
      navigate(nextWorkflowListState(state, { q: searchText }), "replace")
    }, 250)
    return () => clearTimeout(timer)
  }, [searchText, state, navigate])

  const args = { q: state.q, status: state.status, trigger: state.trigger, tag: state.tag, sort: state.sort, dir: state.dir, page: state.page, size: state.size }
  const pageQuery = useQuery({
    queryKey: ["workflows", "page", args],
    queryFn: () => serverQuery("automations.listPage", args),
    placeholderData: keepPreviousData,
    enabled,
  })
  const facetsQuery = useQuery({
    queryKey: ["workflows", "facets"],
    queryFn: () => serverQuery("automations.listFacets"),
    enabled,
  })

  // Past the last page (a delete, a smaller result): step back to the last page with rows.
  const total = pageQuery.data?.total ?? 0
  const rowsOnPage = pageQuery.data?.rows.length ?? 0
  useEffect(() => {
    if (pageQuery.isPlaceholderData || !pageQuery.data) return
    if (rowsOnPage === 0 && state.page > 1) navigate({ ...state, page: lastPage(total, state.size) }, "replace")
  }, [pageQuery.data, pageQuery.isPlaceholderData, rowsOnPage, total, state, navigate])

  return {
    state,
    update,
    searchText,
    setSearchText,
    rows: pageQuery.data?.rows ?? NO_ROWS,
    total,
    loading: pageQuery.isLoading,
    fetching: pageQuery.isFetching,
    facets: facetsQuery.data ?? NO_FACETS,
  }
}
