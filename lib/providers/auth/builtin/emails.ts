import { sendEmail } from '@/lib/email'

/**
 * App-owned account emails for built-in auth (Supabase sends its own). They go
 * out through the configured EmailProvider (lib/email.ts), so SMTP relays,
 * SES, ACS, Graph, Gmail and the console sink all work.
 */

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function accountEmailHtml(opts: { origin: string; heading: string; body: string; actionLabel: string; actionUrl: string; note: string }): string {
  const origin = escapeHtml(opts.origin)
  const url = escapeHtml(opts.actionUrl)
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#FAF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F3;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <tr><td style="padding:0 0 32px;text-align:center">
          <img src="${origin}/brand/mark-192.png" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:8px">
          <span style="font-size:24px;font-weight:700;letter-spacing:-0.5px;vertical-align:middle">
            <span style="color:#17150F">user</span><span style="color:#977443">tasks</span>
          </span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:40px 36px">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e293b">${escapeHtml(opts.heading)}</h1>
          <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6">${escapeHtml(opts.body)}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:4px 0 28px">
              <a href="${url}" style="display:inline-block;background:#17150F;color:#FAF8F3;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px">${escapeHtml(opts.actionLabel)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;line-height:1.6">Or paste this link into your browser:<br><span style="word-break:break-all;color:#64748b">${url}</span></p>
          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">${escapeHtml(opts.note)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendConfirmationEmail(to: string, origin: string, token: string): Promise<boolean> {
  const actionUrl = `${origin}/confirm-email?token=${encodeURIComponent(token)}`
  const result = await sendEmail({
    to,
    subject: 'Confirm your email address',
    body: accountEmailHtml({
      origin,
      heading: 'Confirm your email',
      body: 'Confirm this address to finish setting up your UserTasks account.',
      actionLabel: 'Confirm email',
      actionUrl,
      note: 'The link expires in 24 hours. If you did not create an account, ignore this email.',
    }),
  })
  return result.success
}

export async function sendPasswordResetEmail(to: string, origin: string, token: string): Promise<boolean> {
  const actionUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`
  const result = await sendEmail({
    to,
    subject: 'Reset your password',
    body: accountEmailHtml({
      origin,
      heading: 'Reset your password',
      body: 'Someone asked to reset the password for this UserTasks account. Choose a new password with the button below.',
      actionLabel: 'Choose a new password',
      actionUrl,
      note: 'The link expires in 1 hour and works once. If you did not ask for this, ignore this email: your password stays the same.',
    }),
  })
  return result.success
}
