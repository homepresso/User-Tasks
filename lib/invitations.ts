import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { INVITABLE_ROLES } from '@/lib/invitation-roles'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'

export { INVITABLE_ROLES }

const APP_URL = appUrlOrLocalhost()

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Invitation email HTML. Names come from user/tenant input, so they are escaped. */
export function buildInviteEmail(raw: {
  tenantName: string
  tenantSlug: string
  inviterName: string
  role: string
  token: string
}): string {
  const opts = {
    ...raw,
    tenantName: escapeHtml(raw.tenantName),
    tenantSlug: escapeHtml(raw.tenantSlug),
    inviterName: escapeHtml(raw.inviterName),
    role: escapeHtml(raw.role),
    token: encodeURIComponent(raw.token),
  }
  const acceptUrl = `${APP_URL}/invite/${opts.token}`
  const loginUrl = `${APP_URL}/login?org=${encodeURIComponent(raw.tenantSlug)}`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#FAF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F3;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <tr><td style="padding:0 0 32px;text-align:center">
          <img src="${APP_URL}/brand/mark-192.png" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:8px">
          <span style="font-size:24px;font-weight:700;letter-spacing:-0.5px;vertical-align:middle">
            <span style="color:#17150F">user</span><span style="color:#977443">tasks</span>
          </span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px 36px">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e293b">You've been invited</h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">
            <strong style="color:#1e293b">${opts.inviterName}</strong> has invited you to join
            <strong style="color:#1e293b">${opts.tenantName}</strong> as a <strong style="color:#977443">${opts.role}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:4px 0 28px">
              <a href="${acceptUrl}" style="display:inline-block;background:#17150F;color:#FAF8F3;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px">
                Accept Invitation
              </a>
            </td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:0 0 20px">
          <p style="margin:0 0 6px;font-size:13px;color:#94a3b8">What happens next?</p>
          <ul style="margin:0 0 20px;padding-left:18px;font-size:13px;color:#64748b;line-height:2">
            <li>Click the button above to accept</li>
            <li>Sign in with your email and password</li>
            <li>The organisation <strong>${opts.tenantSlug}</strong> will be pre-filled</li>
          </ul>
          <p style="margin:0;font-size:12px;color:#94a3b8">
            Or go directly to <a href="${loginUrl}" style="color:#977443;text-decoration:none">${loginUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 0 0;text-align:center">
          <p style="margin:0;font-size:11px;color:#94a3b8">
            This invitation expires in 7 days. If you didn't expect this, you can ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const newInvitationToken = () => crypto.randomUUID().replace(/-/g, '')

const capitalise = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)

/** Send (or re-send) the invitation email. Never throws; reports the outcome. */
export async function sendInvitationEmail(params: {
  to: string
  tenantName: string | null | undefined
  tenantSlug: string | null | undefined
  inviterName: string | null | undefined
  role: string
  token: string
  reminder?: boolean
}): Promise<{ success: boolean; error?: string }> {
  const tenantName = params.tenantName || 'an organisation'
  try {
    return await sendEmail({
      to: params.to,
      subject: `${params.reminder ? 'Reminder: ' : ''}You're invited to join ${tenantName} on UserTasks`,
      body: buildInviteEmail({
        tenantName,
        tenantSlug: params.tenantSlug ?? '',
        inviterName: params.inviterName || 'A team member',
        role: capitalise(params.role || 'member'),
        token: params.token,
      }),
    })
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send invitation email' }
  }
}

export async function ensureTenantInvitation(params: {
  supabase: SupabaseClient
  tenantId: string
  email: string
  invitedBy: string
  role?: (typeof INVITABLE_ROLES)[number]
}) {
  const normalizedEmail = params.email.toLowerCase().trim()

  const { data: existing } = await params.supabase
    .from('invitations')
    .select('id')
    .eq('email', normalizedEmail)
    .eq('tenant_id', params.tenantId)
    .is('accepted_at', null)
    .maybeSingle()

  if (existing) {
    return { created: false, invitationId: existing.id, email: normalizedEmail, alreadyPending: true, emailSent: false }
  }

  const token = crypto.randomUUID().replace(/-/g, '')
  const role = params.role ?? 'viewer'

  const [{ data: inviter }, { data: tenant }] = await Promise.all([
    params.supabase.from('users').select('display_name').eq('id', params.invitedBy).single(),
    params.supabase.from('tenants').select('name, slug').eq('id', params.tenantId).single(),
  ])

  const { data: invitation, error } = await params.supabase
    .from('invitations')
    .insert({
      tenant_id: params.tenantId,
      email: normalizedEmail,
      invited_by: params.invitedBy,
      role,
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    } as any)
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to create invitation: ${error.message}`)
  }

  const emailResult = await sendEmail({
    to: normalizedEmail,
    subject: `You're invited to join ${tenant?.name ?? 'an organisation'} on UserTasks`,
    body: buildInviteEmail({
      tenantName: tenant?.name ?? 'an organisation',
      tenantSlug: tenant?.slug ?? '',
      inviterName: (inviter as any)?.display_name ?? 'A team member',
      role: role.charAt(0).toUpperCase() + role.slice(1),
      token,
    }),
  })

  return {
    created: true,
    invitationId: invitation?.id ?? null,
    email: normalizedEmail,
    alreadyPending: false,
    emailSent: emailResult.success,
    emailError: emailResult.success ? null : emailResult.error ?? 'Failed to send invitation email',
  }
}
