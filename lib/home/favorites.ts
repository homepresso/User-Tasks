/**
 * Home → task list → Favourite forms tab (components/home/favorites-tab.tsx):
 * what the tab lists for a search. Pure, unit-tested in
 * __tests__/home-favorites.test.ts.
 */

export interface FavoriteFormLike { id: string; name: string; description: string | null }

/** More favourites than this and the tab shows a search box. */
export const FAVORITES_SEARCH_THRESHOLD = 10

export interface FavoriteFormsView<T extends FavoriteFormLike> {
  /** The forms to list: alphabetical (case-insensitive, numbers in order), filtered by the search. */
  forms: T[]
  /** Show the search box (more than FAVORITES_SEARCH_THRESHOLD favourites). */
  searchable: boolean
  /**
   * Why the list is empty: `none` (no favourites yet: explain how to star a
   * form), `no-match` (the search matched nothing), or null (not empty).
   */
  empty: 'none' | 'no-match' | null
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function favoriteFormsView<T extends FavoriteFormLike>(all: readonly T[], search = ''): FavoriteFormsView<T> {
  const sorted = [...all].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id))
  const searchable = sorted.length > FAVORITES_SEARCH_THRESHOLD
  // The search only applies while the box is shown (a hidden box can't filter).
  const q = searchable ? search.trim().toLocaleLowerCase() : ''
  const forms = q
    ? sorted.filter((f) => f.name.toLocaleLowerCase().includes(q) || (f.description ?? '').toLocaleLowerCase().includes(q))
    : sorted
  return { forms, searchable, empty: sorted.length === 0 ? 'none' : forms.length === 0 ? 'no-match' : null }
}
