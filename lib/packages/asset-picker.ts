/**
 * Package editor asset picker: the state rules behind
 * components/packages/asset-picker.tsx, kept free of React so they can be
 * unit-tested (keyboard navigation, multi-select, adding with or without
 * dependencies, windowing).
 */

export interface AssetRefLike { type: string; id: string }

export const refKey = (ref: AssetRefLike) => `${ref.type}:${ref.id}`

/** How an asset is part of the package being edited. */
export type Membership = 'root' | 'manual' | 'dependency' | 'excluded' | null

export interface PreviewItemLike extends AssetRefLike {
  included_as: 'root' | 'dependency' | 'manual'
  required_by?: AssetRefLike | 'root'
}

export function membershipIndex(previewItems: readonly PreviewItemLike[], excluded: readonly AssetRefLike[]): Map<string, Membership> {
  const out = new Map<string, Membership>()
  for (const item of previewItems) out.set(refKey(item), item.included_as)
  for (const ref of excluded) if (!out.has(refKey(ref))) out.set(refKey(ref), 'excluded')
  return out
}

/** Rows that are in the package already cannot be selected again (left-out ones can: adding them brings them back). */
export function isSelectable(membership: Membership | undefined): boolean {
  return !membership || membership === 'excluded'
}

// ─── Keyboard ───────────────────────────────────────────────────────────────

export interface PickerState {
  open: boolean
  /** Index of the highlighted row (aria-activedescendant), -1 for none. */
  active: number
  /** Selected refs by key, in the order they were picked. */
  selected: Map<string, AssetRefLike>
}

export type PickerAction =
  | { kind: 'none' }
  | { kind: 'add'; refs: AssetRefLike[] }
  | { kind: 'clear-search' }
  | { kind: 'close' }

export interface KeyInput { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }

export const PAGE_STEP = 8

/**
 * One key press in the search box (the list keeps the focus in the input,
 * combobox style). ↑/↓/PageUp/PageDown/Home/End move, Enter selects or
 * unselects the highlighted row, Ctrl/⌘+Enter (or Shift+Enter) adds the
 * selection (or the highlighted row when nothing is selected), Esc closes the
 * list and, when closed, clears the search.
 */
export function pickerKey(
  state: PickerState,
  input: KeyInput,
  rows: readonly AssetRefLike[],
  membership: ReadonlyMap<string, Membership>,
  search: string,
): { state: PickerState; action: PickerAction; handled: boolean } {
  const count = rows.length
  const move = (to: number) => ({ state: { ...state, open: true, active: count ? Math.max(0, Math.min(count - 1, to)) : -1 }, action: { kind: 'none' } as PickerAction, handled: true })
  switch (input.key) {
    case 'ArrowDown':
      return state.open ? move(state.active + 1) : move(Math.max(state.active, 0))
    case 'ArrowUp':
      return move(state.active <= 0 ? 0 : state.active - 1)
    case 'PageDown':
      return move(state.active + PAGE_STEP)
    case 'PageUp':
      return move(state.active - PAGE_STEP)
    case 'Home':
      if (!state.open) return { state, action: { kind: 'none' }, handled: false }
      return move(0)
    case 'End':
      if (!state.open) return { state, action: { kind: 'none' }, handled: false }
      return move(count - 1)
    case 'Enter': {
      const commit = input.ctrlKey || input.metaKey || input.shiftKey
      const row = state.active >= 0 ? rows[state.active] : undefined
      if (commit) {
        const refs = state.selected.size ? [...state.selected.values()] : row && isSelectable(membership.get(refKey(row))) ? [row] : []
        if (!refs.length) return { state, action: { kind: 'none' }, handled: true }
        return { state: { ...state, selected: new Map(), open: false }, action: { kind: 'add', refs }, handled: true }
      }
      if (!row || !state.open) return { state: { ...state, open: true, active: state.active < 0 && count ? 0 : state.active }, action: { kind: 'none' }, handled: true }
      return { state: { ...state, selected: toggle(state.selected, row, membership) }, action: { kind: 'none' }, handled: true }
    }
    case 'Escape':
      if (state.open) return { state: { ...state, open: false }, action: { kind: 'close' }, handled: true }
      if (search) return { state, action: { kind: 'clear-search' }, handled: true }
      return { state, action: { kind: 'none' }, handled: false }
    default:
      return { state, action: { kind: 'none' }, handled: false }
  }
}

export function toggle(selected: ReadonlyMap<string, AssetRefLike>, ref: AssetRefLike, membership: ReadonlyMap<string, Membership>): Map<string, AssetRefLike> {
  const next = new Map(selected)
  const key = refKey(ref)
  if (next.has(key)) next.delete(key)
  else if (isSelectable(membership.get(key))) next.set(key, { type: ref.type, id: ref.id })
  return next
}

// ─── Adding to the package ──────────────────────────────────────────────────

export interface PackageDraft { roots: AssetRefLike[]; items: AssetRefLike[]; excluded: AssetRefLike[] }

/**
 * Add refs to the draft: an empty package starts from them (roots), otherwise
 * they become hand-added items; adding a left-out asset brings it back.
 */
export function addToDraft(draft: PackageDraft, refs: readonly AssetRefLike[]): PackageDraft {
  const addKeys = new Set(refs.map(refKey))
  const excluded = draft.excluded.filter((ref) => !addKeys.has(refKey(ref)))
  const known = new Set([...draft.roots, ...draft.items].map(refKey))
  const fresh = dedupe(refs).filter((ref) => !known.has(refKey(ref)))
  if (!draft.roots.length) return { roots: fresh, items: draft.items, excluded }
  return { roots: draft.roots, items: [...draft.items, ...fresh], excluded }
}

function dedupe(refs: readonly AssetRefLike[]): AssetRefLike[] {
  const seen = new Set<string>()
  const out: AssetRefLike[] = []
  for (const ref of refs) {
    if (seen.has(refKey(ref))) continue
    seen.add(refKey(ref))
    out.push({ type: ref.type, id: ref.id })
  }
  return out
}

/**
 * "Add without dependencies": the dependencies the new refs pulled in that
 * were not in the package before (those go to `excluded`; their own
 * dependencies are then never traversed). Dependencies another item already
 * needed stay.
 */
export function dependenciesToLeaveOut(
  previewAfter: readonly PreviewItemLike[],
  added: readonly AssetRefLike[],
  includedBefore: ReadonlySet<string>,
): AssetRefLike[] {
  const addedKeys = new Set(added.map(refKey))
  return previewAfter
    .filter((item) => item.included_as === 'dependency' && !includedBefore.has(refKey(item)) && !addedKeys.has(refKey(item)))
    .filter((item) => item.required_by && item.required_by !== 'root' && addedKeys.has(refKey(item.required_by)))
    .map((item) => ({ type: item.type, id: item.id }))
}

// ─── Windowing ──────────────────────────────────────────────────────────────

/** Rows to render for a fixed-height list: [start, end) plus the spacer above. */
export function visibleWindow(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 6) {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, first + Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight) + overscan)
  return { start, end, offsetTop: start * rowHeight, totalHeight: count * rowHeight }
}

/** scrollTop that brings row `index` into view (unchanged when it is visible). */
export function scrollToRow(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number {
  const top = index * rowHeight
  if (top < scrollTop) return top
  if (top + rowHeight > scrollTop + viewportHeight) return top + rowHeight - viewportHeight
  return scrollTop
}

/** Fetch the next page when the window gets within `threshold` rows of the end. */
export function shouldLoadMore(end: number, count: number, hasMore: boolean, loading: boolean, threshold = 10): boolean {
  return hasMore && !loading && count - end <= threshold
}

// ─── Filtering the package's own list ──────────────────────────────────────

export function filterContents<T extends { type: string; name: string; label?: string; included_as?: string }>(
  items: readonly T[], filter: { text?: string; type?: string; show?: 'all' | 'added' | 'dependency' },
): T[] {
  const needle = (filter.text ?? '').trim().toLowerCase()
  return items.filter((item) => {
    if (filter.type && item.type !== filter.type) return false
    if (filter.show === 'added' && item.included_as === 'dependency') return false
    if (filter.show === 'dependency' && item.included_as !== 'dependency') return false
    if (needle && !item.name.toLowerCase().includes(needle) && !(item.label ?? '').toLowerCase().includes(needle)) return false
    return true
  })
}
