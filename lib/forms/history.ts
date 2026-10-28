/**
 * Undo / redo stack for the form designer: past / present / future of
 * immutable states. A `set` with a `tag` equal to the previous change's tag
 * replaces the present instead of pushing (typing in one input is one undo
 * step). Pure (tested in __tests__/form-designer.test.ts).
 */

export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
  lastTag: string | null
}

export type HistoryAction<T> =
  | { type: 'set'; next: T; tag?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; present: T }

const LIMIT = 200

export function historyReducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case 'set': {
      if (action.next === state.present) return state
      if (action.tag && action.tag === state.lastTag) return { ...state, present: action.next, future: [] }
      return { past: [...state.past, state.present].slice(-LIMIT), present: action.next, future: [], lastTag: action.tag ?? null }
    }
    case 'undo': {
      if (!state.past.length) return state
      const previous = state.past[state.past.length - 1]
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], lastTag: null }
    }
    case 'redo': {
      if (!state.future.length) return state
      const [next, ...rest] = state.future
      return { past: [...state.past, state.present], present: next, future: rest, lastTag: null }
    }
    case 'reset':
      return { past: [], present: action.present, future: [], lastTag: null }
  }
}


export function initialHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], lastTag: null }
}
