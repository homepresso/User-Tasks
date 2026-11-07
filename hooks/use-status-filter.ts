'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePermissions } from '@/lib/permissions-context'
import {
  DEFAULT_STATUS_FILTER, readStoredStatusFilter, statusesFor, storeStatusFilter, type StatusFilterState,
} from '@/lib/tasks/status-filter'

/**
 * A remembered on/off switch (per user, in this browser) — Home My tasks'
 * "Show completed", whose list read takes a flag rather than statuses.
 */
export function usePersistedSwitch(name: string, initial = false): [boolean, (next: boolean) => void] {
  const { userId } = usePermissions()
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = readStoredStatusFilter(name, userId)
    setValue(stored ? stored.showCompleted : initial)
  }, [name, userId, initial])
  const set = useCallback((next: boolean) => {
    setValue(next)
    storeStatusFilter(name, userId, { selected: [], showCompleted: next })
  }, [name, userId])
  return [value, set]
}

/**
 * A list's status filter (lib/tasks/status-filter): open statuses by
 * default, "Show completed" to bring the closed ones back. Remembered per
 * user, per list, in this browser.
 */
export function useStatusFilter(list: string, openStatuses: readonly string[]) {
  const { userId } = usePermissions()
  const [state, setState] = useState<StatusFilterState>(DEFAULT_STATUS_FILTER)
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (loadedFor === userId) return
    const stored = readStoredStatusFilter(list, userId)
    if (stored) setState(stored)
    setLoadedFor(userId)
  }, [list, userId, loadedFor])

  const update = useCallback((patch: Partial<StatusFilterState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      storeStatusFilter(list, userId, next)
      return next
    })
  }, [list, userId])

  return {
    state,
    selected: state.selected,
    showCompleted: state.showCompleted,
    setSelected: (selected: string[]) => update({ selected }),
    setShowCompleted: (showCompleted: boolean) => update({ showCompleted }),
    reset: () => update(DEFAULT_STATUS_FILTER),
    /** The statuses to ask the read for (null = no status filter). */
    statuses: statusesFor(state, openStatuses),
  }
}
