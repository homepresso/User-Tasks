/**
 * Person fields (`type: 'user'`) picking several people and / or teams —
 * InfoPath's person / group picker (`user_config`).
 *
 * Backward compatible: without `user_config.multiple` and
 * `user_config.allow_teams` the value is ONE user id string, exactly as
 * before. With either set the field is a "people list" and its value is an
 * array of references:
 *
 *   [{ kind: 'user' | 'team', id: '<uuid>', name: 'Ada Lovelace' }, …]
 *
 * (single + allow_teams: an array of at most one). `name` is set by the
 * server from the workspace's users / teams on submit — never taken from the
 * browser — and every id must belong to the workspace (lib/forms/task-values.ts).
 *
 * Config `user_config`: { multiple?: boolean, allow_teams?: boolean,
 * max?: number (multiple only; default 20, at most 100) }.
 *
 * Accepted input (API, workflows, defaults): reference objects, "user:<id>" /
 * "team:<id>" strings, or bare user ids — one, an array, or a comma list.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export interface UserFieldConfig {
  /** Several people (an array value). */
  multiple?: boolean
  /** Teams as well as people. */
  allow_teams?: boolean
  /** Most picks (multiple only): default 20, at most 100. */
  max?: number
}

export type PersonRefKind = 'user' | 'team'

export interface PersonRef {
  kind: PersonRefKind
  id: string
  /** Display name (server-set). */
  name?: string
}

export const PEOPLE_DEFAULT_MAX = 20
export const PEOPLE_MAX = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeUserConfig(raw: unknown): UserFieldConfig | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: UserFieldConfig = {}
  if (raw.multiple === true) out.multiple = true
  if (raw.allow_teams === true) out.allow_teams = true
  const max = Number(raw.max)
  if (out.multiple && raw.max !== undefined && raw.max !== null && raw.max !== '' && Number.isFinite(max)) out.max = Math.min(Math.max(Math.floor(max), 1), PEOPLE_MAX)
  return Object.keys(out).length ? out : undefined
}

/** A person field whose value is an array of references (multiple and / or teams). */
export function isPeopleList(field: { type: string; user_config?: UserFieldConfig }): boolean {
  return field.type === 'user' && Boolean(field.user_config?.multiple || field.user_config?.allow_teams)
}

export function peopleMax(config: UserFieldConfig | undefined): number {
  return config?.multiple ? (config.max ?? PEOPLE_DEFAULT_MAX) : 1
}

/** One entry → a reference (null when it isn't one). */
function toRef(entry: unknown): PersonRef | null {
  if (typeof entry === 'string') {
    const s = entry.trim()
    const m = /^(user|team):(.+)$/i.exec(s)
    const kind = (m ? m[1].toLowerCase() : 'user') as PersonRefKind
    const id = (m ? m[2] : s).trim()
    return UUID_RE.test(id) ? { kind, id: id.toLowerCase() } : null
  }
  if (isPlainObject(entry)) {
    const kind = entry.kind === 'team' ? 'team' : entry.kind === 'user' || entry.kind === undefined ? 'user' : null
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!kind || !UUID_RE.test(id)) return null
    const ref: PersonRef = { kind, id: id.toLowerCase() }
    if (typeof entry.name === 'string' && entry.name.trim()) ref.name = entry.name.trim().slice(0, 200)
    return ref
  }
  return null
}

function entries(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed
      } catch { /* comma list */ }
    }
    return s.split(',')
  }
  return [value]
}

/** Any input → the references (invalid entries dropped, duplicates removed). */
export function normalizePeopleValue(value: unknown): PersonRef[] {
  const out: PersonRef[] = []
  const seen = new Set<string>()
  for (const entry of entries(value)) {
    const ref = toRef(entry)
    if (!ref || seen.has(`${ref.kind}:${ref.id}`)) continue
    seen.add(`${ref.kind}:${ref.id}`)
    out.push(ref)
  }
  return out
}

/** A problem with a submitted people-list value (shape, kinds, count); null when fine. Membership is checked on the server. */
export function peopleValueError(field: { label: string; user_config?: UserFieldConfig }, value: unknown): string | null {
  const raw = entries(value).filter((e) => !(typeof e === 'string' && !e.trim()))
  const refs = normalizePeopleValue(value)
  if (raw.some((e) => !toRef(e))) {
    return `${field.label} must be people${field.user_config?.allow_teams ? ' or teams' : ''} in this workspace`
  }
  if (!field.user_config?.allow_teams && refs.some((r) => r.kind === 'team')) return `${field.label} takes people, not teams`
  const max = peopleMax(field.user_config)
  if (refs.length > max) return max === 1 ? `${field.label}: choose one` : `${field.label}: choose at most ${max}`
  return null
}

/** Names for display ("Ada Lovelace, Finance team"); `names` fills in references without one. */
export function peopleText(value: unknown, names?: ReadonlyMap<string, string>): string {
  return normalizePeopleValue(value)
    .map((r) => r.name || names?.get(r.id) || (r.kind === 'team' ? 'a team' : 'a person'))
    .join(', ')
}

/** "user:<id>" / "team:<id>" — the picker's option values. */
export function personRefKey(ref: Pick<PersonRef, 'kind' | 'id'>): string {
  return `${ref.kind}:${ref.id}`
}
