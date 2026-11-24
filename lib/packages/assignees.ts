/**
 * Package assignees: the `user` requirements (people and teams never travel
 * in a package; the installer picks who receives each step).
 *
 * What a field can take depends on the step it points at, read from the
 * manifest being installed:
 *   user_task  assignee_id / team_id         → a person or a team (the step's
 *                                               assignment switches between
 *                                               'individual' and 'team')
 *              escalation_user_id / _team_id  → a person or a team (escalation
 *                                               type 'individual' / 'team')
 *   any other  the declared kind only (a user field takes a person, a team
 *              field a team).
 * Entra (AAD) group assignment is configured on the step itself (a directory
 * group id, not a workspace id), so a step set to `aad_group` keeps the
 * declared kind only.
 *
 * Values (the requirement values of a `user` field, as the UI, API, CLI and
 * MCP send them):
 *   <uuid>          the declared kind (a user id in a user field, a team id
 *                   in a team field) — unchanged from before
 *   name@domain     a person by email (user fields)
 *   user:<uuid>     a person, explicitly
 *   team:<uuid>     a team, explicitly
 *
 * Pure (no server imports): shared by the install service, the requirements
 * form and its tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import type { PackageRequirement, RequirementField } from './format'

export type AssigneeKind = 'user' | 'team'
export type AssigneeSlot = 'assignment' | 'escalation'

export interface AssigneeTarget {
  /** What the field was detected as in the source workspace. */
  declared: AssigneeKind
  /** What the step can take. */
  accepts: AssigneeKind[]
  /** Paired user / team config keys on a user task (null: write at the field's path). */
  slot: AssigneeSlot | null
}

export type ParsedAssignee =
  | { kind: 'user'; id: string }
  | { kind: 'user'; email: string }
  | { kind: 'team'; id: string }
  | { error: string }

/** Field metadata sent with a plan (UI: what to offer, who is chosen, what is wrong). */
export interface AssigneeFieldInfo {
  accepts: AssigneeKind[]
  current?: AssigneeChoice | null
  error?: string
}

export interface AssigneeChoice {
  kind: AssigneeKind
  id: string
  name: string
  email?: string | null
  member_count?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const TEAM_KEYS = new Set(['team_id', 'teamId', 'escalation_team_id', 'assign_to_team_id'])
const ASSIGNMENT_KEYS: Record<string, AssigneeKind> = { assignee_id: 'user', team_id: 'team' }
const ESCALATION_KEYS: Record<string, AssigneeKind> = { escalation_user_id: 'user', escalation_team_id: 'team' }

export const isEmailLike = (value: string) => EMAIL.test(value.trim())

/** The kind the field was detected as (a team field: its key; everything else: a person). */
export function declaredKind(field: Pick<RequirementField, 'type' | 'target'>): AssigneeKind {
  if (field.type === 'user') return 'user'
  const key = field.target.path[field.target.path.length - 1]
  return TEAM_KEYS.has(String(key)) ? 'team' : 'user'
}

function findAsset(assets: Record<string, any>, section: string, assetId: string): any {
  const list = Array.isArray(assets?.[section]) ? assets[section] : []
  return list.find((a: any) => String(section === 'objects' ? a?.generated_reference_id ?? a?.id : a?.id) === assetId)
}

/** The step node a field points at (`nodes.<i>.config.<key>` of a workflow), if any. */
function stepOf(assets: Record<string, any>, field: Pick<RequirementField, 'target'>): { node: any; key: string } | null {
  const { section, asset_id: assetId, path } = field.target
  if (section !== 'workflows' || path.length !== 4 || path[0] !== 'nodes' || typeof path[1] !== 'number' || path[2] !== 'config') return null
  const node = findAsset(assets, section, assetId)?.nodes?.[path[1]]
  return node && typeof node === 'object' ? { node, key: String(path[3]) } : null
}

/** What a `user` requirement field can take, from the step it points at. */
export function assigneeTargetOf(assets: Record<string, any>, field: Pick<RequirementField, 'type' | 'target'>): AssigneeTarget {
  const declared = declaredKind(field)
  const step = stepOf(assets, field)
  if (step?.node?.type === 'user_task') {
    if (ASSIGNMENT_KEYS[step.key] && step.node.config?.assignment_type !== 'aad_group') return { declared, accepts: ['user', 'team'], slot: 'assignment' }
    if (ESCALATION_KEYS[step.key]) return { declared, accepts: ['user', 'team'], slot: 'escalation' }
  }
  return { declared, accepts: [declared], slot: null }
}

/** Read a field value (see the header for the forms). */
export function parseAssigneeValue(value: unknown, target: Pick<AssigneeTarget, 'declared' | 'accepts'>): ParsedAssignee {
  if (typeof value !== 'string') return { error: 'Expected a user id, an email or team:<id>' }
  const text = value.trim()
  const prefixed = /^(user|team):(.+)$/i.exec(text)
  let parsed: Exclude<ParsedAssignee, { error: string }>
  if (prefixed) {
    const kind = prefixed[1].toLowerCase() as AssigneeKind
    const id = prefixed[2].trim()
    if (!UUID.test(id)) return { error: `“${text}” is not a valid ${kind === 'team' ? 'team' : 'user'} id` }
    parsed = kind === 'team' ? { kind: 'team', id } : { kind: 'user', id }
  } else if (UUID.test(text)) {
    parsed = target.declared === 'team' ? { kind: 'team', id: text } : { kind: 'user', id: text }
  } else if (isEmailLike(text)) {
    parsed = { kind: 'user', email: text.toLowerCase() }
  } else {
    return { error: `“${text}” is not a user id, an email or a team` }
  }
  if (!target.accepts.includes(parsed.kind)) {
    return { error: parsed.kind === 'team' ? 'This step can only be assigned to a person, not a team' : 'This step can only be assigned to a team' }
  }
  return parsed
}

/** The key/value pairs to write into a step config for a resolved choice (undefined = remove). */
export function assigneeWrites(target: AssigneeTarget, field: Pick<RequirementField, 'target'>, choice: { kind: AssigneeKind; id: string }): Array<{ path: Array<string | number>; value: unknown }> {
  const path = field.target.path
  if (!target.slot) return [{ path, value: choice.id }]
  const config = path.slice(0, path.length - 1)
  const at = (key: string, value: unknown) => ({ path: [...config, key], value })
  const switching = choice.kind !== target.declared
  if (target.slot === 'assignment') {
    return choice.kind === 'team'
      ? [at('team_id', choice.id), at('assignment_type', 'team'), ...(switching ? [at('assignee_id', undefined), at('assignee_name', undefined)] : [])]
      : [at('assignee_id', choice.id), at('assignment_type', 'individual'), ...(switching ? [at('team_id', undefined)] : [])]
  }
  return choice.kind === 'team'
    ? [at('escalation_team_id', choice.id), at('escalation_type', 'team'), ...(switching ? [at('escalation_user_id', undefined)] : [])]
    : [at('escalation_user_id', choice.id), at('escalation_type', 'individual'), ...(switching ? [at('escalation_team_id', undefined)] : [])]
}

/** Apply writes to one asset (in place; undefined removes the key). */
export function writeAssignee(asset: any, writes: Array<{ path: Array<string | number>; value: unknown }>): void {
  for (const { path, value } of writes) {
    let node = asset
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i] as any
      if (node[seg] === null || typeof node[seg] !== 'object') {
        if (value === undefined) { node = null; break }
        node[seg] = typeof path[i + 1] === 'number' ? [] : {}
      }
      node = node[seg]
    }
    if (!node) continue
    const leaf = path[path.length - 1] as any
    if (value === undefined) delete node[leaf]
    else node[leaf] = value
  }
}

/** Canonical value for a picked person / team (what the form sends). */
export function assigneeValue(choice: { kind: AssigneeKind; id: string }): string {
  return choice.kind === 'team' ? `team:${choice.id}` : choice.id
}

type Values = Record<string, Record<string, unknown>>

/** Every `user` requirement field (the assignees), with what it accepts. */
export function assigneeFields<R extends { id: string; kind: string; fields: Array<{ key: string; assignee?: { accepts: AssigneeKind[] } | null; type: string }> }>(requirements: R[]): Array<{ requirementId: string; key: string; accepts: AssigneeKind[] }> {
  const out: Array<{ requirementId: string; key: string; accepts: AssigneeKind[] }> = []
  for (const requirement of requirements) {
    if (requirement.kind !== 'user') continue
    for (const field of requirement.fields) {
      out.push({ requirementId: requirement.id, key: field.key, accepts: field.assignee?.accepts?.length ? field.assignee.accepts : [field.type === 'user' ? 'user' : 'team'] })
    }
  }
  return out
}

/**
 * "Assign all to…": put one person or team in every assignee field that is
 * still empty (no value typed here and none kept from before) and can take
 * it. Returns the next values and how many fields were filled / skipped
 * because the step cannot take that kind.
 */
export function fillEmptyAssignees<R extends { id: string; kind: string; fields: Array<{ key: string; assignee?: AssigneeFieldInfo | null; type: string }>; field_states?: Array<{ key: string; state: string }> }>(
  requirements: R[],
  values: Values,
  choice: { kind: AssigneeKind; id: string },
): { values: Values; filled: number; skipped: number } {
  const next: Values = { ...values }
  let filled = 0
  let skipped = 0
  const value = assigneeValue(choice)
  for (const requirement of requirements) {
    if (requirement.kind !== 'user') continue
    const states = new Map((requirement.field_states ?? []).map((s) => [s.key, s.state]))
    for (const field of requirement.fields) {
      const typed = String(values[requirement.id]?.[field.key] ?? '').trim()
      // Kept from before: a valid earlier choice (or a value already on the local step).
      const kept = Boolean(field.assignee?.current) || states.get(field.key) === 'stored'
      if (typed || kept) continue
      const accepts = field.assignee?.accepts?.length ? field.assignee.accepts : [field.type === 'user' ? 'user' : 'team']
      if (!accepts.includes(choice.kind)) { skipped++; continue }
      next[requirement.id] = { ...(next[requirement.id] ?? {}), [field.key]: value }
      filled++
    }
  }
  return { values: next, filled, skipped }
}

/** Requirement ids + field keys of the `user` requirements in a list (server helper). */
export function userRequirementFields(requirements: PackageRequirement[]): Array<{ requirement: PackageRequirement; field: RequirementField }> {
  return requirements.filter((r) => r.kind === 'user').flatMap((requirement) => requirement.fields.map((field) => ({ requirement, field })))
}

/**
 * Text typed or pasted into the picker and confirmed with Enter, against what
 * a search for it found: an email picks the person with exactly that email
 * (or says nobody in the workspace has it); other text picks the only match.
 */
export function resolveTypedAssignee(
  text: string,
  found: { people: Array<{ id: string; name: string; email: string | null }>; teams: Array<{ id: string; name: string; member_count?: number }> },
  accepts: AssigneeKind[],
): { choice: AssigneeChoice } | { error: string } {
  const typed = text.trim()
  if (isEmailLike(typed)) {
    if (!accepts.includes('user')) return { error: 'This step takes a team: pick one from the list' }
    const person = found.people.find((p) => (p.email ?? '').toLowerCase() === typed.toLowerCase())
    return person ? { choice: { kind: 'user', id: person.id, name: person.name, email: person.email } } : { error: `No one in this workspace has the email ${typed}` }
  }
  const people = accepts.includes('user') ? found.people : []
  const teams = accepts.includes('team') ? found.teams : []
  if (people.length + teams.length === 1) {
    const [person] = people
    const [team] = teams
    return { choice: person ? { kind: 'user', id: person.id, name: person.name, email: person.email } : { kind: 'team', id: team.id, name: team.name, member_count: team.member_count } }
  }
  return { error: people.length + teams.length ? `Several match “${typed}”: pick one from the list` : `Nothing in this workspace matches “${typed}”` }
}
