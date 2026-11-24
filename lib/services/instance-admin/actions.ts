import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import {
  INSTANCE_ACTION_INPUTS, INSTANCE_ACTION_LABELS, SUPPORT_ACTOR_LABEL, SUPPORT_AUDIT_VIA,
  type InstanceAction, type InstanceActionResult,
} from '@/lib/instance-admin/schema'
import { INVITATION_TTL_MS, newInvitationToken, sendInvitationEmail } from '@/lib/invitations'
import { grantTenantEntitlement, listTenantEntitlements } from '@/lib/licensing/admin'
import { resumeLicencePausedRuns } from '@/lib/licensing/paused-runs'
import { rateLimit } from '@/lib/rate-limit'
import { ServiceError, type ServiceContext } from '../context'
import { instanceDb, requireInstanceAdmin, type InstanceAdmin } from './access'
import { revokeSessions, sendPasswordReset, unlockAccount } from './auth-state'
import { invitationStatus } from './reads'

/**
 * On-behalf actions of instance admins. Every action:
 *
 *  1. needs an instance admin (requireInstanceAdmin, 30 actions a minute);
 *  2. needs a reason (3–1000 characters) and validates its input;
 *  3. needs the instance admin audit table (migration 20270129090000):
 *     without it the action is refused — nothing happens unaudited;
 *  4. replays the first result for a repeated idempotency key, and is
 *     idempotent by nature where it can be (unlocking an unlocked account,
 *     setting the role someone already has: outcome "noop");
 *  5. is recorded twice: in instance_admin_audit (who, target, reason,
 *     outcome) and in the TARGET workspace's own audit log as
 *     "UserTasks support (on behalf)" with the admin's email, the action and
 *     the reason (object_audit_log, actor_id NULL, metadata.via =
 *     'instance_support'). Refusals are recorded in the instance trail.
 *
 * Never: impersonation, reading content, setting passwords (a reset email
 * through the normal flow is allowed).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

const MIGRATION = '20270129090000_instance_admin.sql'

export class InstanceAuditUnavailable extends ServiceError {
  constructor() {
    super('internal', `On-behalf actions are switched off until the instance admin audit table exists: apply migration ${MIGRATION}`, { status: 503 })
  }
}

let auditChecked = 0
async function requireAuditTable(): Promise<void> {
  if (Date.now() - auditChecked < 60_000) return
  const { error } = await (instanceDb() as any).from('instance_admin_audit').select('id', { head: true, count: 'exact' }).limit(1)
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message ?? '') || error.code === '42P01' || error.code === 'PGRST205') throw new InstanceAuditUnavailable()
    throw new Error(`instance_admin_audit: ${error.message}`)
  }
  auditChecked = Date.now()
}

/** Tests: re-check the audit table next time. */
export function resetInstanceActionsForTests(): void {
  auditChecked = 0
}

interface Target {
  workspaceId: string | null
  userId: string | null
  type: string
  id: string | null
  label: string | null
}

interface Done {
  outcome: 'ok' | 'noop'
  message: string
  detail: Record<string, string | number | boolean | null | undefined>
  /** Workspace audit row (skipped for noop). */
  workspaceAudit?: { objectType: string; objectId: string; summary: string } | null
}

async function writeInstanceAudit(admin: InstanceAdmin, action: InstanceAction, target: Target, reason: string, outcome: string, detail: Record<string, unknown>, ip: string | null, idempotencyKey: string | null): Promise<number | null> {
  const { data, error } = await (instanceDb() as any).from('instance_admin_audit').insert({
    admin_user_id: admin.userId, admin_email: admin.email, action, target_tenant_id: target.workspaceId, target_user_id: target.userId,
    target_type: target.type, target_id: target.id, target_label: target.label?.slice(0, 320) ?? null, reason, outcome,
    detail, via: admin.via, ip: ip?.slice(0, 64) ?? null, idempotency_key: idempotencyKey,
  }).select('id').single()
  if (error) {
    // A concurrent replay of the same key: the first row stands.
    if (error.code === '23505') return null
    throw new Error(`instance_admin_audit: ${error.message}`)
  }
  return Number(data.id)
}

/** The row the target workspace's own audit log shows. */
async function writeWorkspaceAudit(admin: InstanceAdmin, action: InstanceAction, workspaceId: string, row: { objectType: string; objectId: string; summary: string }, reason: string, auditId: number | null): Promise<boolean> {
  const { error } = await (instanceDb() as any).from('object_audit_log').insert({
    tenant_id: workspaceId, actor_id: null, object_type: row.objectType, object_id: row.objectId, action: `support.${action}`,
    summary: `${SUPPORT_ACTOR_LABEL}: ${row.summary}`.slice(0, 500),
    metadata: { via: SUPPORT_AUDIT_VIA, actor_label: SUPPORT_ACTOR_LABEL, support_admin: admin.email, reason, instance_audit_id: auditId, channel: admin.via },
  })
  if (error) console.error('[instance-admin] workspace audit write failed:', error.message)
  return !error
}

async function replay(admin: InstanceAdmin, key: string): Promise<InstanceActionResult | null> {
  const { data } = await (instanceDb() as any).from('instance_admin_audit').select('id, action, outcome, detail, target_tenant_id, target_user_id')
    .eq('admin_user_id', admin.userId).eq('idempotency_key', key).maybeSingle()
  if (!data) return null
  const stored = (data.detail?.result ?? null) as InstanceActionResult | null
  if (!stored) return null
  return { ...stored, audit_id: Number(data.id), replayed: true }
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

async function loadUser(userId: string): Promise<{ id: string; email: string; display_name: string | null }> {
  const { data } = await (instanceDb() as any).from('users').select('id, email, display_name').eq('id', userId).is('deleted_at', null).maybeSingle()
  if (!data) throw ServiceError.notFound('No such person')
  return data
}

async function loadTenant(tenantId: string): Promise<{ id: string; name: string; slug: string }> {
  const { data } = await (instanceDb() as any).from('tenants').select('id, name, slug').eq('id', tenantId).is('deleted_at', null).maybeSingle()
  if (!data) throw ServiceError.notFound('No such workspace')
  return data
}

async function systemRole(tenantId: string, slug: string): Promise<string> {
  const { data } = await (instanceDb() as any).from('roles').select('id').eq('tenant_id', tenantId).eq('slug', slug).eq('is_system', true).maybeSingle()
  if (!data) throw ServiceError.validation(`The workspace has no ${slug} role`)
  return data.id
}

async function membership(tenantId: string, userId: string): Promise<{ id: string; is_active: boolean } | null> {
  const { data } = await (instanceDb() as any).from('user_memberships').select('id, is_active').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
  return data ?? null
}

async function roleSlugsOf(tenantId: string, userId: string): Promise<string[]> {
  const db = instanceDb() as any
  const { data: links } = await db.from('user_roles').select('role_id').eq('tenant_id', tenantId).eq('user_id', userId)
  const ids = ((links ?? []) as any[]).map((l) => l.role_id)
  if (!ids.length) return []
  const { data } = await db.from('roles').select('slug').in('id', ids)
  return ((data ?? []) as any[]).map((r) => r.slug)
}

/** Active owners of a workspace (for the last-owner guard). */
async function activeOwnerIds(tenantId: string): Promise<string[]> {
  const db = instanceDb() as any
  const ownerRole = await systemRole(tenantId, 'owner').catch(() => null)
  if (!ownerRole) return []
  const { data: links } = await db.from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('role_id', ownerRole)
  const ids = ((links ?? []) as any[]).map((l) => l.user_id)
  if (!ids.length) return []
  const { data: active } = await db.from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', ids)
  return ((active ?? []) as any[]).map((m) => m.user_id)
}

async function guardLastOwner(tenantId: string, userId: string, losing: boolean): Promise<void> {
  if (!losing) return
  const owners = await activeOwnerIds(tenantId)
  if (owners.includes(userId) && owners.length <= 1) throw ServiceError.conflict('This is the workspace’s last owner: make someone else an owner first')
}

const LEGACY_ROLES = new Set(['owner', 'admin', 'manager', 'member', 'viewer'])

/* ── The actions ──────────────────────────────────────────────────────── */

type Handler = (input: any, admin: InstanceAdmin, target: Target) => Promise<Done>

const HANDLERS: Record<InstanceAction, { target: (input: any) => Promise<Target>; run: Handler }> = {
  unlock_user: {
    target: async (i) => { const u = await loadUser(i.user_id); return { workspaceId: null, userId: u.id, type: 'user', id: u.id, label: u.email } },
    run: async (i) => {
      const u = await loadUser(i.user_id)
      const r = await unlockAccount(u.id, u.email)
      return r.changed
        ? { outcome: 'ok', message: `Unlocked ${u.email}: cleared the ${r.cleared.join(' and ')}`, detail: { cleared: r.cleared.join(', '), auth: r.kind }, workspaceAudit: { objectType: 'member', objectId: u.id, summary: `Unlocked the account of ${u.email}` } }
        : { outcome: 'noop', message: `${u.email} was not locked (sign-in throttles cleared)`, detail: { auth: r.kind }, workspaceAudit: null }
    },
  },
  send_password_reset: {
    target: async (i) => { const u = await loadUser(i.user_id); return { workspaceId: null, userId: u.id, type: 'user', id: u.id, label: u.email } },
    run: async (i) => {
      const u = await loadUser(i.user_id)
      const limited = await rateLimit(`instance-admin:reset:${u.id}`, { max: 1, windowMs: 5 * 60_000 })
      if (!limited.ok) throw new ServiceError('rate_limited', 'A reset email was sent to this person in the last 5 minutes')
      await sendPasswordReset(u.email)
      return { outcome: 'ok', message: `Sent a password reset email to ${u.email}`, detail: {}, workspaceAudit: { objectType: 'member', objectId: u.id, summary: `Sent a password reset email to ${u.email}` } }
    },
  },
  force_sign_out: {
    target: async (i) => { const u = await loadUser(i.user_id); return { workspaceId: null, userId: u.id, type: 'user', id: u.id, label: u.email } },
    run: async (i) => {
      const u = await loadUser(i.user_id)
      const n = await revokeSessions(u.id)
      await invalidateCredentialCache()
      return n
        ? { outcome: 'ok', message: `Signed ${u.email} out of ${n} session${n === 1 ? '' : 's'}`, detail: { sessions: n }, workspaceAudit: { objectType: 'member', objectId: u.id, summary: `Signed ${u.email} out everywhere` } }
        : { outcome: 'noop', message: `${u.email} had no open sessions`, detail: { sessions: 0 }, workspaceAudit: null }
    },
  },
  invite_user: {
    target: async (i) => { const t = await loadTenant(i.workspace_id); return { workspaceId: t.id, userId: null, type: 'invitation', id: null, label: `${i.email} → ${t.name}` } },
    run: async (i, admin) => {
      const db = instanceDb() as any
      const tenant = await loadTenant(i.workspace_id)
      const { data: existingUser } = await db.from('users').select('id').ilike('email', i.email.replace(/[\\%_]/g, (m: string) => `\\${m}`)).is('deleted_at', null).maybeSingle()
      if (existingUser) {
        const m = await membership(tenant.id, existingUser.id)
        if (m?.is_active) return { outcome: 'noop', message: `${i.email} is already a member of ${tenant.name}`, detail: { user_id: existingUser.id }, workspaceAudit: null }
      }
      const { data: pending } = await db.from('invitations').select('id, role, accepted_at, expires_at').eq('tenant_id', tenant.id).ilike('email', i.email).is('accepted_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (pending && invitationStatus(pending) === 'pending') {
        return { outcome: 'noop', message: `${i.email} already has a pending invitation to ${tenant.name}: resend it instead`, detail: { invitation_id: pending.id, role: pending.role }, workspaceAudit: null }
      }
      const token = newInvitationToken()
      const { data, error } = await db.from('invitations').insert({
        tenant_id: tenant.id, email: i.email, role: i.role, invited_by: admin.userId, token, expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
      }).select('id').single()
      if (error || !data) throw new Error(`invitations: ${error?.message ?? 'insert failed'}`)
      const sent = await sendInvitationEmail({ to: i.email, role: i.role, token, tenantName: tenant.name, tenantSlug: tenant.slug, inviterName: `UserTasks support for ${tenant.name}` })
      return {
        outcome: 'ok', message: `Invited ${i.email} to ${tenant.name} as ${i.role}${sent.success ? '' : ' (the email failed: resend it)'}`,
        detail: { invitation_id: data.id, role: i.role, email_sent: sent.success },
        workspaceAudit: { objectType: 'member', objectId: data.id, summary: `Invited ${i.email} as ${i.role}` },
      }
    },
  },
  resend_invitation: {
    target: async (i) => {
      const { data } = await (instanceDb() as any).from('invitations').select('id, tenant_id, email').eq('id', i.invitation_id).maybeSingle()
      if (!data) throw ServiceError.notFound('No such invitation')
      return { workspaceId: data.tenant_id, userId: null, type: 'invitation', id: data.id, label: data.email }
    },
    run: async (i) => {
      const db = instanceDb() as any
      const { data: inv } = await db.from('invitations').select('id, tenant_id, email, role, accepted_at, expires_at').eq('id', i.invitation_id).maybeSingle()
      if (!inv) throw ServiceError.notFound('No such invitation')
      if (inv.accepted_at) throw ServiceError.conflict('This invitation has already been accepted')
      const limited = await rateLimit(`instance-admin:resend:${inv.id}`, { max: 1, windowMs: 60_000 })
      if (!limited.ok) throw new ServiceError('rate_limited', 'This invitation was resent less than a minute ago')
      const tenant = await loadTenant(inv.tenant_id)
      const token = newInvitationToken()
      const expires = new Date(Date.now() + INVITATION_TTL_MS).toISOString()
      const { error } = await db.from('invitations').update({ token, expires_at: expires }).eq('id', inv.id).eq('tenant_id', inv.tenant_id)
      if (error) throw new Error(`invitations: ${error.message}`)
      const sent = await sendInvitationEmail({ to: inv.email, role: inv.role, token, reminder: true, tenantName: tenant.name, tenantSlug: tenant.slug, inviterName: `UserTasks support for ${tenant.name}` })
      return {
        outcome: 'ok', message: `Resent the invitation to ${inv.email}${sent.success ? '' : ' (the email failed)'}`,
        detail: { invitation_id: inv.id, expires_at: expires, email_sent: sent.success },
        workspaceAudit: { objectType: 'member', objectId: inv.id, summary: `Resent the invitation for ${inv.email}` },
      }
    },
  },
  revoke_invitation: {
    target: async (i) => {
      const { data } = await (instanceDb() as any).from('invitations').select('id, tenant_id, email').eq('id', i.invitation_id).maybeSingle()
      if (!data) throw ServiceError.notFound('No such invitation')
      return { workspaceId: data.tenant_id, userId: null, type: 'invitation', id: data.id, label: data.email }
    },
    run: async (i) => {
      const db = instanceDb() as any
      const { data: inv } = await db.from('invitations').select('id, tenant_id, email, accepted_at').eq('id', i.invitation_id).maybeSingle()
      if (!inv) return { outcome: 'noop', message: 'The invitation was already revoked', detail: {}, workspaceAudit: null }
      if (inv.accepted_at) throw ServiceError.conflict('This invitation has already been accepted: deactivate the member instead')
      const { error } = await db.from('invitations').delete().eq('id', inv.id).eq('tenant_id', inv.tenant_id)
      if (error) throw new Error(`invitations: ${error.message}`)
      return { outcome: 'ok', message: `Revoked the invitation for ${inv.email}`, detail: { invitation_id: inv.id }, workspaceAudit: { objectType: 'member', objectId: inv.id, summary: `Revoked the invitation for ${inv.email}` } }
    },
  },
  change_role: {
    target: async (i) => { const [t, u] = await Promise.all([loadTenant(i.workspace_id), loadUser(i.user_id)]); return { workspaceId: t.id, userId: u.id, type: 'member', id: u.id, label: `${u.email} in ${t.name}` } },
    run: async (i) => {
      const db = instanceDb() as any
      const [tenant, user] = await Promise.all([loadTenant(i.workspace_id), loadUser(i.user_id)])
      const m = await membership(tenant.id, user.id)
      if (!m) throw ServiceError.notFound(`${user.email} is not a member of ${tenant.name}`)
      if (!m.is_active) throw ServiceError.conflict(`${user.email} is deactivated in ${tenant.name}: reactivate them with a role instead`)
      const before = await roleSlugsOf(tenant.id, user.id)
      if (before.length === 1 && before[0] === i.role) return { outcome: 'noop', message: `${user.email} is already ${i.role} in ${tenant.name}`, detail: { role: i.role }, workspaceAudit: null }
      await guardLastOwner(tenant.id, user.id, before.includes('owner') && i.role !== 'owner')
      const roleId = await systemRole(tenant.id, i.role)
      const { error: delErr } = await db.from('user_roles').delete().eq('tenant_id', tenant.id).eq('user_id', user.id)
      if (delErr) throw new Error(`user_roles: ${delErr.message}`)
      const { error } = await db.from('user_roles').insert({ tenant_id: tenant.id, user_id: user.id, role_id: roleId })
      if (error) throw new Error(`user_roles: ${error.message}`)
      if (LEGACY_ROLES.has(i.role)) await db.from('user_memberships').update({ role: i.role }).eq('id', m.id).then(() => {}, () => {})
      await invalidateCredentialCache()
      return {
        outcome: 'ok', message: `${user.email} is now ${i.role} in ${tenant.name} (was ${before.join(', ') || 'no role'})`,
        detail: { role: i.role, previous: before.join(', ') || null },
        workspaceAudit: { objectType: 'member', objectId: user.id, summary: `Changed ${user.email}'s role from ${before.join(', ') || 'none'} to ${i.role}` },
      }
    },
  },
  deactivate_member: {
    target: async (i) => { const [t, u] = await Promise.all([loadTenant(i.workspace_id), loadUser(i.user_id)]); return { workspaceId: t.id, userId: u.id, type: 'member', id: u.id, label: `${u.email} in ${t.name}` } },
    run: async (i) => {
      const db = instanceDb() as any
      const [tenant, user] = await Promise.all([loadTenant(i.workspace_id), loadUser(i.user_id)])
      const m = await membership(tenant.id, user.id)
      if (!m) throw ServiceError.notFound(`${user.email} is not a member of ${tenant.name}`)
      if (!m.is_active) return { outcome: 'noop', message: `${user.email} is already deactivated in ${tenant.name}`, detail: {}, workspaceAudit: null }
      const before = await roleSlugsOf(tenant.id, user.id)
      await guardLastOwner(tenant.id, user.id, true)
      const { error } = await db.from('user_memberships').update({ is_active: false }).eq('id', m.id)
      if (error) throw new Error(`user_memberships: ${error.message}`)
      await db.from('user_roles').delete().eq('tenant_id', tenant.id).eq('user_id', user.id)
      await invalidateCredentialCache()
      return {
        outcome: 'ok', message: `Deactivated ${user.email} in ${tenant.name}`, detail: { previous: before.join(', ') || null },
        workspaceAudit: { objectType: 'member', objectId: user.id, summary: `Deactivated ${user.email} (was ${before.join(', ') || 'no role'})` },
      }
    },
  },
  reactivate_member: {
    target: async (i) => { const [t, u] = await Promise.all([loadTenant(i.workspace_id), loadUser(i.user_id)]); return { workspaceId: t.id, userId: u.id, type: 'member', id: u.id, label: `${u.email} in ${t.name}` } },
    run: async (i) => {
      const db = instanceDb() as any
      const [tenant, user] = await Promise.all([loadTenant(i.workspace_id), loadUser(i.user_id)])
      const m = await membership(tenant.id, user.id)
      if (!m) throw ServiceError.notFound(`${user.email} was never a member of ${tenant.name}: invite them instead`)
      const roles = await roleSlugsOf(tenant.id, user.id)
      if (m.is_active && roles.length) return { outcome: 'noop', message: `${user.email} is already active in ${tenant.name}`, detail: { role: roles.join(', ') }, workspaceAudit: null }
      const role = i.role ?? 'member'
      const roleId = await systemRole(tenant.id, role)
      const { error } = await db.from('user_memberships').update({ is_active: true, ...(LEGACY_ROLES.has(role) ? { role } : {}) }).eq('id', m.id)
      if (error) throw new Error(`user_memberships: ${error.message}`)
      if (!roles.length) await db.from('user_roles').insert({ tenant_id: tenant.id, user_id: user.id, role_id: roleId })
      await invalidateCredentialCache()
      return {
        outcome: 'ok', message: `Reactivated ${user.email} in ${tenant.name} as ${roles.join(', ') || role}`, detail: { role: roles.join(', ') || role },
        workspaceAudit: { objectType: 'member', objectId: user.id, summary: `Reactivated ${user.email} as ${roles.join(', ') || role}` },
      }
    },
  },
  extend_trial: {
    target: async (i) => { const t = await loadTenant(i.workspace_id); return { workspaceId: t.id, userId: null, type: 'licence', id: i.extension_id, label: `${i.extension_id} in ${t.name}` } },
    run: async (i, admin) => {
      const tenant = await loadTenant(i.workspace_id)
      const existing = (await listTenantEntitlements({ tenantId: tenant.id, extensionId: i.extension_id }))[0] as any
      if (!existing) throw ServiceError.notFound(`${tenant.name} has no ${i.extension_id} licence or trial to extend`)
      const base = existing.ends_at && new Date(existing.ends_at).getTime() > Date.now() ? new Date(existing.ends_at) : new Date()
      const endsAt = i.ends_at ? new Date(i.ends_at) : new Date(base.getTime() + (i.days ?? 14) * 86_400_000)
      if (endsAt.getTime() <= Date.now()) throw ServiceError.validation('The new end date must be in the future')
      if (existing.ends_at && new Date(existing.ends_at).getTime() >= endsAt.getTime() && existing.status === 'active') {
        return { outcome: 'noop', message: `${i.extension_id} in ${tenant.name} already runs until ${new Date(existing.ends_at).toISOString().slice(0, 10)}`, detail: { ends_at: existing.ends_at }, workspaceAudit: null }
      }
      if (existing.starts_at && new Date(existing.starts_at).getTime() >= endsAt.getTime()) throw ServiceError.validation('The new end date must be after the start date')
      await grantTenantEntitlement({
        tenant_id: tenant.id, extension_id: i.extension_id, edition: existing.edition ?? null, features: existing.features ?? [], limits: existing.limits ?? {},
        status: 'active', source: existing.source, starts_at: existing.starts_at ?? null, ends_at: endsAt.toISOString(), notes: existing.notes ?? null,
      }, { actorId: admin.userId, actor: `instance admin ${admin.email}` })
      return {
        outcome: 'ok', message: `Extended ${i.extension_id} (${existing.source}) in ${tenant.name} to ${endsAt.toISOString().slice(0, 10)}`,
        detail: { extension_id: i.extension_id, previous_ends_at: existing.ends_at ?? null, ends_at: endsAt.toISOString(), source: existing.source },
        workspaceAudit: { objectType: 'licence', objectId: i.extension_id, summary: `Extended the ${i.extension_id} ${existing.source === 'trial' ? 'trial' : 'licence'} to ${endsAt.toISOString().slice(0, 10)}` },
      }
    },
  },
  reactivate_licence: {
    target: async (i) => { const t = await loadTenant(i.workspace_id); return { workspaceId: t.id, userId: null, type: 'licence', id: i.extension_id, label: `${i.extension_id} in ${t.name}` } },
    run: async (i, admin) => {
      const tenant = await loadTenant(i.workspace_id)
      const existing = (await listTenantEntitlements({ tenantId: tenant.id, extensionId: i.extension_id }))[0] as any
      if (!existing) throw ServiceError.notFound(`${tenant.name} has no ${i.extension_id} licence`)
      if (existing.status === 'active') return { outcome: 'noop', message: `${i.extension_id} in ${tenant.name} is already active`, detail: {}, workspaceAudit: null }
      if (existing.status === 'revoked') throw ServiceError.conflict('A revoked licence is not reactivated from here: grant a new one in Settings → Licence')
      await grantTenantEntitlement({
        tenant_id: tenant.id, extension_id: i.extension_id, edition: existing.edition ?? null, features: existing.features ?? [], limits: existing.limits ?? {},
        status: 'active', source: existing.source, starts_at: existing.starts_at ?? null, ends_at: existing.ends_at ?? null, notes: existing.notes ?? null,
      }, { actorId: admin.userId, actor: `instance admin ${admin.email}` })
      return {
        outcome: 'ok', message: `Reactivated ${i.extension_id} in ${tenant.name}`, detail: { extension_id: i.extension_id, previous: existing.status },
        workspaceAudit: { objectType: 'licence', objectId: i.extension_id, summary: `Reactivated the suspended ${i.extension_id} licence` },
      }
    },
  },
  resume_paused_runs: {
    target: async (i) => { const t = await loadTenant(i.workspace_id); return { workspaceId: t.id, userId: null, type: 'workspace', id: t.id, label: t.name } },
    run: async (i) => {
      const tenant = await loadTenant(i.workspace_id)
      const r = await resumeLicencePausedRuns(instanceDb(), { tenantId: tenant.id, extensionId: i.extension_id ?? 'licence', limit: 50 })
      if (!r.resumed && !r.failed) return { outcome: 'noop', message: `${tenant.name} has no licence-paused runs`, detail: { remaining: r.remaining }, workspaceAudit: null }
      return {
        outcome: 'ok', message: `Resumed ${r.resumed} licence-paused run${r.resumed === 1 ? '' : 's'} in ${tenant.name}${r.failed ? ` (${r.failed} failed)` : ''}`,
        detail: { resumed: r.resumed, failed: r.failed, remaining: r.remaining },
        workspaceAudit: { objectType: 'workspace', objectId: tenant.id, summary: `Resumed ${r.resumed} workflow runs paused by a lapsed licence` },
      }
    },
  },
}

/**
 * Run one on-behalf action. `ip` and `via` go to the instance trail.
 * Throws ServiceError for refusals (each refusal of an admin is recorded).
 */
export async function runInstanceAction(
  ctx: ServiceContext,
  action: InstanceAction,
  rawInput: unknown,
  options: { ip?: string | null; via?: InstanceAdmin['via']; admin?: InstanceAdmin } = {},
): Promise<InstanceActionResult> {
  const admin = options.admin ?? await requireInstanceAdmin(ctx, { kind: 'action', via: options.via })
  const schema = INSTANCE_ACTION_INPUTS[action]
  if (!schema) throw ServiceError.validation('Unknown action')
  const parsed = schema.safeParse(rawInput ?? {})
  if (!parsed.success) throw ServiceError.validation(`${INSTANCE_ACTION_LABELS[action]}: ${parsed.error.issues[0]?.message ?? 'check the fields'}`, parsed.error.issues)
  const input = parsed.data as any
  await requireAuditTable()
  const key: string | null = input.idempotency_key ?? null
  if (key) {
    const replayed = await replay(admin, key)
    if (replayed) return replayed
  }
  const handler = HANDLERS[action]
  let target: Target
  try {
    target = await handler.target(input)
  } catch (error) {
    await writeInstanceAudit(admin, action, { workspaceId: input.workspace_id ?? null, userId: input.user_id ?? null, type: 'unknown', id: input.invitation_id ?? null, label: null }, input.reason, 'refused', { error: (error as Error).message }, options.ip ?? null, null).catch(() => null)
    throw error
  }
  let done: Done
  try {
    done = await handler.run(input, admin, target)
  } catch (error) {
    const refused = error instanceof ServiceError && error.status < 500
    await writeInstanceAudit(admin, action, target, input.reason, refused ? 'refused' : 'error', { error: (error as Error).message.slice(0, 500) }, options.ip ?? null, null).catch(() => null)
    throw error
  }
  const result: InstanceActionResult = {
    action, outcome: done.outcome, message: done.message, workspace_id: target.workspaceId, user_id: target.userId, detail: done.detail as InstanceActionResult['detail'], audit_id: null,
  }
  const auditId = await writeInstanceAudit(admin, action, target, input.reason, done.outcome, { ...done.detail, result }, options.ip ?? null, key)
  result.audit_id = auditId
  if (done.workspaceAudit) {
    // The workspace(s) that see it: the target workspace, else (account actions) every workspace the person belongs to.
    let workspaces = target.workspaceId ? [target.workspaceId] : []
    if (!workspaces.length && target.userId) {
      const { data } = await (instanceDb() as any).from('user_memberships').select('tenant_id').eq('user_id', target.userId).eq('is_active', true).limit(50)
      workspaces = ((data ?? []) as any[]).map((m) => m.tenant_id)
    }
    const written = await Promise.all(workspaces.map((w) => writeWorkspaceAudit(admin, action, w, done.workspaceAudit!, input.reason, auditId)))
    result.detail = { ...result.detail, workspace_audit_rows: written.filter(Boolean).length }
  }
  return result
}
