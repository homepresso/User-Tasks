/**
 * Signature fields (lib/forms/media-fields.ts): the metadata of a stored
 * signature is the SERVER's — who signed (the session's user, their display
 * name from the users table), when (server time unless the browser's time
 * is plausible) and, only for fields with `capture_audit`, the request's IP
 * address and user agent. Whatever the browser sent for those is dropped.
 * Runs after the signature's PNG was re-read from the upload records
 * (resolveAttachmentValues), on every write path (lib/forms/task-values.ts).
 */

import { normalizeSignatureValue, stampSignature, type SignatureStampInput } from '@/lib/forms/media-fields'
import { holdsNestedSignatures, mapNestedSignatures, nestedSignatureCells } from '@/lib/forms/signature-cells'
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

/**
 * Stamp every Signature value in `values` (returns the changed entries only):
 * Signature fields, and the signatures that repeat — Signature controls in
 * repeating sections' items and List signature columns (any level;
 * lib/forms/signature-cells.ts), each stamped like a field. A repeating
 * signature keeps the stamp of the stored one with the same PNG (a draft, a
 * row signed before — wherever it sits now: rows may have moved).
 */
export async function stampSignatureValues(db: AnySupabaseClient, fields: TaskFieldDef[], values: Record<string, unknown>, options: StampOptions): Promise<Record<string, unknown>> {
  const wanted = (f: TaskFieldDef) => !f.read_only && (!options.keys || options.keys.includes(f.key)) && values[f.key] !== undefined && values[f.key] !== null
  const targets = fields.filter((f) => f.type === 'signature' && wanted(f))
  const containers = fields.filter((f) => holdsNestedSignatures(f) && wanted(f))
  if (!targets.length && !containers.length) return {}
  const cells = containers.flatMap((f) => nestedSignatureCells(f, values[f.key]))
  let user: SignatureStampInput['user'] = null
  if (options.actorId) {
    let name: string | null = null
    try {
      const { data } = await (db as any).from('users').select('id, display_name, email').eq('id', options.actorId).maybeSingle()
      name = data ? String(data.display_name || data.email || '') || null : null
    } catch { /* the name is optional */ }
    user = { id: options.actorId, name }
  }
  const audited = targets.some((f) => f.signature?.capture_audit) || cells.some((c) => c.field.signature?.capture_audit && c.value)
  const request = options.request !== undefined ? options.request : audited ? await requestAudit() : null
  const out: Record<string, unknown> = {}
  for (const field of targets) {
    out[field.key] = stampSignature(field, values[field.key], { user, request, now: options.now, previous: options.previous?.[field.key] })
  }
  for (const field of containers) {
    // The stored signatures of this field by their PNG (a row may have moved since it was signed).
    const before = new Map<string, unknown>()
    for (const cell of nestedSignatureCells(field, options.previous?.[field.key])) {
      const sig = normalizeSignatureValue(cell.value)
      if (sig?.file.id) before.set(`${cell.field.key}|${sig.file.id}`, sig)
    }
    out[field.key] = mapNestedSignatures(field, values[field.key], (inner, value) => {
      if (value === null || value === undefined || value === '') return value
      const sig = normalizeSignatureValue(value)
      return stampSignature(inner, value, { user, request, now: options.now, previous: sig ? before.get(`${inner.key}|${sig.file.id}`) : undefined })
    })
  }
  return out
}
