/**
 * The contact pipeline: one ChirpMe notification to the UserTasks team,
 * server-side only (CHIRPME_API_KEY / CHIRPME_CHANNEL_ID). Used by the public
 * contact form (app/api/contact) and in-app feedback (lib/services/feedback).
 * Self-hosted instances leave the variables unset: nothing is sent.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!)
}

export function contactDeliveryConfigured(): boolean {
  return Boolean(process.env.CHIRPME_API_KEY?.trim() && process.env.CHIRPME_CHANNEL_ID?.trim())
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
}

export type DeliveryResult = { ok: true } | { ok: false; reason: 'unconfigured' | 'failed'; status?: number }

export async function deliverChirp(message: ChirpMessage, logTag = 'contact'): Promise<DeliveryResult> {
  const apiKey = process.env.CHIRPME_API_KEY?.trim()
  const channelId = process.env.CHIRPME_CHANNEL_ID?.trim()
  if (!apiKey || !channelId) {
    console.error(`[${logTag}] CHIRPME_API_KEY / CHIRPME_CHANNEL_ID is not configured`)
    return { ok: false, reason: 'unconfigured' }
  }
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
