/**
 * "Publish as form page": a reusable form made from a workflow's START form
 * (its inputs, lib/forms/start-form.ts) so the workflow gets a shareable
 * page (/f/<id>) — without changing how the workflow starts (Run, API and
 * CLI starts with inputs work exactly as before).
 *
 * The form copies the start form's fields, grid and theme, gets a header
 * (the workflow's name) and a Submit button whose actions are
 *   1. Start workflow — this workflow, every field mapped to the matching
 *      input as a single `{{key}}` placeholder (so numbers stay numbers,
 *      checkboxes booleans), run as the submitter;
 *   2. Show success screen — "Thanks — your request has been submitted"
 *      with the run reference.
 *
 * The link lives on that Start workflow action (`start_form_page.key`), so
 * it travels wherever the form travels (export / import / packages — the
 * workflow id is remapped like every button's). `key` fingerprints what was
 * copied — fields, layout, theme, input mapping — at the last sync:
 *
 *   start form now ≠ key   → "Start form changed — update form page?"
 *   form page now  ≠ key   → someone edited the copied parts of the form:
 *                            syncing asks before overwriting them.
 *
 * Everything else on the form (name, description, header, button labels,
 * the success screen, other buttons) belongs to the form's owner: syncing
 * never touches it. Pure and isomorphic.
 */

import { compactLayoutForSave } from './layout'
import { normalizeFormDefinition, type FormDefinition } from './definition'
import { normalizeFormButtons, type FormAction, type FormButton } from './buttons'
import { defaultFormHeader, type FormHeader } from './header'
import { WORKSPACE_THEME_REF, type FormThemeRef } from './form-theme'
import { startFormFromVariables, type StartFormVariable } from './start-form'

/* eslint-disable @typescript-eslint/no-explicit-any -- node config / rows are loose JSON */

export const FORM_PAGE_SUCCESS_TITLE = 'Thanks — your request has been submitted'
export const FORM_PAGE_SUCCESS_TEXT = 'Your reference: {{run_reference}}'
const NAME_MAX = 120
const INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

/** The name a published start form gets. */
export function formPageName(workflowName: string): string {
  const base = String(workflowName ?? '').trim() || 'Workflow'
  const suffix = ' — start form'
  return base.length + suffix.length > NAME_MAX ? `${base.slice(0, NAME_MAX - suffix.length - 1).trimEnd()}…${suffix}` : `${base}${suffix}`
}

/* ── Fingerprint ─────────────────────────────────────────────────────── */

/** JSON with sorted object keys (stored jsonb does not keep key order). */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** 64-bit FNV-1a of a string, as 16 hex characters. */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x01000193) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** The parts of a form a start form decides. */
export interface FormPageContent {
  fields: FormDefinition['fields']
  layout: FormDefinition['layout']
  theme: FormThemeRef
  /** The Start workflow action's input mapping (input name → template). */
  inputs: Record<string, string>
}

/**
 * The fingerprint of the copied parts. A saved theme is compared by its
 * kind only (its id is per workspace and remapped on import).
 */
export function formPageKey(content: FormPageContent): string {
  const def = normalizeFormDefinition({ fields: content.fields, layout: content.layout, theme: content.theme })
  const keys = def.fields.map((f) => f.key)
  const layout = def.layout ? compactLayoutForSave(def.layout, keys) : null
  const theme = def.theme.source === 'saved' ? { source: 'saved' } : def.theme
  return fingerprint(stableStringify({ fields: def.fields, layout, theme, inputs: content.inputs ?? {} }))
}

/* ── The start form → the form page content ─────────────────────────── */

export interface StartFormSource {
  /** user_variables of the version runs use (published, else the draft). */
  user_variables: unknown
  /** The trigger node's config holding `start_form` (layout / theme), if any. */
  trigger_config: Record<string, any> | null | undefined
}

/** The start-form trigger node's config (the node with `start_form`, else the first trigger). */
export function startFormTriggerConfig(nodes: unknown, isTrigger: (type: string) => boolean = () => false): Record<string, any> | null {
  const list = (Array.isArray(nodes) ? nodes : []) as any[]
  const node = list.find((n) => n?.config?.start_form && typeof n.config.start_form === 'object') ?? list.find((n) => isTrigger(String(n?.type ?? '')))
  return node?.config ?? null
}

/**
 * What the form page copies from a start form: fields, layout, theme and the
 * input mapping (every field → its variable). Variables whose name a form
 * button can't map (not `[A-Za-z_][A-Za-z0-9_]*`) are listed in `skipped`.
 */
export function formPageContent(source: StartFormSource): FormPageContent & { skipped: string[] } {
  const variables = (Array.isArray(source.user_variables) ? source.user_variables : []) as StartFormVariable[]
  const model = startFormFromVariables(variables, source.trigger_config ?? undefined)
  const inputs: Record<string, string> = {}
  const skipped: string[] = []
  const fields = model.def.fields.filter((field) => {
    const name = model.nameByKey.get(field.key) ?? field.key
    if (!INPUT_NAME_RE.test(name)) { skipped.push(name); return false }
    inputs[name] = `{{${field.key}}}`
    return true
  })
  const def = normalizeFormDefinition({ fields, layout: model.def.layout, theme: model.def.theme })
  return { fields: def.fields, layout: def.layout, theme: def.theme ?? WORKSPACE_THEME_REF, inputs, skipped }
}

/** Does this start form make a usable page (at least one mappable field)? */
export function canPublishFormPage(source: StartFormSource): boolean {
  return formPageContent(source).fields.length > 0
}

/* ── The form ───────────────────────────────────────────────────────── */

export interface FormPageWorkflow { id: string; name: string; description?: string | null }

/** The Start workflow action of a form page (with its link). */
export function formPageStartAction(workflow: FormPageWorkflow, content: FormPageContent): FormAction {
  return {
    type: 'start_workflow',
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    inputs: { ...content.inputs },
    start_form_page: { key: formPageKey(content) },
  }
}

/** A new form page (createForm input). */
export function buildFormPage(workflow: FormPageWorkflow, content: FormPageContent): {
  name: string; description: string; fields: FormDefinition['fields']; layout: FormDefinition['layout']; theme: FormThemeRef; header: FormHeader; buttons: FormButton[]
} {
  const header = defaultFormHeader(workflow.name)
  const subtitle = String(workflow.description ?? '').replace(/[<>]/g, '').trim()
  if (subtitle) header.subtitle = subtitle.slice(0, 300)
  return {
    name: formPageName(workflow.name),
    description: `Form page of the start form of "${workflow.name}": submitting it starts the workflow.`.slice(0, 2000),
    fields: content.fields,
    layout: content.layout,
    theme: content.theme,
    header,
    buttons: [
      {
        id: 'submit', label: 'Submit', kind: 'submit', style: 'primary',
        actions: [
          formPageStartAction(workflow, content),
          { type: 'success_screen', title: FORM_PAGE_SUCCESS_TITLE, text: FORM_PAGE_SUCCESS_TEXT, screen_button: 'submit_another' },
        ],
      },
      { id: 'cancel', label: 'Cancel', kind: 'cancel', style: 'secondary', hidden: true },
    ],
  }
}

/** The form page link of a form's buttons for a workflow: the button and its marked Start workflow action. */
export function findFormPageAction(buttons: unknown, workflowId: string): { button: FormButton; action: FormAction; index: number } | null {
  for (const button of normalizeFormButtons(Array.isArray(buttons) ? buttons : null)) {
    const index = (button.actions ?? []).findIndex((a) => a.type === 'start_workflow' && a.workflow_id === workflowId && a.start_form_page)
    if (index >= 0) return { button, action: button.actions![index], index }
  }
  return null
}

/** Is this form a form page (of any workflow)? The workflow, if so. */
export function formPageOf(buttons: unknown): { workflow_id: string; workflow_name: string | null } | null {
  for (const button of normalizeFormButtons(Array.isArray(buttons) ? buttons : null)) {
    const action = (button.actions ?? []).find((a) => a.type === 'start_workflow' && a.workflow_id && a.start_form_page)
    if (action) return { workflow_id: action.workflow_id!, workflow_name: action.workflow_name ?? null }
  }
  return null
}

/** The copied parts of a stored form page, as they are now. */
export function storedFormPageContent(form: { fields?: unknown; layout?: unknown; theme?: unknown; buttons?: unknown }, workflowId: string): FormPageContent | null {
  const link = findFormPageAction(form.buttons, workflowId)
  if (!link) return null
  const def = normalizeFormDefinition({ fields: form.fields, layout: form.layout, theme: form.theme })
  return { fields: def.fields, layout: def.layout, theme: def.theme, inputs: { ...(link.action.inputs ?? {}) } }
}

export type FormPageStatus = 'in_sync' | 'start_form_changed' | 'form_edited' | 'both_changed'

/**
 * Where a form page stands against the start form: the start form changed
 * since the last sync, the form's copied parts were edited, both, or
 * neither. Null when the form is not this workflow's form page.
 */
export function formPageStatus(form: { fields?: unknown; layout?: unknown; theme?: unknown; buttons?: unknown }, workflowId: string, source: StartFormSource): FormPageStatus | null {
  const link = findFormPageAction(form.buttons, workflowId)
  const stored = storedFormPageContent(form, workflowId)
  if (!link || !stored) return null
  const synced = link.action.start_form_page!.key
  const startChanged = formPageKey(formPageContent(source)) !== synced
  const formEdited = formPageKey(stored) !== synced
  if (startChanged && formEdited) {
    // Both sides moved to the same place (someone made the same edit by hand).
    return formPageKey(formPageContent(source)) === formPageKey(stored) ? 'in_sync' : 'both_changed'
  }
  return startChanged ? 'start_form_changed' : formEdited ? 'form_edited' : 'in_sync'
}

/**
 * The form update a sync writes: the copied parts from the start form, the
 * Start workflow action's mapping and key refreshed. The rest of the form
 * (header, labels, other actions and buttons) is kept as it is.
 */
export function syncFormPageUpdate(form: { buttons?: unknown }, workflow: FormPageWorkflow, content: FormPageContent): { fields: FormDefinition['fields']; layout: FormDefinition['layout']; theme: FormThemeRef; buttons: FormButton[] } | null {
  const link = findFormPageAction(form.buttons, workflow.id)
  if (!link) return null
  const buttons = normalizeFormButtons(Array.isArray(form.buttons) ? form.buttons : null).map((button) => {
    if (button.id !== link.button.id) return button
    const actions = (button.actions ?? []).map((action, i) => (i === link.index ? { ...action, ...formPageStartAction(workflow, content) } : action))
    return { ...button, actions }
  })
  return { fields: content.fields, layout: content.layout, theme: content.theme, buttons }
}

/** Buttons with every form page link removed (a duplicate is an ordinary form). */
export function withoutFormPageLinks(buttons: unknown): unknown {
  if (!Array.isArray(buttons)) return buttons
  return buttons.map((button: any) => (Array.isArray(button?.actions)
    ? { ...button, actions: button.actions.map((a: any) => { if (!a || typeof a !== 'object' || !('start_form_page' in a)) return a; const { start_form_page: _link, ...rest } = a; return rest }) }
    : button))
}
