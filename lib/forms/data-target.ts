/**
 * Form data targets: a reusable form bound to a record in an external
 * system that an EXTENSION provides (a list item in another product, a
 * row in a line-of-business system …). The binding is stored on the
 * layout as
 *
 *   layout.data_target = { extension, key, config, label? }
 *
 * so it travels with the form's versions, exports and packages. `extension`
 * + `key` name the provider (ServerExtension.formTargets[key] of that
 * extension); `config` is the provider's own small settings object (ids,
 * names, options — scalars only, bounded).
 *
 * What core does with it (lib/services/form-targets.ts):
 *  - opening the form page: the provider's `prepare` loads the record the
 *    URL parameters identify (initial values, a concurrency `version`), and
 *    may refresh field properties that live in the external system (choice
 *    options, read-only, help text, bounds — FIELD_PATCH_KEYS only);
 *  - submitting: after core validated the values (types, required, rules),
 *    the provider's `submit` writes the record; its field errors come back
 *    per field and a 409 / 412 as a conflict; nothing is stored when it fails;
 *  - saving / deleting the form: `saved` / `deleted` let the provider record
 *    which external fields the form uses (schema-drift warnings);
 *  - the designer: `check` reports problems (fields that no longer exist
 *    externally …) shown above the canvas;
 *  - display forms: `prepare` may answer `mode: 'display'` — the page shows
 *    the record read-only (every field read-only, no submit buttons, the
 *    record's files as links, the provider's actions such as "Edit" as
 *    buttons) and core refuses submissions of it.
 *
 * People cross the boundary as e-mail addresses (the provider never sees
 * user ids it can't use): `prepare` may return `{ email }` objects for
 * Person fields — core maps them to workspace members — and `submit` gets
 * the chosen people's id, name and e-mail.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { TaskFieldDef } from '@/lib/task-field-schema'

export interface FormDataTargetRef {
  /** Extension id (manifest id). */
  extension: string
  /** The extension's form target key (ServerExtension.formTargets). */
  key: string
  /** Provider settings: scalars (and arrays of strings), bounded. */
  config: Record<string, string | number | boolean | string[]>
  /** What the designer and the form page call it ("CRM accounts"). */
  label?: string
}

/** Field properties a provider may refresh when the form opens (and before a submission is checked). */
export const FIELD_PATCH_KEYS = ['options', 'option_labels', 'read_only', 'required', 'help_text', 'min', 'max', 'placeholder'] as const
export type FormFieldPatch = Partial<Pick<TaskFieldDef, typeof FIELD_PATCH_KEYS[number]>>

export const DATA_TARGET_LIMITS = { configKeys: 40, string: 2000, arrayItems: 500, label: 200, options: 2000, option: 500, helpText: 2000 } as const

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/
const CONFIG_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

const clean = (value: string, max: number) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max)

/** A stored binding → a clean one, or undefined (unknown shapes are dropped, never trusted). */
export function normalizeDataTarget(raw: unknown): FormDataTargetRef | undefined {
  if (!isPlainObject(raw)) return undefined
  const extension = typeof raw.extension === 'string' ? raw.extension : ''
  const key = typeof raw.key === 'string' ? raw.key : ''
  if (!ID_RE.test(extension) || !KEY_RE.test(key)) return undefined
  const config: FormDataTargetRef['config'] = {}
  if (isPlainObject(raw.config)) {
    for (const [name, value] of Object.entries(raw.config).slice(0, DATA_TARGET_LIMITS.configKeys)) {
      if (!CONFIG_KEY_RE.test(name)) continue
      if (typeof value === 'string') config[name] = clean(value, DATA_TARGET_LIMITS.string)
      else if (typeof value === 'number' && Number.isFinite(value)) config[name] = value
      else if (typeof value === 'boolean') config[name] = value
      else if (Array.isArray(value)) config[name] = value.filter((v): v is string => typeof v === 'string').slice(0, DATA_TARGET_LIMITS.arrayItems).map((v) => clean(v, DATA_TARGET_LIMITS.string))
    }
  }
  const out: FormDataTargetRef = { extension, key, config }
  const label = typeof raw.label === 'string' ? clean(raw.label.trim(), DATA_TARGET_LIMITS.label) : ''
  if (label) out.label = label
  return out
}

/** The layout's binding, if any. */
export function layoutDataTarget(layout: unknown): FormDataTargetRef | undefined {
  return isPlainObject(layout) ? normalizeDataTarget(layout.data_target) : undefined
}

/** Same provider (extension + key) and config? */
export function sameDataTarget(a: FormDataTargetRef | undefined, b: FormDataTargetRef | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** A provider's field patches → clean patches for known fields (FIELD_PATCH_KEYS only, bounded). */
export function normalizeFieldPatches(raw: unknown, fields: Pick<TaskFieldDef, 'key'>[]): Record<string, FormFieldPatch> {
  const out: Record<string, FormFieldPatch> = {}
  if (!isPlainObject(raw)) return out
  const known = new Set(fields.map((f) => f.key))
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key) || !isPlainObject(value)) continue
    const patch: FormFieldPatch = {}
    if (Array.isArray(value.options)) {
      const options = [...new Set(value.options.filter((o): o is string | number => typeof o === 'string' || typeof o === 'number').map((o) => clean(String(o), DATA_TARGET_LIMITS.option)).filter(Boolean))]
      patch.options = options.slice(0, DATA_TARGET_LIMITS.options)
    }
    if (isPlainObject(value.option_labels)) {
      const labels: Record<string, string> = {}
      for (const [k, v] of Object.entries(value.option_labels)) if (typeof v === 'string' && v) labels[clean(k, DATA_TARGET_LIMITS.option)] = clean(v, DATA_TARGET_LIMITS.option)
      patch.option_labels = labels
    }
    if (typeof value.read_only === 'boolean') patch.read_only = value.read_only
    if (typeof value.required === 'boolean') patch.required = value.required
    if (typeof value.help_text === 'string') patch.help_text = clean(value.help_text, DATA_TARGET_LIMITS.helpText)
    if (typeof value.placeholder === 'string') patch.placeholder = clean(value.placeholder, 200)
    if (typeof value.min === 'number' && Number.isFinite(value.min)) patch.min = value.min
    if (typeof value.max === 'number' && Number.isFinite(value.max)) patch.max = value.max
    if (Object.keys(patch).length) out[key] = patch
  }
  return out
}

/**
 * Fields with the provider's patches applied. Options only patch choice-like
 * fields that already have options (a Text field never becomes a choice);
 * option labels are kept for the options that remain.
 */
export function applyFieldPatches(fields: TaskFieldDef[], patches: Record<string, FormFieldPatch>): TaskFieldDef[] {
  if (!Object.keys(patches).length) return fields
  return fields.map((field) => {
    const patch = patches[field.key]
    if (!patch) return field
    const next: TaskFieldDef = { ...field }
    if (patch.options && Array.isArray(field.options)) {
      next.options = patch.options
      const labels = { ...(field.option_labels ?? {}), ...(patch.option_labels ?? {}) }
      const kept = Object.fromEntries(Object.entries(labels).filter(([v]) => patch.options!.includes(v)))
      if (Object.keys(kept).length) next.option_labels = kept
      else delete next.option_labels
    } else if (patch.option_labels && Array.isArray(field.options)) {
      next.option_labels = Object.fromEntries(Object.entries({ ...(field.option_labels ?? {}), ...patch.option_labels }).filter(([v]) => field.options!.includes(v)))
    }
    if (patch.read_only !== undefined) next.read_only = patch.read_only
    if (patch.required !== undefined) next.required = patch.required
    if (patch.help_text !== undefined) next.help_text = patch.help_text || undefined
    if (patch.placeholder !== undefined) next.placeholder = patch.placeholder || undefined
    if (patch.min !== undefined && (field.type === 'number' || field.type === 'currency')) next.min = patch.min
    if (patch.max !== undefined && (field.type === 'number' || field.type === 'currency')) next.max = patch.max
    return next
  })
}

/**
 * A link a provider offers on the form page: an app path (`/f/<id>?…`) or an
 * http(s) URL. `target`: `self` (default for app paths; inside a trusted
 * embedding frame a form path stays in the frame), `top` (the whole window,
 * e.g. back to the page that framed the form) or `blank` (default for
 * http(s) URLs).
 */
export interface FormTargetLink { label: string; url: string; primary?: boolean; target?: 'self' | 'top' | 'blank' }

const LINK_LIMITS = { items: 20, label: 120, url: 2000 } as const

/**
 * A provider's links → clean ones: an app path (starting with one `/`) or an
 * http(s) URL, no credentials, labels bounded. `httpOnly` drops app paths
 * (files live in the external system).
 */
export function normalizeTargetLinks(raw: unknown, options: { httpOnly?: boolean } = {}): FormTargetLink[] {
  if (!Array.isArray(raw)) return []
  const out: FormTargetLink[] = []
  for (const item of raw) {
    if (out.length >= LINK_LIMITS.items) break
    if (!isPlainObject(item) || typeof item.label !== 'string' || typeof item.url !== 'string') continue
    const label = clean(item.label.trim(), LINK_LIMITS.label)
    const url = item.url.trim()
    if (!label || !url || url.length > LINK_LIMITS.url || /[\s\u0000-\u001f]/.test(url)) continue
    let ok = false
    if (/^\/(?![/\\])/.test(url)) ok = !options.httpOnly
    else {
      try {
        const parsed = new URL(url)
        ok = (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password
      } catch { ok = false }
    }
    const target = item.target === 'self' || item.target === 'top' || item.target === 'blank' ? item.target : null
    if (ok) out.push({ label, url, ...(item.primary === true ? { primary: true } : {}), ...(target ? { target } : {}) })
  }
  return out
}

/** What the form page gets about its data target (no provider internals). */
export interface FormDataTargetState {
  label: string | null
  /** create: a new record; edit: an existing one (`record`); display: the record read-only (no submission). */
  mode: 'create' | 'edit' | 'display'
  record: { id: string; label?: string | null; url?: string | null } | null
  /** Initial values (field key → value), already in the form's value shapes. */
  values: Record<string, unknown>
  /** Concurrency token to send back with the submission (an ETag, a version number). */
  version: string | null
  /** A short text the page shows above the fields. */
  notice: string | null
  /** Display forms (and others): buttons the provider offers, e.g. "Edit" opening the record's edit form. */
  actions?: FormTargetLink[]
  /** The record's files in the external system (attachments), shown as links. */
  files?: FormTargetLink[]
}

/** Is this an e-mail-shaped person value from a provider (`{ email }`)? */
export function isEmailPerson(value: unknown): value is { email: string; name?: string } {
  return isPlainObject(value) && typeof value.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(value.email.trim())
}
