'use client'

import { createContext, useCallback, useContext, useMemo, useRef } from 'react'

/**
 * Lets a floating Variables/Expressions bar insert a `{{token}}` into whichever
 * variable input the user last focused — the "click-to-insert" channel that
 * complements the existing drag-and-drop / clipboard paths.
 *
 * A `VariableInput` registers its insert-at-caret function on focus; the bar calls
 * `insertIntoActive(token)`, which returns false when no input is active (so the
 * caller can fall back to copying to the clipboard).
 */
interface ActiveInputApi {
  /** Register the focused input's insert-at-caret handler. Returns an unregister fn. */
  register: (insert: (token: string) => void) => () => void
  /** Insert into the last-focused input; false if none is active. */
  insertIntoActive: (token: string) => boolean
}

const ActiveInputContext = createContext<ActiveInputApi | null>(null)

export function ActiveInputProvider({ children }: { children: React.ReactNode }) {
  const insertRef = useRef<((token: string) => void) | null>(null)

  const register = useCallback((insert: (token: string) => void) => {
    insertRef.current = insert
    return () => {
      // Only clear if this exact handler is still the active one.
      if (insertRef.current === insert) insertRef.current = null
    }
  }, [])

  const insertIntoActive = useCallback((token: string) => {
    if (!insertRef.current) return false
    insertRef.current(token)
    return true
  }, [])

  const api = useMemo<ActiveInputApi>(() => ({ register, insertIntoActive }), [register, insertIntoActive])
  return <ActiveInputContext.Provider value={api}>{children}</ActiveInputContext.Provider>
}

/** Safe accessor — returns a no-op API when there's no provider (feature just degrades to copy/drag). */
export function useActiveInput(): ActiveInputApi {
  const ctx = useContext(ActiveInputContext)
  return ctx ?? NOOP_API
}

const NOOP_API: ActiveInputApi = {
  register: () => () => {},
  insertIntoActive: () => false,
}
