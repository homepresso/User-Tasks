/**
 * Trial request codes: what an installation that can't reach usertasks.com
 * shows its admin to copy into the website's trial form (air-gapped farms).
 *
 *   UTTRIAL1-<base64url of JSON>
 *   { "v": 1, "sku": "sharepoint-se", "farm_id": "<guid>", "instance_id": "inst_…",
 *     "hostnames": ["usertasks.corp.example"], "version": "…", "created_at": "…" }
 *
 * Not signed and holds no secrets: it only saves typing the farm and
 * instance ids (the trial licence is then bound to both). Client-safe.
 */

import { normaliseFarmId } from './trial-policy'

export const TRIAL_REQUEST_PREFIX = 'UTTRIAL1-'

export interface TrialRequest {
  v: 1
  sku: string
  farm_id: string
  instance_id: string | null
  hostnames: string[]
  version?: string
  created_at: string
}

function toBase64Url(text: string): string {
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(text, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(text)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64)))
}

export function encodeTrialRequest(input: Omit<TrialRequest, 'v'>): string {
  const farm = normaliseFarmId(input.farm_id)
  if (!farm) throw new Error('The farm id must be a GUID')
  const body: TrialRequest = { v: 1, sku: input.sku, farm_id: farm, instance_id: input.instance_id, hostnames: input.hostnames.slice(0, 10), ...(input.version ? { version: input.version } : {}), created_at: input.created_at }
  return TRIAL_REQUEST_PREFIX + toBase64Url(JSON.stringify(body))
}

const INSTANCE_RE = /^inst_[a-z0-9]{20,40}$/
const HOST_RE = /^[a-z0-9.-]{1,253}$/

/** Read a pasted request code; null when it isn't one. */
export function decodeTrialRequest(code: unknown): TrialRequest | null {
  if (typeof code !== 'string') return null
  const trimmed = code.replace(/\s+/g, '')
  if (!trimmed.startsWith(TRIAL_REQUEST_PREFIX) || trimmed.length > 4000) return null
  try {
    const value = JSON.parse(fromBase64Url(trimmed.slice(TRIAL_REQUEST_PREFIX.length))) as Partial<TrialRequest>
    if (value?.v !== 1 || typeof value.sku !== 'string') return null
    const farm = normaliseFarmId(value.farm_id)
    if (!farm) return null
    const instance = typeof value.instance_id === 'string' && INSTANCE_RE.test(value.instance_id) ? value.instance_id : null
    const hostnames = Array.isArray(value.hostnames) ? value.hostnames.filter((h): h is string => typeof h === 'string' && HOST_RE.test(h.toLowerCase())).map((h) => h.toLowerCase()).slice(0, 10) : []
    return { v: 1, sku: value.sku.slice(0, 100), farm_id: farm, instance_id: instance, hostnames, ...(typeof value.version === 'string' ? { version: value.version.slice(0, 40) } : {}), created_at: typeof value.created_at === 'string' ? value.created_at.slice(0, 40) : '' }
  } catch {
    return null
  }
}
