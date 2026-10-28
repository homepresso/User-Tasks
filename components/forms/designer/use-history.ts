'use client'

import { useCallback, useReducer } from 'react'
import { historyReducer, initialHistory, type HistoryAction, type HistoryState } from '@/lib/forms/history'

/** Undo / redo state for the form designer (lib/forms/history). */
export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(historyReducer as (s: HistoryState<T>, a: HistoryAction<T>) => HistoryState<T>, initial, initialHistory)
  const set = useCallback((next: T, tag?: string) => dispatch({ type: 'set', next, tag }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const reset = useCallback((present: T) => dispatch({ type: 'reset', present }), [])
  return { state: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}
