/**
 * "Available forms": the sidebar Forms menu (components/layout/available-forms-menu.tsx)
 * and the Forms dropdown at the top of the side menu (components/layout/header-forms-menu.tsx).
 *
 * A reusable form with `available_in_menu` is listed for the people given
 * EXPLICIT access to it — a grant on the form (object_permissions, View or
 * Submit) for them, a team they belong to or a role they hold — who can also
 * submit forms (forms.submit). The list comes from one RPC
 * (list_available_forms, migration 20261209000000) through
 * lib/services/forms listAvailableForms; this file holds the pure parts the
 * menu and the service share: ordering, the search threshold, filtering
 * and the highlighted match. Pure and isomorphic.
 */

export interface AvailableForm {
  id: string
  name: string
  description: string | null
  /** The friendly link name (/form/<system_name> on a workspace address). */
  system_name?: string | null
  /** The form's tags (lower-case), searchable in the menus. */
  tags?: string[]
}

/** More forms than this and the sidebar menu gets a search box. */
export const AVAILABLE_FORMS_SEARCH_THRESHOLD = 10

/**
 * The fewest forms that show a search box, per menu. The sidebar's Forms
 * item searches with MORE than 10 (11+); the Forms dropdown at the top of
 * the side menu searches with 10 or more.
 */
export const SIDEBAR_FORMS_SEARCH_MIN = AVAILABLE_FORMS_SEARCH_THRESHOLD + 1
export const HEADER_FORMS_SEARCH_MIN = 10

/** The React Query key of the signed-in person's menu (invalidate it when availability or grants change). */
export const AVAILABLE_FORMS_QUERY_KEY = ['available-forms'] as const

/** localStorage key of the menu's expanded state, per user. */
export function availableFormsExpandedKey(userId: string | null | undefined): string {
  return `usertasks.nav.available-forms.${userId || 'anon'}`
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Alphabetical: case-insensitive and locale-aware ("Équipe" next to "Equipment", "Form 2" before "Form 10"). */
export function sortAvailableForms<T extends Pick<AvailableForm, 'id' | 'name'>>(forms: readonly T[]): T[] {
  return [...forms].sort((a, b) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The forms menus' list: the person's favourite forms first (alphabetical),
 * then the rest of their available forms. A favourite that isn't marked
 * available (e.g. opened from a shared link) is still listed: the server only
 * returns favourites the person can open.
 */
export function withFavoriteForms<T extends AvailableForm>(available: readonly T[], favorites: readonly AvailableForm[]): AvailableForm[] {
  if (favorites.length === 0) return [...available]
  const favIds = new Set(favorites.map((f) => f.id))
  const byId = new Map<string, AvailableForm>(available.map((f) => [f.id, f]))
  const favs = sortAvailableForms(favorites.map((f) => ({ ...f, ...(byId.get(f.id) ?? {}) })))
  return [...favs, ...available.filter((f) => !favIds.has(f.id))]
}

/**
 * Whether a menu shows its search box: `count` reaches `searchMin`
 * (default: the sidebar's rule, more than AVAILABLE_FORMS_SEARCH_THRESHOLD).
 */
export function showsAvailableFormsSearch(count: number, searchMin: number = SIDEBAR_FORMS_SEARCH_MIN): boolean {
  return count >= searchMin
}

/** Lower-case without accents, for matching ("é" matches "e"). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Folding that keeps one character per character, so match offsets map back onto the name. */
function foldChars(text: string): string | null {
  let out = ''
  for (const ch of text) {
    const f = fold(ch)
    if (f.length !== ch.length) return null
    out += f
  }
  return out
}

/** The forms whose name (or description) contains the query, keeping their order. */
export function filterAvailableForms<T extends Pick<AvailableForm, 'name' | 'description' | 'tags'>>(forms: readonly T[], query: string): T[] {
  const raw = query.trim()
  // "#tag" (or "tag:tag") matches that tag exactly; plain text matches the name, the description or a tag.
  const tagOnly = /^(?:#|tag:)\s*(.+)$/i.exec(raw)
  if (tagOnly) {
    const t = fold(tagOnly[1].trim())
    return forms.filter((form) => (form.tags ?? []).some((tag) => fold(tag) === t))
  }
  const q = fold(raw)
  if (!q) return [...forms]
  return forms.filter((form) => fold(form.name).includes(q) || fold(form.description ?? '').includes(q) || (form.tags ?? []).some((tag) => fold(tag).includes(q)))
}

/** The tags used by these forms, most common first (ties alphabetical). */
export function availableFormTags(forms: readonly Pick<AvailableForm, 'tags'>[], limit = 12): string[] {
  const counts = new Map<string, number>()
  for (const form of forms) for (const tag of form.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag)
}

/** The name split around the first match of the query, for highlighting. */
export function highlightMatch(name: string, query: string): Array<{ text: string; match: boolean }> {
  const q = query.trim()
  const folded = foldChars(name)
  const needle = fold(q)
  const at = q && folded !== null ? folded.indexOf(needle) : -1
  if (at < 0) return [{ text: name, match: false }]
  return [
    { text: name.slice(0, at), match: false },
    { text: name.slice(at, at + needle.length), match: true },
    { text: name.slice(at + needle.length), match: false },
  ].filter((part) => part.text.length > 0)
}

/* ── The Access hint (forms library → Form details) ──────────────────── */

/** A grant on the form, read structurally (object_permissions rows). */
export interface AvailabilityGrant {
  role_id?: string | null
  user_id?: string | null
  team_id?: string | null
  can_view?: boolean
  can_execute?: boolean
}

export interface AvailabilityHint {
  tone: 'info' | 'warning'
  text: string
  /** One-click fix: turn Available forms on. */
  action?: 'turn_on'
}

/** Grants that list the form in someone's menu (View or Submit). */
function listingGrants(grants: readonly AvailabilityGrant[]): AvailabilityGrant[] {
  return grants.filter((g) => g.can_view === true || g.can_execute === true)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Who the form is listed for, from its grants: "Shown to 2 people, 1 team
 * and 1 role (4 grants)". Members of teams and roles are not counted (that
 * would need the directory). Null without grants.
 */
export function availabilityStatus(grants: readonly AvailabilityGrant[]): string | null {
  const list = listingGrants(grants)
  if (!list.length) return null
  const people = list.filter((g) => g.user_id).length
  const teams = list.filter((g) => g.team_id).length
  const roles = list.filter((g) => g.role_id).length
  const parts = [people ? plural(people, 'person', 'people') : '', teams ? plural(teams, 'team', 'teams') : '', roles ? plural(roles, 'role', 'roles') : ''].filter(Boolean)
  const who = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Shown to ${who} (${plural(list.length, 'grant', 'grants')})`
}

/**
 * The note under Available forms when the two settings disagree: grants
 * but Available forms off (nobody sees it in their menu — offer to turn it
 * on), or Available forms on with no grants (nobody can see it yet). Null
 * when they agree.
 */
export function availabilityHint(input: { available: boolean; grants: readonly AvailabilityGrant[] }): AvailabilityHint | null {
  const count = listingGrants(input.grants).length
  if (count && !input.available) {
    return { tone: 'warning', text: 'People with access won’t see this form in their Forms menu until you tick Available forms', action: 'turn_on' }
  }
  if (!count && input.available) return { tone: 'info', text: 'Nobody has access yet — add people, teams or roles below' }
  return null
}
