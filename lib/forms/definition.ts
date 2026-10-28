/**
 * A form definition — fields + grid layout + mini-theme reference — and how
 * it is stored on a node (User Task, task triggers) or a reusable form.
 *
 * Node config keys (all optional, so existing workflows are unchanged):
 *   fields        the field list (lib/task-field-schema.ts)
 *   form_layout   the grid (lib/forms/layout.ts); absent → classic rendering
 *   form_theme    mini-theme reference (lib/forms/form-theme.ts)
 *   form_buttons  the button bar and its behaviours (lib/forms/buttons.ts);
 *                 absent → the defaults (Submit / Cancel; a task keeps its
 *                 classic outcome buttons)
 *   form_header   the optional header (lib/forms/header.ts); absent → none
 *   form_id       linked reusable form (the fields/layout/theme above are a
 *                 cached copy, refreshed when the designer opens the node)
 *   form_name     linked form's name (badge)
 *   form_cached_version  version the cached copy came from
 *   form_version  set only inside PUBLISHED workflow versions: the version
 *                 pinned at publish time. Drafts follow the latest version.
 *
 * The workflow START form (manual / API start) is the workflow inputs
 * (user_variables); its grid and theme live on the trigger node's config as
 * `start_form: { layout, theme }` (lib/forms/start-form.ts).
 *
 * Pure and isomorphic.
 */

import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { compactLayoutForSave, normalizeFormLayout, type FormLayout } from './layout'
import { parseFormThemeRef, WORKSPACE_THEME_REF, type FormThemeRef } from './form-theme'
import { isDefaultButtons, normalizeFormButtons, type FormButton } from './buttons'
import { normalizeFormHeader, type FormHeader } from './header'

export interface FormDefinition {
  fields: TaskFieldDef[]
  layout: FormLayout | null
  theme: FormThemeRef
  /** Configured buttons; null = the defaults. */
  buttons?: FormButton[] | null
  /** The header; null = none. */
  header?: FormHeader | null
}

/** Buttons as stored: null when absent or just the defaults. */
export function storedButtons(raw: unknown): FormButton[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const buttons = normalizeFormButtons(raw)
  return isDefaultButtons(buttons) ? null : buttons
}

export interface FormLink {
  form_id: string
  form_name?: string
  /** Version of the cached copy on the node. */
  cached_version?: number
  /** Pinned version (published snapshots only). */
  pinned_version?: number
}

/** Node types whose config carries a form. */
export const FORM_NODE_TYPES: ReadonlySet<string> = new Set([
  'user_task', 'form_submitted', 'task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected',
])

export const TASK_TRIGGER_TYPES: ReadonlySet<string> = new Set([
  'task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected',
])

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

/** Normalize any stored definition (node config, form row, manifest asset). */
export function normalizeFormDefinition(raw: { fields?: unknown; layout?: unknown; theme?: unknown; buttons?: unknown; header?: unknown } | null | undefined): FormDefinition {
  const fields = normalizeTaskFields(raw?.fields)
  return {
    fields,
    layout: normalizeFormLayout(raw?.layout, fields.map((f) => f.key)),
    theme: parseFormThemeRef(raw?.theme ?? WORKSPACE_THEME_REF),
    buttons: storedButtons(raw?.buttons),
    header: normalizeFormHeader(raw?.header),
  }
}

/** The form a node's config describes (its own or the cached copy of a linked form). */
export function readNodeForm(config: Record<string, any> | null | undefined): FormDefinition {
  return normalizeFormDefinition({ fields: config?.fields, layout: config?.form_layout, theme: config?.form_theme, buttons: config?.form_buttons, header: config?.form_header })
}

export function readNodeFormLink(config: Record<string, any> | null | undefined): FormLink | null {
  const id = typeof config?.form_id === 'string' ? config.form_id : ''
  if (!id) return null
  const link: FormLink = { form_id: id }
  if (typeof config?.form_name === 'string') link.form_name = config.form_name
  if (Number.isInteger(config?.form_cached_version)) link.cached_version = config!.form_cached_version
  if (Number.isInteger(config?.form_version)) link.pinned_version = config!.form_version
  return link
}

/**
 * Config patch that stores `def` on a node: fields, a compact layout (none
 * when it is just one full-width row per field), the theme reference (none
 * when inheriting) and the link (or its removal — a detached local copy).
 */
export function nodeFormPatch(def: FormDefinition, link: FormLink | null): Record<string, unknown> {
  const keys = def.fields.map((f) => f.key)
  const layout = def.layout ? compactLayoutForSave(def.layout, keys) : null
  return {
    fields: def.fields,
    form_layout: layout ?? undefined,
    form_theme: def.theme.source === 'workspace' ? undefined : def.theme,
    form_buttons: def.buttons ?? undefined,
    form_header: def.header ?? undefined,
    form_id: link?.form_id ?? undefined,
    form_name: link?.form_name ?? undefined,
    form_cached_version: link?.cached_version ?? undefined,
    form_version: undefined,
  }
}

/** Comparable JSON of a definition (dirty checks: equal definitions compare equal). */
export function formDefinitionKey(def: FormDefinition): string {
  const keys = def.fields.map((f) => f.key)
  return JSON.stringify({ fields: def.fields, layout: def.layout ? compactLayoutForSave(def.layout, keys) : null, theme: def.theme, buttons: def.buttons ?? null, header: def.header ?? null })
}

/** Linked forms used by a list of nodes: form id → node ids. */
export function linkedFormIds(nodes: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (!Array.isArray(nodes)) return out
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as Record<string, any>
    if (!FORM_NODE_TYPES.has(String(n.type))) continue
    const id = n.config?.form_id
    if (typeof id !== 'string' || !id) continue
    out.set(id, [...(out.get(id) ?? []), String(n.id ?? '')])
  }
  return out
}

/**
 * Nodes for a published snapshot: every linked node gets `form_version`
 * pinned to the form's current version (`versions`: form id → version). A
 * node whose form no longer exists keeps its cached copy, unpinned.
 */
export function pinFormVersions<T>(nodes: T, versions: Map<string, number>): T {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((node: any) => {
    const id = node?.config?.form_id
    if (!FORM_NODE_TYPES.has(String(node?.type)) || typeof id !== 'string' || !versions.has(id)) return node
    return { ...node, config: { ...node.config, form_version: versions.get(id) } }
  }) as T
}

/** Draft copies of a published snapshot (revert): pins removed, so the draft follows the latest form versions again. */
export function unpinFormVersions<T>(nodes: T, triggerConfig?: unknown): { nodes: T; trigger_config: unknown } {
  const out = Array.isArray(nodes)
    ? nodes.map((node: any) => {
      if (!node?.config || !('form_version' in node.config)) return node
      const { form_version: _pinned, ...config } = node.config
      return { ...node, config }
    }) as T
    : nodes
  return { nodes: out, trigger_config: triggerConfig }
}
