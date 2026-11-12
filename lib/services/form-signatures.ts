/**
 * Signature fields (lib/forms/media-fields.ts): the metadata of a stored
 * signature is the SERVER's — who signed (the session's user, their display
 * name from the users table), when (server time unless the browser's time
 * is plausible) and, only for fields with `capture_audit`, the request's IP
 * address and user agent. Whatever the browser sent for those is dropped.
 * Runs after the signature's PNG was re-read from the upload records
 * (resolveAttachmentValues), on every write path (lib/forms/task-values.ts).
 */

import { stampSignature, type SignatureStampInput } from '@/lib/forms/media-fields'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { AnySupabaseClient } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- users read untyped */

/** The current request's IP address and user agent (null outside a request: jobs, tests). */
export async function requestAudit(): Promise<{ ip: string | null; user_agent: string | null } | null> {
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    const ip = (forwarded?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim() || null
    return { ip, user_agent: h.get('user-agent') }
  } catch {
    return null
  }
}

export interface StampOptions {
  /** The signed-in person (null: anonymous visitor, tenant API key). */
  actorId: string | null
  /** The values stored before (a task's saved draft). */
  previous?: Record<string, unknown> | null
  /** Only these keys (draft saves). */
  keys?: string[]
  /** The request facts (default: read from the current request when a field captures them). */
  request?: SignatureStampInput['request']
  now?: Date
}

/** Stamp every Signature value in `values` (returns the changed entries only). */
export async function stampSignatureValues(db: AnySupabaseClient, fields: TaskFieldDef[], values: Record<string, unknown>, options: StampOptions): Promise<Record<string, unknown>> {
  const targets = fields.filter((f) => f.type === 'signature' && !f.read_only && (!options.keys || options.keys.includes(f.key))
    && values[f.key] !== undefined && values[f.key] !== null)
  if (!targets.length) return {}
  let user: SignatureStampInput['user'] = null
  if (options.actorId) {
    let name: string | null = null
    try {
      const { data } = await (db as any).from('users').select('id, display_name, email').eq('id', options.actorId).maybeSingle()
      name = data ? String(data.display_name || data.email || '') || null : null
    } catch { /* the name is optional */ }
    user = { id: options.actorId, name }
  }
  const request = options.request !== undefined ? options.request : targets.some((f) => f.signature?.capture_audit) ? await requestAudit() : null
  const out: Record<string, unknown> = {}
  for (const field of targets) {
    out[field.key] = stampSignature(field, values[field.key], { user, request, now: options.now, previous: options.previous?.[field.key] })
  }
  return out
}
