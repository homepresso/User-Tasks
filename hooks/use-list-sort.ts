'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePermissions } from '@/lib/permissions-context'
import { nextSort, readStoredSort, sortRows, storeSort, type SortState } from '@/lib/tasks/list-sort'

/**
 * A remembered choice among fixed options (a list's layout), per user in
 * this browser. Unknown stored values fall back to `initial`.
 */
export function usePersistedChoice<T extends string>(key: string, options: readonly T[], initial: T): [T, (next: T) => void] {
  const { userId } = usePermissions()
  const [value, setValue] = useState<T>(initial)
  const storageKey = `usertasks:choice:${key}:${userId || 'anon'}`
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      setValue(stored && (options as readonly string[]).includes(stored) ? stored as T : initial)
    } catch {
      setValue(initial)
    }
  }, [storageKey, options, initial])
  const set = useCallback((next: T) => {
    setValue(next)
    try { window.localStorage.setItem(storageKey, next) } catch { /* not remembered */ }
  }, [storageKey])
  return [value, set]
}

/**
 * A list's column sort (lib/tasks/list-sort): click a header to cycle
 * ascending → descending → none. Remembered per user, per list, in this
 * browser (localStorage; quietly not remembered when storage is off).
 * `sorted(rows)` applies it — call it on the whole result before paging so
 * the pages follow the sort.
 */
export function useListSort<K extends string>(list: string, keys: readonly K[], initial: SortState<K> | null = null) {
  const { userId } = usePermissions()
  const [sort, setSort] = useState<SortState<K> | null>(initial)
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)

  // Restore the remembered sort once the user is known (after hydration).
  useEffect(() => {
    if (loadedFor === userId) return
    const stored = readStoredSort(list, userId, keys)
    if (stored !== undefined) setSort(stored)
    setLoadedFor(userId)
  }, [list, keys, userId, loadedFor])

  const apply = useCallback((next: SortState<K> | null) => {
    setSort(next)
    storeSort(list, userId, next)
  }, [list, userId])

  const toggle = useCallback((key: K) => apply(nextSort(sort, key)), [apply, sort])
  const sorted = useCallback(<T,>(rows: readonly T[]) => sortRows(rows, sort), [sort])

  return { sort, setSort: apply, toggle, sorted }
}
