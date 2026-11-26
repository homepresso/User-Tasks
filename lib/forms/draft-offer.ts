/**
 * When a reusable form offers "Resume your draft from …?" (components/forms/standalone-form.tsx).
 *
 * The prompt used to hide as soon as the form's values held anything — but a
 * form writes values by itself when it opens: bound defaults ({{param.x}}),
 * Labels working out their value, a repeating section's starting items, "When
 * the form loads" rules. So a form with defaults or a repeating section never
 * offered the draft. What counts is whether the PERSON has started: an edit
 * event they made in the form (typing, pasting, changing a control, pressing a
 * control's button) — never a value the form set itself.
 */

/** The parts of a DOM event the decision reads (a React synthetic event fits). */
export interface EditEventLike {
  type: string
  /** false for events a script dispatched (form code), true for the person's. */
  isTrusted?: boolean
  key?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

const EDIT_EVENTS = new Set(['input', 'change', 'paste', 'cut', 'drop'])
const EDIT_KEYS = new Set(['Backspace', 'Delete', 'Enter', ' '])

/**
 * Whether an event inside the form's fields is the person editing. `onControl`:
 * a pointer event's target is a control that changes a value (a button, an
 * option, a radio / checkbox / switch / slider) — not the page around it.
 */
export function isPersonEdit(event: EditEventLike, onControl = false): boolean {
  if (event.isTrusted === false) return false
  if (EDIT_EVENTS.has(event.type)) return true
  if (event.type === 'keydown') {
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    const key = event.key ?? ''
    return key.length === 1 || EDIT_KEYS.has(key)
  }
  if (event.type === 'click' || event.type === 'pointerdown') return onControl
  return false
}

/** Selector of the controls whose click changes a value (isPersonEdit's `onControl`). */
export const VALUE_CONTROL_SELECTOR = 'button, [role="option"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="menuitem"], [role="tab"], input, select, textarea, label'

/** Whether the person has entered anything: they edited, and the values hold something of theirs. */
export function personHasEntered(values: Record<string, unknown>, edited: boolean): boolean {
  return edited && Object.keys(values).some((k) => !k.startsWith('__form_'))
}

/** Offer the saved draft: signed in, not a display form, a draft exists, not yet decided, the person hasn't started. */
export function shouldOfferDraft(input: { anonymous: boolean; displayOnly: boolean; hasDraft: boolean; decided: boolean; entered: boolean }): boolean {
  return !input.anonymous && !input.displayOnly && input.hasDraft && !input.decided && !input.entered
}

/**
 * Unsaved for a host that asks before closing (an app panel): the person edited
 * AND some value of theirs differs from what the form filled in by itself (its
 * defaults, e.g. {{param.workspace_id}}). Clicking into a field, or a form that
 * only holds its own defaults, is nothing to lose.
 */
export function hasUnsavedEntries(values: Record<string, unknown>, defaults: Record<string, unknown>, edited: boolean): boolean {
  if (!edited) return false
  const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
  const same = (a: unknown, b: unknown) => { try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) } catch { return a === b } }
  return Object.entries(values).some(([k, v]) => !k.startsWith('__form_') && !empty(v) && !same(v, defaults[k]))
}
