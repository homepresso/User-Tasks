/**
 * Server-side task value checks every write path runs (task screen save /
 * complete, REST /tasks/{id}/action and PATCH /tasks/{id}, MCP tasks_*,
 * CLI via REST): the pure type / required / validation rules of
 * mergeTaskFieldValues, plus what needs the database — a Person field must
 * name an active member of the task's workspace, and an Autocomplete /
 * lookup field's value must exist in its source (unless it allows free
 * text); the selected item is stored as `<key>_item` (computed here, never
 * taken from the client); an Attachments field's files are rebuilt from the
 * server's upload records (lib/services/form-files.ts) — only files
 * uploaded into this task / form by this submitter — with `<key>_count`.
 * Never trust the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FileValueContext } from '@/lib/services/form-files'
import { coerceTaskFieldValues, mergeTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'

/* eslint-disable @typescript-eslint/no-explicit-any -- user_memberships is read untyped */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Fill other fields from the selected item": the values come from the
 * server-verified item (resolveLookupSelections), coerced to each target's
 * type. Every target — read-only or editable — always gets the item's
 * value, whatever the client sent: the selected item is the source of truth
 * for the fields it fills (mergeTaskFieldValues drops read-only values, which
 * is why fills used to be lost).
 */
function lookupFillTargets(fields: ReturnType<typeof normalizeTaskFields>, fills: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fills)) {
    const target = fields.find((f) => f.key === key)
    if (!target || target.type === 'lookup' || target.type === 'attachments') continue
    Object.assign(out, coerceTaskFieldValues([target], { [key]: value }))
  }
  return out
}

export async function mergeTaskFieldValuesChecked(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  metadata: Record<string, unknown> | null | undefined,
  values: Record<string, unknown> | null | undefined,
  options: {
    partial?: boolean
    taskId?: string | null
    task?: Record<string, unknown> | null
    /** Where attachment uploads must come from (default: the task `taskId`). */
    files?: FileValueContext | null
  } = {},
): Promise<{ errors: Record<string, string>; templateValues: Record<string, unknown> }> {
  const merged = mergeTaskFieldValues(metadata, values, options)
  if (Object.keys(merged.errors).length > 0) return merged
  const fields = normalizeTaskFields(metadata?.fields)
  const errors: Record<string, string> = {}

  // Lookups: confirm the values, store `<key>_item`. On drafts only the
  // submitted lookups are resolved; completion checks every lookup.
  const lookups = fields.filter((f) => f.type === 'lookup' && !f.read_only)
  const lookupKeys = options.partial
    ? lookups.filter((f) => values && Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => f.key)
    : lookups.map((f) => f.key)
  let templateValues = merged.templateValues
  if (lookupKeys.length) {
    const { resolveLookupSelections } = await import('@/lib/services/form-lookup')
    const { createServiceClient } = await import('@/lib/cron-auth')
    const existing = isPlainObject(metadata?.template_values) ? metadata!.template_values as Record<string, unknown> : {}
    const resolved = await resolveLookupSelections(createServiceClient(), tenantId, fields, merged.templateValues, {
      strict: !options.partial,
      taskId: options.taskId ?? null,
      task: options.task ?? null,
      previous: existing,
      keys: lookupKeys,
    })
    Object.assign(errors, resolved.errors)
    templateValues = { ...templateValues, ...resolved.items, ...lookupFillTargets(fields, resolved.fills ?? {}) }
  }
  // Attachments: the files are re-read from the upload records (this
  // task's, or this submitter's uploads to this form); `<key>_count` added.
  const attachments = fields.filter((f) => f.type === 'attachments' && !f.read_only)
  const attachmentKeys = options.partial
    ? attachments.filter((f) => values && Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => f.key)
    : attachments.map((f) => f.key)
  if (attachmentKeys.length) {
    const { resolveAttachmentValues } = await import('@/lib/services/form-files')
    const { createServiceClient } = await import('@/lib/cron-auth')
    const context: FileValueContext | null = options.files
      ?? (options.taskId && UUID_RE.test(options.taskId) ? { kind: 'task', taskId: options.taskId } : null)
    const resolved = await resolveAttachmentValues(createServiceClient(), tenantId, fields, templateValues, context, attachmentKeys)
    Object.assign(errors, resolved.errors)
    templateValues = { ...templateValues, ...resolved.values }
  }
  if (!values) return { errors, templateValues }
  const people = fields.filter((f) => f.type === 'user' && !f.read_only)
  const wanted = new Map<string, string>()
  for (const field of people) {
    const value = values[field.key]
    if (typeof value === 'string' && value.trim()) wanted.set(field.key, value.trim())
  }
  if (wanted.size > 0) {
    const ids = [...new Set(wanted.values())]
    const { data } = await (supabase as any).from('user_memberships')
      .select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', ids)
    const members = new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => String(r.user_id)))
    const missing = ids.filter((id) => !members.has(id))
    if (missing.length) {
      // Home-workspace users may have no membership row.
      const { data: home } = await (supabase as any).from('users').select('id').eq('tenant_id', tenantId).in('id', missing)
      for (const row of (home ?? []) as Array<{ id: string }>) members.add(String(row.id))
    }
    for (const field of people) {
      const id = wanted.get(field.key)
      if (id && !members.has(id)) errors[field.key] = `${field.label} must be a person in this workspace`
    }
  }
  return { errors, templateValues }
}
