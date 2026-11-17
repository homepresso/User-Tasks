/**
 * The email that carries a trial licence to the person who asked for it
 * (usertasks.com): what it is, the licence attached as a `.licence` file and
 * pasted in the body (copy / paste on air-gapped farms), and the next steps.
 * Goes out through the configured email provider (lib/email.ts).
 */

import { sendEmail } from '@/lib/email'
import type { LicenceDocument } from './types'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface TrialEmailInput {
  to: string
  name: string
  company: string
  farmId: string
  licence: LicenceDocument
  /** The site the links point at (https://usertasks.com). */
  origin: string
  resent?: boolean
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })
}

export function trialEmailSubject(input: Pick<TrialEmailInput, 'resent'>): string {
  return input.resent ? 'Your UserTasks for SharePoint trial licence (sent again)' : 'Your 30-day UserTasks for SharePoint trial licence'
}

export function trialEmailHtml(input: TrialEmailInput): string {
  const origin = escapeHtml(input.origin.replace(/\/+$/, ''))
  const text = escapeHtml(JSON.stringify(input.licence, null, 2))
  const step = (n: number, html: string) => `<tr><td style="vertical-align:top;padding:0 10px 10px 0;font-weight:700;color:#977443">${n}.</td><td style="padding:0 0 10px;font-size:14px;color:#334155;line-height:1.6">${html}</td></tr>`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#FAF8F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F3;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <tr><td style="padding:0 0 32px;text-align:center">
          <img src="${origin}/brand/mark-192.png" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:8px">
          <span style="font-size:24px;font-weight:700;letter-spacing:-0.5px;vertical-align:middle"><span style="color:#17150F">user</span><span style="color:#977443">tasks</span></span>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;padding:36px">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e293b">Your SharePoint trial is ready</h1>
          <p style="margin:0 0 20px;font-size:15px;color:#64748b;line-height:1.6">Hi ${escapeHtml(input.name)}, here is the 30-day trial licence of UserTasks for SharePoint Server for ${escapeHtml(input.company)}. It works on farm <code>${escapeHtml(input.farmId)}</code> until ${escapeHtml(day(input.licence.expires_at))}.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 20px">
            ${step(1, 'Sign in to UserTasks as an instance admin and open <strong>Settings → Licence</strong>.')}
            ${step(2, 'Upload the attached <code>.licence</code> file, or paste the licence below into <strong>Install or replace a licence</strong>.')}
            ${step(3, 'Turn on <strong>SharePoint</strong> in <strong>Settings → Extensions</strong> and connect a site of that farm.')}
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#64748b">Licence (copy everything between the braces):</p>
          <pre style="margin:0 0 20px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;line-height:1.4;white-space:pre-wrap;word-break:break-all">${text}</pre>
          <p style="margin:0 0 6px;font-size:13px;color:#64748b;line-height:1.6">When the trial ends, the extension stops 24 hours after expiry. Lists that use UserTasks forms go back to SharePoint's own forms and SharePoint-triggered workflows pause; nothing is deleted, and everything comes back when you add a licence. Licences cost $7,500 USD per farm per year.</p>
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6"><a href="${origin}/sharepoint/get-started" style="color:#977443">Get started in 4 steps</a> · <a href="${origin}/docs/sharepoint/trial" style="color:#977443">Trial guide</a> · <a href="${origin}/contact?topic=sharepoint" style="color:#977443">Buy a licence or ask a question</a></p>
        </td></tr>
        <tr><td style="padding:16px 8px 0;font-size:12px;color:#94a3b8;line-height:1.6;text-align:center">You asked for this trial on ${origin}. If you didn't, ignore this email: the licence only works on the farm it names.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendTrialEmail(input: TrialEmailInput): Promise<boolean> {
  const result = await sendEmail({
    to: input.to,
    subject: trialEmailSubject(input),
    body: trialEmailHtml(input),
    attachments: [{ filename: `usertasks-sharepoint-trial-${input.farmId.slice(0, 8)}.licence`, contentType: 'application/json', content: new TextEncoder().encode(`${JSON.stringify(input.licence, null, 2)}\n`) }],
  })
  return result.success
}
