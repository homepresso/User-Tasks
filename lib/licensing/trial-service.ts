/**
 * Self-serve trial issuing (usertasks.com, cloud only):
 * POST /api/public/trials/sharepoint and the website's trial form.
 *
 *   1. Validate: name, work email (no free / disposable mail), company, the
 *      farm id (typed, or from an installation's request code, which also
 *      carries the instance id), terms accepted.
 *   2. Trials available? The trial-only key is configured and matches the
 *      keyring (./trial-issuer.ts) and the licence_trials table exists.
 *   3. One trial per farm and one per company email domain (per SKU):
 *        - the same farm, still running → the SAME licence again (`existing`),
 *          also e-mailed to the address that started it;
 *        - the same domain, another farm, still running → refused (one per
 *          company; contact us for another farm);
 *        - a trial that already ended (farm or domain) → refused (buy).
 *   4. Otherwise sign a 30-day licence bound to the farm (and the instance,
 *      when known), store it, return it, and afterwards (never blocking the
 *      response): e-mail it to the requester and notify the team.
 *
 * Rate limits and the honeypot live in the route. The service never logs the
 * licence or the e-mail address.
 */

import { createHash } from 'node:crypto'
import { emailDomain, isFreeMailDomain } from './free-mail'
import { decodeTrialRequest } from './trial-request'
import { normaliseFarmId, TRIAL_SKUS } from './trial-policy'
import { issueTrialLicence, trialSigner, TRIALS_UNAVAILABLE_MESSAGE, type TrialSigner } from './trial-issuer'
import type { LicenceDocument } from './types'
import type { TrialFacts } from '@/lib/contact/trial-chirp'

export interface TrialRow {
  id: string
  licence_id: string
  sku: string
  farm_id: string
  instance_id: string | null
  name: string
  email: string
  email_domain: string
  company: string
  source: 'website' | 'product'
  issued_at: string
  expires_at: string
  licence: LicenceDocument
  created_at?: string
  emailed_at?: string | null
  resent_count?: number
}

export interface TrialStore {
  /** Is the table there? (false: migration not applied → trials unavailable) */
  ready(): Promise<boolean>
  /** Trials of this SKU for the farm or the email domain. */
  matches(sku: string, farmId: string, domain: string): Promise<TrialRow[]>
  /** Insert; `conflict` when a unique index (farm / domain) refused it (a race). */
  insert(row: Omit<TrialRow, 'id'> & { terms_accepted_at: string; ip_hash: string | null }): Promise<{ ok: true; row: TrialRow } | { ok: false; conflict: true }>
  markEmailed(id: string, at: string): Promise<void>
  markResent(id: string, at: string): Promise<void>
  /** Newest first (admin view). */
  list(limit: number): Promise<TrialRow[]>
}

export interface TrialServiceDeps {
  now: () => Date
  signer: () => TrialSigner
  store: () => TrialStore
  /** Runs work after the response (next/server after()); tests run it inline. */
  later: (fn: () => Promise<void>) => void
  sendLicenceEmail: (input: { to: string; name: string; company: string; farmId: string; licence: LicenceDocument; resent: boolean }) => Promise<boolean>
  notifyTeam: (facts: TrialFacts) => Promise<void>
}

export interface TrialInput {
  sku?: unknown
  name?: unknown
  email?: unknown
  company?: unknown
  farm_id?: unknown
  request_code?: unknown
  accept_terms?: unknown
  source?: unknown
  /** The caller's IP (hashed before it is stored). */
  ip?: string | null
}

export type TrialOutcome =
  | { status: 200; body: { licence: LicenceDocument; licence_id: string; farm_id: string; expires_at: string; existing: boolean; message: string } }
  | { status: 400 | 409 | 503; body: { error: string; code: string; field?: string; expires_at?: string } }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

function bad(error: string, field?: string): TrialOutcome {
  return { status: 400, body: { error, code: 'validation_error', ...(field ? { field } : {}) } }
}

function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 1)}•••@${domain}`
}

export function hashIp(ip: string | null | undefined, salt = process.env.TRIAL_IP_SALT ?? process.env.WORKFLOW_SIGNING_SECRET ?? ''): string | null {
  if (!ip || ip === 'unknown') return null
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32)
}

/** Can trials be issued right now? (key configured and matching, table present) */
export async function trialsAvailable(deps: Pick<TrialServiceDeps, 'signer' | 'store'>): Promise<{ available: boolean; reason?: string }> {
  const signer = deps.signer()
  if (!signer.available) return { available: false, reason: signer.reason }
  if (!(await deps.store().ready().catch(() => false))) return { available: false, reason: 'licence_trials table missing (apply migration 20270117090000_licence_trials)' }
  return { available: true }
}

export async function requestTrial(input: TrialInput, deps: TrialServiceDeps): Promise<TrialOutcome> {
  const sku = typeof input.sku === 'string' && input.sku ? input.sku : 'sharepoint-se'
  if (!TRIAL_SKUS[sku]) return bad('There is no trial for that product', 'sku')
  const name = text(input.name, 120)
  const email = text(input.email, 254).toLowerCase()
  const company = text(input.company, 120)
  if (!name) return bad('Please enter your name.', 'name')
  if (!EMAIL_RE.test(email)) return bad('Please enter a valid work email address.', 'email')
  const domain = emailDomain(email)
  if (!domain) return bad('Please enter a valid work email address.', 'email')
  if (isFreeMailDomain(domain)) return bad('Please use your work email address. Trials are one per company, so personal and disposable addresses can’t be used.', 'email')
  if (!company) return bad('Please enter your company.', 'company')
  const request = input.request_code ? decodeTrialRequest(input.request_code) : null
  if (input.request_code && !request) return bad('That request code could not be read. Copy the whole code from UserTasks (it starts with UTTRIAL1-).', 'request_code')
  if (request && request.sku !== sku) return bad('That request code is for another product.', 'request_code')
  const farmId = request?.farm_id ?? normaliseFarmId(input.farm_id)
  if (!farmId) return bad('Please enter the farm ID: a GUID like 3f2504e0-4f89-11d3-9a0c-0305e82c3301. In SharePoint Management Shell run (Get-SPFarm).Id.', 'farm_id')
  if (input.accept_terms !== true && input.accept_terms !== 'true' && input.accept_terms !== 'on') return bad('Please accept the trial terms.', 'accept_terms')
  const source: TrialRow['source'] = input.source === 'product' ? 'product' : 'website'

  const available = await trialsAvailable(deps)
  if (!available.available) return { status: 503, body: { error: TRIALS_UNAVAILABLE_MESSAGE, code: 'trials_unavailable' } }
  const signer = deps.signer() as Extract<TrialSigner, { available: true }>
  const store = deps.store()
  const now = deps.now()

  const decide = async (): Promise<TrialOutcome | null> => {
    const rows = await store.matches(sku, farmId, domain)
    const sameFarm = rows.find((r) => r.farm_id === farmId)
    const sameDomain = rows.find((r) => r.email_domain === domain)
    const running = (r: TrialRow) => Date.parse(r.expires_at) > now.getTime()
    if (sameFarm && running(sameFarm)) {
      deps.later(async () => {
        const sent = await deps.sendLicenceEmail({ to: sameFarm.email, name: sameFarm.name, company: sameFarm.company, farmId, licence: sameFarm.licence, resent: true }).catch(() => false)
        if (sent) await store.markResent(sameFarm.id, new Date().toISOString()).catch(() => undefined)
        await deps.notifyTeam({ name, email, company, farmId, instanceId: request?.instance_id ?? null, sku, licenceId: sameFarm.licence_id, expiresAt: sameFarm.expires_at, kind: 'resent', source })
      })
      return {
        status: 200,
        body: {
          licence: sameFarm.licence, licence_id: sameFarm.licence_id, farm_id: farmId, expires_at: sameFarm.expires_at, existing: true,
          message: `This farm already has a trial running until ${longDay(sameFarm.expires_at)}. Here is its licence again; we've also emailed it to ${maskEmail(sameFarm.email)}.`,
        },
      }
    }
    if (sameFarm) return { status: 409, body: { error: `The trial for this farm ended on ${longDay(sameFarm.expires_at)}. To keep using UserTasks for SharePoint, buy a licence or contact us.`, code: 'trial_used', expires_at: sameFarm.expires_at } }
    if (sameDomain && running(sameDomain)) return { status: 409, body: { error: `${sameDomain.company} already has a trial running (started by ${maskEmail(sameDomain.email)}) until ${longDay(sameDomain.expires_at)}. Trials are one per company; contact us to try another farm.`, code: 'trial_exists_for_domain', expires_at: sameDomain.expires_at } }
    if (sameDomain) return { status: 409, body: { error: `Your company's trial ended on ${longDay(sameDomain.expires_at)}. To keep using UserTasks for SharePoint, buy a licence or contact us.`, code: 'trial_used', expires_at: sameDomain.expires_at } }
    return null
  }

  const prior = await decide()
  if (prior) return prior

  const licence = issueTrialLicence(signer, { sku, farmId, instanceId: request?.instance_id ?? null, company, now })
  const inserted = await store.insert({
    licence_id: licence.licence_id, sku, farm_id: farmId, instance_id: request?.instance_id ?? null, name, email, email_domain: domain, company, source,
    issued_at: licence.issued_at, expires_at: licence.expires_at, licence, terms_accepted_at: now.toISOString(), ip_hash: hashIp(input.ip),
  })
  if (!inserted.ok) {
    // Someone else asked for the same farm / domain at the same moment: answer as if they had been first.
    const raced = await decide()
    if (raced) return raced
    return { status: 409, body: { error: 'A trial for this farm or company was just started. Please try again in a moment.', code: 'conflict' } }
  }
  const row = inserted.row
  deps.later(async () => {
    const sent = await deps.sendLicenceEmail({ to: email, name, company, farmId, licence, resent: false }).catch(() => false)
    if (sent) await store.markEmailed(row.id, new Date().toISOString()).catch(() => undefined)
    await deps.notifyTeam({ name, email, company, farmId, instanceId: request?.instance_id ?? null, sku, licenceId: licence.licence_id, expiresAt: licence.expires_at, kind: 'new', source })
  })
  console.info('[trials] issued', { sku, licence_id: licence.licence_id, source, bound_to_instance: Boolean(request?.instance_id) })
  return {
    status: 200,
    body: { licence, licence_id: licence.licence_id, farm_id: farmId, expires_at: licence.expires_at, existing: false, message: `Your trial runs until ${longDay(licence.expires_at)}. We've also emailed the licence to ${email}.` },
  }
}

// ─── Default dependencies (server) ─────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any -- licence_trials is not in the generated types until the migration is applied */
const COLUMNS = 'id, licence_id, sku, farm_id, instance_id, name, email, email_domain, company, source, issued_at, expires_at, licence, created_at, emailed_at, resent_count'

export function supabaseTrialStore(db: any): TrialStore {
  const missing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '')))
  return {
    async ready() {
      const { error } = await db.from('licence_trials').select('id').limit(1)
      if (error && !missing(error)) console.warn(`[trials] licence_trials unavailable: ${error.message}`)
      return !error
    },
    async matches(sku, farmId, domain) {
      const { data, error } = await db.from('licence_trials').select(COLUMNS).eq('sku', sku).or(`farm_id.eq.${farmId},email_domain.eq.${domain.replace(/[,()]/g, '')}`).limit(10)
      if (error) throw new Error(`licence_trials: ${error.message}`)
      return (data ?? []) as TrialRow[]
    },
    async insert(row) {
      const { data, error } = await db.from('licence_trials').insert(row).select(COLUMNS).single()
      if (error?.code === '23505') return { ok: false, conflict: true }
      if (error) throw new Error(`licence_trials: ${error.message}`)
      return { ok: true, row: data as TrialRow }
    },
    async markEmailed(id, at) {
      await db.from('licence_trials').update({ emailed_at: at }).eq('id', id)
    },
    async markResent(id, at) {
      const { data } = await db.from('licence_trials').select('resent_count').eq('id', id).maybeSingle()
      await db.from('licence_trials').update({ last_resent_at: at, resent_count: Number(data?.resent_count ?? 0) + 1 }).eq('id', id)
    },
    async list(limit) {
      const { data, error } = await db.from('licence_trials').select(COLUMNS).order('created_at', { ascending: false }).limit(limit)
      if (error) throw new Error(missing(error) ? 'Apply migration 20270117090000_licence_trials to record trials' : `licence_trials: ${error.message}`)
      return (data ?? []) as TrialRow[]
    },
  }
}

export async function defaultTrialDeps(later: TrialServiceDeps['later']): Promise<TrialServiceDeps> {
  const { getServiceDb } = await import('@/lib/providers/db')
  const { sendTrialEmail } = await import('./trial-email')
  const { notifyTrial } = await import('@/lib/contact/trial-chirp')
  const { publicBaseUrl } = await import('@/lib/deployment')
  let store: TrialStore | null = null
  return {
    now: () => new Date(),
    signer: () => trialSigner(),
    // Created on first use: without the key, availability never touches the database.
    store: () => (store ??= supabaseTrialStore(getServiceDb())),
    later,
    sendLicenceEmail: (input) => sendTrialEmail({ ...input, origin: publicBaseUrl() }),
    notifyTeam: notifyTrial,
  }
}
