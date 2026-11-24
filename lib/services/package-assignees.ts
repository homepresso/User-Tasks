/**
 * Package install / complete setup: checks the assignee (`user`
 * requirement) values against the target workspace before they are written
 * into the steps (lib/packages/assignees.ts for the value forms and what
 * each step can take).
 *
 *   - a user id must be an active member of this workspace
 *   - an email must belong to an active member of this workspace
 *   - a team id must be a team of this workspace
 *   - the step must take that kind (a team only where the step can be
 *     assigned to a team)
 *
 * Invalid values are removed (the field counts as empty); each comes back as
 * an error on its field, so the caller turns supplied ones into blockers and
 * kept ones (an earlier install's choice that is no longer valid) into
 * warnings. Valid values come back resolved, with the person's / team's name
 * (the picker shows them; an earlier choice is shown prefilled).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows and manifests */

import type { PackageRequirement, RequirementField } from '@/lib/packages/format'
import type { RequirementValues } from '@/lib/packages/requirements'
import { assigneeTargetOf, assigneeWrites, parseAssigneeValue, writeAssignee, type AssigneeChoice, type AssigneeFieldInfo, type AssigneeKind, type AssigneeTarget } from '@/lib/packages/assignees'
import type { AnySupabaseClient, ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'

export interface AssigneeFieldError {
  requirement: PackageRequirement
  field: RequirementField
  value: unknown
  message: string
  /** Sent in this request (else kept from an earlier install). */
  supplied: boolean
}

export interface AssigneeCheck {
  /** The values with the invalid assignee entries removed. */
  values: RequirementValues
  errors: AssigneeFieldError[]
  /** Per field (`<requirement id>\u0000<field key>`): what it accepts, who is chosen, what is wrong. */
  info: Map<string, AssigneeFieldInfo>
  /** Resolved choice for a field (value supplied or kept), if valid. */
  choiceFor: (requirement: PackageRequirement, field: RequirementField) => AssigneeChoice | undefined
  /** Whether the local step already holds a valid assignee (complete setup / upgrade). */
  storedValid: (requirement: PackageRequirement, field: RequirementField) => boolean
  targetFor: (field: RequirementField) => AssigneeTarget
}

export const assigneeInfoKey = (requirementId: string, fieldKey: string) => `${requirementId}\u0000${fieldKey}`

const isEmpty = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function checkPackageAssignees(db: AnySupabaseClient, tenantId: string, input: {
  requirements: PackageRequirement[]
  values: RequirementValues
  /** The values sent in this request (to tell supplied from kept). */
  supplied?: RequirementValues | null
  /** The manifest the requirement targets point into (steps decide what a field takes). */
  assets: Record<string, any>
  /** The value currently on the local step at the field's path (upgrade / complete setup). */
  stored?: (requirement: PackageRequirement, field: RequirementField) => unknown
}): Promise<AssigneeCheck> {
  const fields = input.requirements.filter((r) => r.kind === 'user').flatMap((requirement) => requirement.fields.map((field) => ({ requirement, field, target: assigneeTargetOf(input.assets, field) })))
  const parsed = new Map<string, ReturnType<typeof parseAssigneeValue>>()
  const storedIds = new Map<string, { kind: AssigneeKind; id: string }>()
  const userIds = new Set<string>()
  const emails = new Set<string>()
  const teamIds = new Set<string>()
  for (const { requirement, field, target } of fields) {
    const key = assigneeInfoKey(requirement.id, field.key)
    const value = input.values[requirement.id]?.[field.key]
    if (!isEmpty(value)) {
      const result = parseAssigneeValue(value, target)
      parsed.set(key, result)
      if ('id' in result) (result.kind === 'team' ? teamIds : userIds).add(result.id)
      else if ('email' in result) emails.add(result.email)
    }
    const local = input.stored?.(requirement, field)
    if (typeof local === 'string' && UUID.test(local)) {
      const kind = target.declared
      storedIds.set(key, { kind, id: local })
      ;(kind === 'team' ? teamIds : userIds).add(local)
    }
  }

  // Look-ups in this workspace only.
  const people = new Map<string, { id: string; name: string; email: string | null }>()
  const byEmail = new Map<string, string>()
  if (userIds.size || emails.size) {
    const candidates: any[] = []
    if (userIds.size) {
      const { data, error } = await (db as any).from('users').select('id, display_name, email, deleted_at').in('id', [...userIds])
      if (error) throw dbError(error)
      candidates.push(...(data ?? []))
    }
    if (emails.size) {
      const { data, error } = await (db as any).from('users').select('id, display_name, email, deleted_at').in('email', [...emails])
      if (error) throw dbError(error)
      candidates.push(...(data ?? []))
    }
    const ids = [...new Set(candidates.map((u) => String(u.id)))]
    const members = new Set<string>()
    if (ids.length) {
      const { data, error } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', ids)
      if (error) throw dbError(error)
      for (const row of data ?? []) members.add(String(row.user_id))
    }
    for (const user of candidates) {
      const id = String(user.id)
      if (!members.has(id) || user.deleted_at) continue
      people.set(id, { id, name: String(user.display_name || user.email || 'Someone'), email: user.email ?? null })
      if (user.email) byEmail.set(String(user.email).toLowerCase(), id)
    }
  }
  const teams = new Map<string, { id: string; name: string }>()
  if (teamIds.size) {
    const { data, error } = await (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', [...teamIds])
    if (error) throw dbError(error)
    for (const row of data ?? []) teams.set(String(row.id), { id: String(row.id), name: String(row.name ?? 'Team') })
  }

  const values: RequirementValues = structuredClone(input.values ?? {})
  const errors: AssigneeFieldError[] = []
  const info = new Map<string, AssigneeFieldInfo>()
  const choices = new Map<string, AssigneeChoice>()
  const validStored = new Set<string>()
  const personChoice = (id: string): AssigneeChoice | undefined => {
    const p = people.get(id)
    return p ? { kind: 'user', id: p.id, name: p.name, email: p.email } : undefined
  }
  const teamChoice = (id: string): AssigneeChoice | undefined => {
    const t = teams.get(id)
    return t ? { kind: 'team', id: t.id, name: t.name } : undefined
  }
  for (const { requirement, field, target } of fields) {
    const key = assigneeInfoKey(requirement.id, field.key)
    const result = parsed.get(key)
    const value = input.values[requirement.id]?.[field.key]
    const supplied = !isEmpty(input.supplied?.[requirement.id]?.[field.key])
    let choice: AssigneeChoice | undefined
    let message: string | undefined
    if (result) {
      if ('error' in result) message = result.error
      else if ('email' in result) {
        const id = byEmail.get(result.email)
        choice = id ? personChoice(id) : undefined
        if (!choice) message = `No one in this workspace has the email ${result.email}`
      } else if (result.kind === 'team') {
        choice = teamChoice(result.id)
        if (!choice) message = 'No team with this id in this workspace'
      } else {
        choice = personChoice(result.id)
        if (!choice) message = 'No member of this workspace has this user id'
      }
    }
    const stored = storedIds.get(key)
    const storedChoice = stored ? (stored.kind === 'team' ? teamChoice(stored.id) : personChoice(stored.id)) : undefined
    if (storedChoice) validStored.add(key)
    if (message) {
      errors.push({ requirement, field, value, message, supplied })
      if (values[requirement.id]) delete values[requirement.id][field.key]
    }
    if (choice) choices.set(key, choice)
    info.set(key, { accepts: target.accepts, current: choice ?? (message ? null : storedChoice ?? null), ...(message ? { error: message } : {}) })
  }
  const targets = new Map(fields.map(({ field, target }) => [field, target]))
  return {
    values,
    errors,
    info,
    choiceFor: (requirement, field) => choices.get(assigneeInfoKey(requirement.id, field.key)),
    storedValid: (requirement, field) => validStored.has(assigneeInfoKey(requirement.id, field.key)),
    targetFor: (field) => targets.get(field) ?? assigneeTargetOf(input.assets, field),
  }
}

/**
 * The applyRequirementValues writer for assignees: a resolved person / team
 * goes into the field the step reads it from (a team into team_id with the
 * assignment set to 'team', a person into assignee_id, …). Other
 * requirements fall through (false).
 */
export function assigneeWriter(check: AssigneeCheck) {
  return (asset: any, requirement: PackageRequirement, field: RequirementField): boolean => {
    if (requirement.kind !== 'user') return false
    const choice = check.choiceFor(requirement, field)
    // Invalid or empty: nothing written (the step keeps its unknown assignee).
    if (!choice) return true
    writeAssignee(asset, assigneeWrites(check.targetFor(field), field, choice))
    return true
  }
}

/** Requirement plan fields with the assignee metadata (plan responses only; never persisted). */
export function withAssigneeInfo<R extends { id: string; kind: string; fields: RequirementField[] }>(requirement: R, check: AssigneeCheck): R {
  if (requirement.kind !== 'user') return requirement
  return { ...requirement, fields: requirement.fields.map((field) => ({ ...field, assignee: check.info.get(assigneeInfoKey(requirement.id, field.key)) ?? { accepts: [check.targetFor(field).declared] } })) }
}

/** Drop the plan-only assignee metadata before a requirement list is stored. */
export function stripAssigneeInfo<R extends { fields: Array<Record<string, any>> }>(requirement: R): R {
  if (!requirement.fields.some((field) => 'assignee' in field)) return requirement
  return { ...requirement, fields: requirement.fields.map(({ assignee: _a, ...field }) => field) as R['fields'] }
}

/** The caller as an assignee choice in ctx's workspace (the picker's "Me"), or null when not an active member. */
export async function packageAssigneeMe(ctx: ServiceContext): Promise<AssigneeChoice | null> {
  if (!ctx.actorId) return null
  const db = await serviceRoleClient(ctx) as any
  const { data: member, error: memberError } = await db.from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('user_id', ctx.actorId).eq('is_active', true).maybeSingle()
  if (memberError) throw dbError(memberError)
  if (!member) return null
  const { data: user, error } = await db.from('users').select('id, display_name, email').eq('id', ctx.actorId).maybeSingle()
  if (error) throw dbError(error)
  return user ? { kind: 'user', id: String(user.id), name: String(user.display_name || user.email || 'Me'), email: user.email ?? null } : null
}

/** An active member of ctx's workspace with exactly this email (the picker's pasted email), or null. */
export async function findMemberByEmail(ctx: ServiceContext, email: string): Promise<{ kind: 'person'; id: string; name: string; email: string | null } | null> {
  const address = email.trim().toLowerCase()
  if (!address.includes('@') || address.length > 320) return null
  const db = await serviceRoleClient(ctx) as any
  const { data: users, error } = await db.from('users').select('id, display_name, email, deleted_at').ilike('email', address.replace(/[\\%_]/g, (c: string) => `\\${c}`)).limit(5)
  if (error) throw dbError(error)
  const candidates = ((users ?? []) as any[]).filter((u) => !u.deleted_at && String(u.email ?? '').toLowerCase() === address)
  if (!candidates.length) return null
  const { data: members, error: memberError } = await db.from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).in('user_id', candidates.map((u) => String(u.id)))
  if (memberError) throw dbError(memberError)
  const user = candidates.find((u) => ((members ?? []) as any[]).some((m) => String(m.user_id) === String(u.id)))
  return user ? { kind: 'person', id: String(user.id), name: String(user.display_name || user.email || 'Someone'), email: user.email ?? null } : null
}
