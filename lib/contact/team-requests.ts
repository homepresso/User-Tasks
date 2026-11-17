/**
 * notifyTeam: the one server-side entry point for a request to the UserTasks
 * team (server-only: it uses the service-role database client and the
 * ChirpMe / team email credentials).
 *
 * Each request becomes one row in public.team_requests (migration
 * 20270116120000) and one ChirpMe notification (lib/contact/chirpme, plus the
 * team email when TEAM_NOTIFY_EMAIL is set):
 *
 *  1. the row is inserted first (service role), so a request is kept even
 *     when ChirpMe is down;
 *  2. the notification is sent (it is sent even when the insert failed: the
 *     error is logged);
 *  3. the row's `delivery` is updated with each channel's outcome.
 *
 * It never throws. `ok` is false only when the row could not be written AND
 * every channel failed (or nothing is configured), which is when the contact
 * form and in-app feedback still tell the person "we couldn't deliver it".
 *
 * Recording: on by default in cloud mode (usertasks.com). A self-hosted
 * instance records only with TEAM_REQUESTS_ENABLED=true; otherwise it keeps
 * the old behaviour (ChirpMe / email when configured, nothing otherwise).
 *
 * Used by the contact form (app/api/contact), docs feedback
 * (app/api/docs-feedback), in-app feedback (lib/services/feedback), beta
 * signups (lib/contact/beta-signup-chirp) and SharePoint trial signups
 * (kind 'trial').
 */

import { readEnv } from '@/lib/config/bootstrap'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { getServiceDb, hasServiceDb } from '@/lib/providers/db'
import {
  combineDelivery, contactDeliveryConfigured, deliverChirpChannels, escapeHtml,
  type ChannelResults, type ChirpMessage, type DeliveryResult,
} from './chirpme'
import { TEAM_REQUEST_KINDS, type TeamRequestKind } from './team-request-labels'

export { TEAM_REQUEST_KINDS, type TeamRequestKind }

/** A structured fact: shown as a label / value list on the request (farm id, rating, page, workspace…). */
export type TeamRequestFact = string | number | boolean | null
export type TeamRequestFacts = Record<string, TeamRequestFact | TeamRequestFact[]>

export interface NotifyTeamInput {
  kind: TeamRequestKind
  /** The ChirpMe message (title, body, url, escaped HTML detail, replyTo…). */
  message: ChirpMessage
  facts?: TeamRequestFacts
  name?: string | null
  email?: string | null
  company?: string | null
  /** Log prefix (default: the kind). */
  logTag?: string
}

export type ChannelOutcome = 'ok' | 'failed' | 'unconfigured'

export interface TeamRequestDelivery {
  chirp: ChannelOutcome
  email: ChannelOutcome
  chirp_status?: number
  at: string
}

export interface NotifyTeamResult {
  /** Kept or delivered: the row was written, or at least one channel accepted the notification. */
  ok: boolean
  /** The team_requests row id, or null when it was not written (disabled or the insert failed). */
  id: string | null
  stored: boolean
  /** The notification on its own (both channels combined). */
  delivered: DeliveryResult
  delivery: TeamRequestDelivery
}

/** Field limits (the table's CHECK constraints). */
export const TEAM_REQUEST_LIMITS = {
  title: 500,
  summary: 2000,
  name: 300,
  email: 320,
  company: 300,
  url: 2000,
  detail: 100_000,
  factValue: 5000,
  facts: 40,
} as const

/** Whether this instance keeps request rows: cloud by default, self-hosted only with TEAM_REQUESTS_ENABLED=true. */
export function teamRequestsEnabled(): boolean {
  const flag = String(readEnv('TEAM_REQUESTS_ENABLED') ?? '').trim().toLowerCase()
  if (flag === 'false' || flag === 'off' || flag === '0') return false
  return isCloud() || flag === 'true' || flag === 'on' || flag === '1'
}

/** Whether a row can actually be written: recording is on and there is a service database client. */
export function teamRequestsRecording(): boolean {
  return teamRequestsEnabled() && hasServiceDb()
}

/** Whether a request can go anywhere at all (a row, ChirpMe or the team email). */
export function teamNotifyAvailable(): boolean {
  return teamRequestsRecording() || contactDeliveryConfigured()
}

function clip(value: string | null | undefined, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, max) : null
}

/** Facts as a bounded, JSON-safe object (primitives and short lists only; empty values dropped). */
export function cleanFacts(facts: TeamRequestFacts | undefined): Record<string, TeamRequestFact | TeamRequestFact[]> {
  const out: Record<string, TeamRequestFact | TeamRequestFact[]> = {}
  const one = (v: unknown): TeamRequestFact | undefined => {
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
    if (typeof v === 'string') return v.trim() ? v.slice(0, TEAM_REQUEST_LIMITS.factValue) : undefined
    return undefined
  }
  for (const [rawKey, value] of Object.entries(facts ?? {})) {
    if (Object.keys(out).length >= TEAM_REQUEST_LIMITS.facts) break
    const key = rawKey.trim().slice(0, 80)
    if (!key || key === '__proto__' || value === undefined || value === null) continue
    if (Array.isArray(value)) {
      const list = value.map(one).filter((v): v is TeamRequestFact => v !== undefined).slice(0, 50)
      if (list.length) out[key] = list
      continue
    }
    const v = one(value)
    if (v !== undefined) out[key] = v
  }
  return out
}

function outcome(result: DeliveryResult): ChannelOutcome {
  return result.ok ? 'ok' : result.reason
}

function deliveryRecord(channels: ChannelResults): TeamRequestDelivery {
  const status = !channels.chirp.ok ? channels.chirp.status : undefined
  return {
    chirp: outcome(channels.chirp),
    email: outcome(channels.email),
    ...(status ? { chirp_status: status } : {}),
    at: new Date().toISOString(),
  }
}

/** The admin page link appended to the notification (not stored: the row holds the original detail). */
export function requestLink(id: string, baseUrl: string = publicBaseUrl()): string {
  return `${baseUrl}/settings/requests?id=${encodeURIComponent(id)}`
}

function serviceDb(): { db: any } | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  return hasServiceDb() ? { db: getServiceDb() } : null
}

export async function notifyTeam(input: NotifyTeamInput): Promise<NotifyTeamResult> {
  const tag = input.logTag ?? input.kind
  const { message } = input
  const record = teamRequestsEnabled()
  let id: string | null = null

  // 1. The row first, so the request is kept whatever happens to the notification.
  if (record) {
    try {
      const conn = serviceDb()
      if (!conn) {
        console.error(`[${tag}] team request not stored: no service database client`)
      } else {
        const kind: TeamRequestKind = (TEAM_REQUEST_KINDS as readonly string[]).includes(input.kind) ? input.kind : 'other'
        const { data, error } = await conn.db.from('team_requests').insert({
          kind,
          title: clip(message.title, TEAM_REQUEST_LIMITS.title) ?? 'Team request',
          summary: clip(message.body, TEAM_REQUEST_LIMITS.summary) ?? '',
          name: clip(input.name, TEAM_REQUEST_LIMITS.name),
          email: clip(input.email, TEAM_REQUEST_LIMITS.email),
          company: clip(input.company, TEAM_REQUEST_LIMITS.company),
          reply_to: clip(message.replyTo, TEAM_REQUEST_LIMITS.email),
          url: clip(message.url, TEAM_REQUEST_LIMITS.url),
          facts: cleanFacts(input.facts),
          detail_html: (message.detail ?? '').slice(0, TEAM_REQUEST_LIMITS.detail),
          delivery: { chirp: 'pending', email: 'pending' },
        }).select('id').single()
        if (error) console.error(`[${tag}] team request insert failed: ${error.message ?? error}`)
        else id = data?.id ?? null
      }
    } catch (error) {
      console.error(`[${tag}] team request insert failed`, error)
    }
  }

  // 2. The notification, even when the insert failed.
  let channels: ChannelResults
  try {
    const outgoing: ChirpMessage = id
      ? { ...message, detail: `${message.detail}<p><a href="${escapeHtml(requestLink(id))}">Open in Settings → Requests</a></p>` }
      : message
    channels = await deliverChirpChannels(outgoing, tag)
  } catch (error) {
    console.error(`[${tag}] team notification failed`, error)
    channels = { chirp: { ok: false, reason: 'failed' }, email: { ok: false, reason: 'failed' } }
  }
  const delivery = deliveryRecord(channels)
  const delivered = combineDelivery(channels)

  // 3. How it went, on the row.
  if (id) {
    try {
      const conn = serviceDb()
      const { error } = await conn!.db.from('team_requests').update({ delivery }).eq('id', id)
      if (error) console.error(`[${tag}] team request delivery update failed: ${error.message ?? error}`)
    } catch (error) {
      console.error(`[${tag}] team request delivery update failed`, error)
    }
  }

  return { ok: Boolean(id) || delivered.ok, id, stored: Boolean(id), delivered, delivery }
}
