/**
 * The contact pipeline: each team notification goes to the UserTasks team's
 * ChirpMe channel (CHIRPME_API_KEY / CHIRPME_CHANNEL_ID) and, when
 * TEAM_NOTIFY_EMAIL is set, also by email to that address (e.g.
 * support@usertasks.com) through the configured email provider. Server-side
 * only. Used by the public contact form (app/api/contact), docs feedback,
 * in-app feedback (lib/services/feedback) and beta signups.
 * Self-hosted instances leave the variables unset: nothing is sent.
 *
 * Delivery succeeds when at least one configured channel accepts it.
 */

import { sendEmail } from '@/lib/email'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!)
}

function chirpConfigured(): boolean {
  return Boolean(process.env.CHIRPME_API_KEY?.trim() && process.env.CHIRPME_CHANNEL_ID?.trim())
}

/** The team inbox for notifications (TEAM_NOTIFY_EMAIL), or null when unset. Comma-separated for several. */
export function teamNotifyEmails(): string[] {
  return (process.env.TEAM_NOTIFY_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
}

export function contactDeliveryConfigured(): boolean {
  return chirpConfigured() || teamNotifyEmails().length > 0
}

export interface ChirpMessage {
  title: string
  body: string
  url: string
  /** HTML (escape every value with escapeHtml). */
  detail: string
  notificationIcon?: string
  subTab?: string
  subTabColor?: string
  /** Reply-To on the team email (e.g. the person who wrote in), so a reply goes straight to them. */
  replyTo?: string
}

export type DeliveryResult = { ok: true } | { ok: false; reason: 'unconfigured' | 'failed'; status?: number }

async function deliverToChirpMe(message: ChirpMessage, logTag: string): Promise<DeliveryResult> {
  const apiKey = process.env.CHIRPME_API_KEY?.trim()
  const channelId = process.env.CHIRPME_CHANNEL_ID?.trim()
  if (!apiKey || !channelId) return { ok: false, reason: 'unconfigured' }
  const response = await fetch('https://chirpme.app/api/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId,
      title: message.title,
      body: message.body,
      url: message.url,
      detail: message.detail,
      badge: 1,
      sound: 'default',
      priority: 'high',
      notificationIcon: message.notificationIcon ?? 'contact_mail',
      notificationIconType: 'material',
      suggestedSubTab: message.subTab ?? 'Leads',
      suggestedSubTabColor: message.subTabColor ?? '#22D3EE',
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    console.error(`[${logTag}] ChirpMe request failed`, error)
    return null
  })
  if (!response?.ok) {
    console.error(`[${logTag}] ChirpMe rejected request`, response?.status)
    return { ok: false, reason: 'failed', status: response?.status }
  }
  return { ok: true }
}

/** The team email: the same title and detail, with a link back. */
export function teamEmailBody(message: ChirpMessage): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#111">`
    + `<p style="margin:0 0 12px">${escapeHtml(message.body)}</p>`
    + message.detail
    + `<p style="margin:16px 0 0;color:#666;font-size:12px">From usertasks.com · <a href="${escapeHtml(message.url)}">${escapeHtml(message.url)}</a></p>`
    + `</div>`
}

async function deliverToTeamEmail(message: ChirpMessage, logTag: string): Promise<DeliveryResult> {
  const to = teamNotifyEmails()
  if (!to.length) return { ok: false, reason: 'unconfigured' }
  const sent = await sendEmail({ to, subject: message.title, body: teamEmailBody(message), ...(message.replyTo ? { replyTo: message.replyTo } : {}) })
  if (!sent.success) {
    console.error(`[${logTag}] team email failed`)
    return { ok: false, reason: 'failed' }
  }
  return { ok: true }
}

export interface ChannelResults {
  chirp: DeliveryResult
  email: DeliveryResult
}

/** Both channels, each with its own outcome (notifyTeam records them on the request row). */
export async function deliverChirpChannels(message: ChirpMessage, logTag = 'contact'): Promise<ChannelResults> {
  const unconfigured: DeliveryResult = { ok: false, reason: 'unconfigured' }
  if (!contactDeliveryConfigured()) return { chirp: unconfigured, email: unconfigured }
  const [chirp, email] = await Promise.all([
    deliverToChirpMe(message, logTag).catch((error): DeliveryResult => {
      console.error(`[${logTag}] ChirpMe delivery threw`, error)
      return { ok: false, reason: 'failed' }
    }),
    deliverToTeamEmail(message, logTag).catch((error): DeliveryResult => {
      console.error(`[${logTag}] team email threw`, error)
      return { ok: false, reason: 'failed' }
    }),
  ])
  return { chirp, email }
}

/** One outcome for both channels: delivered when either accepted it. */
export function combineDelivery({ chirp, email }: ChannelResults): DeliveryResult {
  if (chirp.ok || email.ok) return { ok: true }
  if (chirp.reason === 'unconfigured' && email.reason === 'unconfigured') return { ok: false, reason: 'unconfigured' }
  return chirp.reason === 'failed' ? chirp : email
}

export async function deliverChirp(message: ChirpMessage, logTag = 'contact'): Promise<DeliveryResult> {
  if (!contactDeliveryConfigured()) {
    console.error(`[${logTag}] no team notification channel configured (CHIRPME_API_KEY / CHIRPME_CHANNEL_ID or TEAM_NOTIFY_EMAIL)`)
    return { ok: false, reason: 'unconfigured' }
  }
  return combineDelivery(await deliverChirpChannels(message, logTag))
}
