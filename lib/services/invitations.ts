/**
 * Workspace invitations: list, send, revoke, resend. Shared by
 * /api/v1/invitations, the MCP invitations_* tools and the invitation server
 * actions. Every operation needs team.invite (as the invitations page does).
 *
 * The acceptance token is a bearer credential for joining the workspace, so
 * it is never returned — only emailed (lib/invitations.ts builds the email).
 * An invitation is attributed to the acting user, or for tenant API keys to
 * the key's creator; `invitations.invited_by` is mandatory.
 */

import { INVITABLE_ROLES, INVITATION_TTL_MS, newInvitationToken, sendInvitationEmail } from '@/lib/invitations'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- invitations rows */

const COLUMNS = 'id, email, role, invited_by, accepted_at, expires_at, created_at'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export interface InvitationRow {
  id: string
  email: string
  role: string
  invited_by: string | null
  accepted_at: string | null
  expires_at: string
  created_at: string
}

function inviterId(ctx: ServiceContext): string {
  const id = ctx.actorId ?? ctx.credentialOwnerId ?? null
  if (!id) throw ServiceError.validation('Invitations must be attributed to a user: use a user-context key, an OAuth login or a key with a known creator')
  return id
}

async function senderDetails(ctx: ServiceContext, userId: string) {
  const [{ data: inviter }, { data: tenant }] = await Promise.all([
    (ctx.supabase as any).from('users').select('display_name, email').eq('id', userId).maybeSingle(),
    (ctx.supabase as any).from('tenants').select('name, slug').eq('id', ctx.tenantId).maybeSingle(),
  ])
  return {
    inviterName: (inviter?.display_name || inviter?.email || null) as string | null,
    tenantName: (tenant?.name ?? null) as string | null,
    tenantSlug: (tenant?.slug ?? null) as string | null,
  }
}

async function loadInvitation(ctx: ServiceContext, invitationId: string): Promise<InvitationRow> {
  const { data, error } = await (ctx.supabase as any).from('invitations')
    .select(COLUMNS).eq('id', invitationId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Invitation not found')
  return data as InvitationRow
}

/** Public shape: the token is dropped even if a client returned it. */
function withStatus(raw: InvitationRow & { token?: string }) {
  const row = { ...raw }
  delete row.token
  return { ...row, status: row.accepted_at ? 'accepted' : new Date(row.expires_at).getTime() < Date.now() ? 'expired' : 'pending' }
}

/** Invitations, newest first. `status`: pending (default; not yet accepted) or all. */
export async function listInvitations(ctx: ServiceContext, filters: { status?: 'pending' | 'all' } = {}, page: Page) {
  requirePerm(ctx, 'team.invite')
  let query = (ctx.supabase as any).from('invitations')
    .select(COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
  if ((filters.status ?? 'pending') === 'pending') query = query.is('accepted_at', null)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const rows = (data ?? []) as InvitationRow[]
  return { invitations: rows.map(withStatus), total: (count ?? rows.length) as number }
}

export async function sendInvitation(ctx: ServiceContext, input: { email: string; role?: string }) {
  requirePerm(ctx, 'team.invite')
  const email = String(input.email ?? '').toLowerCase().trim()
  if (!EMAIL_PATTERN.test(email) || email.length > 320) throw ServiceError.validation('A valid email address is required')
  const role = (input.role ?? 'member') as InvitableRole
  if (!INVITABLE_ROLES.includes(role)) throw ServiceError.validation(`role must be one of: ${INVITABLE_ROLES.join(', ')}`)
  const invitedBy = inviterId(ctx)

  const { data: member } = await (ctx.supabase as any).from('users')
    .select('id').eq('email', email).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (member) throw ServiceError.conflict('This user is already a member of this organisation')
  const { data: pending } = await (ctx.supabase as any).from('invitations')
    .select('id').eq('email', email).eq('tenant_id', ctx.tenantId).is('accepted_at', null).maybeSingle()
  if (pending) throw ServiceError.conflict('This email has already been invited; resend the existing invitation instead')

  const token = newInvitationToken()
  const { data, error } = await (ctx.supabase as any).from('invitations').insert({
    tenant_id: ctx.tenantId,
    email,
    role,
    invited_by: invitedBy,
    token,
    expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
  }).select(COLUMNS).single()
  if (error?.code === '23505') throw ServiceError.conflict('This email has already been invited')
  if (error || !data) throw dbError(error, 'Failed to create invitation')

  const sender = await senderDetails(ctx, invitedBy)
  const sent = await sendInvitationEmail({ to: email, role, token, ...sender })
  if (!sent.success) console.error('[invitations] email failed:', sent.error)
  await audit(ctx, { objectType: 'team', objectId: data.id, action: 'create', summary: `Invited ${email} as ${role}`, metadata: { invitation: true, email_sent: sent.success } })
  // The invitation is kept even when the email fails — it can be resent.
  return { invitation: withStatus(data as InvitationRow), email_sent: sent.success, ...(sent.success ? {} : { email_error: sent.error ?? 'Failed to send email' }) }
}

/** Delete an invitation (its link stops working). */
export async function revokeInvitation(ctx: ServiceContext, invitationId: string) {
  requirePerm(ctx, 'team.invite')
  const invitation = await loadInvitation(ctx, invitationId)
  const { error } = await (ctx.supabase as any).from('invitations').delete().eq('id', invitationId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to revoke invitation')
  await audit(ctx, { objectType: 'team', objectId: invitationId, action: 'revoke', summary: `Revoked the invitation for ${invitation.email}`, metadata: { invitation: true } })
  return { revoked: true as const, id: invitationId }
}

/** Issue a fresh token and expiry for a pending invitation and email it again. */
export async function resendInvitation(ctx: ServiceContext, invitationId: string) {
  requirePerm(ctx, 'team.invite')
  const invitation = await loadInvitation(ctx, invitationId)
  if (invitation.accepted_at) throw ServiceError.conflict('This invitation has already been accepted')
  const token = newInvitationToken()
  const { data, error } = await (ctx.supabase as any).from('invitations')
    .update({ token, expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString() })
    .eq('id', invitationId).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to refresh invitation')
  const sender = await senderDetails(ctx, ctx.actorId ?? ctx.credentialOwnerId ?? invitation.invited_by ?? '')
  const sent = await sendInvitationEmail({ to: invitation.email, role: invitation.role, token, reminder: true, ...sender })
  if (!sent.success) console.error('[invitations] resend email failed:', sent.error)
  await audit(ctx, { objectType: 'team', objectId: invitationId, action: 'update', summary: `Resent the invitation for ${invitation.email}`, metadata: { invitation: true, email_sent: sent.success } })
  return { invitation: withStatus(data as InvitationRow), email_sent: sent.success, ...(sent.success ? {} : { email_error: sent.error ?? 'Failed to send email' }) }
}
