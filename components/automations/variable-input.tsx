"use client"

import { useState, useRef, useEffect, useMemo, useCallback, useId, createContext, useContext } from "react"
import { TASK_VARIABLE_CATALOG } from '@/lib/task-data'
import { useActiveInput } from './active-input'
import { DataPickerButton, DropChoicesPopover, dataDropPayload, useDataPicker } from './data-picker'
import { cn } from "@/lib/utils"
import { formFieldSuggestions, pathLabels } from '@/lib/workflow-data-picker'
import { insertTokenAt, tokenizeTemplate, type DataDragPayload } from '@/lib/workflow-data-drop'
import {
  applyPick, chipInfo, detectTrigger, legacyPickerEntries, pickerRows, readRecentVariables, rememberRecentVariable, sampleText, templateProblems,
  type ChipInfo, type PickerScope, type PickerTrigger, type PickerVariable,
} from '@/lib/variable-picker'
import { useVariableScope } from './variable-scope'
import { VariablePickerMenu, optionId } from './variable-picker-menu'

/**
 * Variable-aware inline editor.
 *
 * Historically this was a plain <input> that held {{variable}} tokens as raw
 * text. It now uses contentEditable so {{name}} tokens render as actual
 * styled pill elements inline with the text the user is typing. This gives
 * workflow designers an obvious visual distinction between literal strings
 * and dynamic values, matching the new VariableText component used in the
 * canvas + process viewer.
 *
 * The outer API is unchanged:
 *   <VariableInput value={string} onChange={(v: string) => void} ... />
 *
 * Internally we:
 *   - Tokenize the value string into { text | var } segments
 *   - Render those into the editor as text nodes and contenteditable=false pills
 *   - On every `input` event, serialize the editor DOM back into the plain
 *     string form and call onChange(newValue)
 *   - On blur, re-tokenize so manually-typed `{{foo}}` becomes a pill
 *   - When an external value prop update comes in, re-render from tokens if
 *     the new value differs from what the editor currently holds
 *
 * The variable picker (lib/variable-picker.ts): the {x} button beside the
 * input, or typing `{{` / `{` anywhere, opens a searchable, grouped list at
 * the caret (keyboard: arrows, Enter / Tab, → for a row's columns, Esc).
 * Its entries come from the nearest VariableScopeProvider (the form
 * designer: lib/forms/variable-catalog.ts) or, without one, the workflow
 * lists below. With a scope, chips read as their label ("Selected row ›
 * ID"), show a sample on hover, and a token that won't resolve here is
 * underlined and explained under the input. The stored string never
 * changes form: `{{path}}`.
 */

// Context so parent components can set trigger type once for all nested VariableInputs
const TriggerTypeContext = createContext<string | undefined>(undefined)
export const TriggerTypeProvider = TriggerTypeContext.Provider

// Core context variables always available
const CORE_VARIABLES = [
  // Workflow
  { name: "_title", group: "Workflow" },
  { name: "task_id", group: "Workflow" },
  { name: "tenant_id", group: "Workflow" },
  { name: "workflow_started_by", group: "Workflow" },
  { name: "workflow_started_via", group: "Workflow" },
  { name: "workflow_owner_id", group: "Workflow" },
  { name: "workflow_initiator_user_id", group: "Workflow" },
  // Task fields — from the shared catalog (see lib/task-data.ts). One extra
  // field kept for back-compat that the catalog folds elsewhere:
  ...TASK_VARIABLE_CATALOG.map((v) => ({ name: v.name, group: v.group })),
  { name: "task.estimated_effort_assignee", group: "Task" },
  // API / Reference
  { name: "api_response", group: "API" },
  { name: "api_status", group: "API" },
  { name: "api_file", group: "API" },
  { name: "api_file_url", group: "API" },
  { name: "api_file_name", group: "API" },
  { name: "http_file", group: "API" },
  { name: "http_file_url", group: "API" },
  // Error Handling
  { name: "has_error", group: "Error" },
  { name: "last_error", group: "Error" },
  { name: "last_error_node", group: "Error" },
  // Workflow Error Trigger
  { name: "error_workflow_id", group: "Workflow Error" },
  { name: "error_workflow_name", group: "Workflow Error" },
  { name: "error_run_id", group: "Workflow Error" },
  { name: "error_message", group: "Workflow Error" },
  { name: "error_node", group: "Workflow Error" },
  { name: "error_timestamp", group: "Workflow Error" },
  // Data table triggers
  { name: "data_event", group: "Data" },
  { name: "data_event_type", group: "Data" },
  { name: "data_table_id", group: "Data" },
  { name: "data_table_name", group: "Data" },
  { name: "data_row_id", group: "Data" },
  { name: "data_row", group: "Data" },
  { name: "row", group: "Data" },
  { name: "row_id", group: "Data" },
  // Status values (for value field)
  { name: "draft", group: "Status values" },
  { name: "todo", group: "Status values" },
  { name: "in_progress", group: "Status values" },
  { name: "blocked", group: "Status values" },
  { name: "completed", group: "Status values" },
  { name: "cancelled", group: "Status values" },
  // Priority values
  { name: "critical", group: "Priority values" },
  { name: "high", group: "Priority values" },
  { name: "medium", group: "Priority values" },
  { name: "low", group: "Priority values" },
  { name: "none", group: "Priority values" },
]

const TASK_TRIGGERS = ['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected']
const DATA_TRIGGERS = ['data_table_event']
// Reserved for future use (kept to avoid changing the shape of this file).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const WEBHOOK_TRIGGERS = ['webhook_received']
const MIDDLEWARE_TRIGGERS = ['middleware_received']

// Groups that require specific trigger types to be relevant
const GROUP_TRIGGER_MAP: Record<string, string[]> = {
  'Task': TASK_TRIGGERS,
  'Task Data': TASK_TRIGGERS,
  'Dates': TASK_TRIGGERS,
  'Data': DATA_TRIGGERS,
  'API': [...WEBHOOK_TRIGGERS, ...MIDDLEWARE_TRIGGERS],
  'Workflow Error': ['workflow_error'],
  'Policy Review': ['retention_policy_review'],
  'Policy Executed': ['retention_policy_executed'],
}


// ─── Tokenization helpers ──────────────────────────────────────────────

/** How a chip draws (readable label, problem, sample): the input's picker scope, else the data picker's labels. */
type ChipLookup = (name: string) => ChipInfo | null

/** Build a styled pill DOM element for a variable or expression token. */
function createPillElement(name: string, isExpression?: boolean, label?: string, info?: ChipInfo | null): HTMLSpanElement {
  const pill = document.createElement('span')
  pill.contentEditable = 'false'
  pill.dataset.var = name
  if (isExpression) pill.dataset.expr = '1'
  pill.className = 'variable-pill inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md font-mono text-2xs font-medium align-middle whitespace-nowrap select-none'
  // Expression pills stay violet but blend toward the theme's text colour so
  // they read clearly on both light and fully-dark themes (the old static
  // --status-info violet looked greyed-out on dark themes like Nebula).
  // The violet is the theme's chart-6 hue (formerly a raw #7D5B7A).
  pill.style.backgroundColor = isExpression ? 'color-mix(in srgb, var(--theme-chart-6) 20%, transparent)' : 'var(--theme-primary-light)'
  pill.style.color = isExpression ? 'color-mix(in srgb, var(--theme-chart-6) 55%, var(--theme-card-text))' : 'var(--theme-primary-text)'
  pill.style.border = `1px solid ${isExpression ? 'color-mix(in srgb, var(--theme-chart-6) 45%, transparent)' : 'color-mix(in srgb, var(--theme-accent) 40%, transparent)'}`
  pill.style.lineHeight = '1'
  const readable = !isExpression ? (info?.label && info.label !== name ? info.label : label) : undefined
  pill.title = isExpression ? `Expression: ${name}` : readable ? `${readable}: {{${name}}}` : `Variable: ${name}`
  // Known variables read as their label (sans), the path on hover.
  if (readable) { pill.dataset.label = readable; pill.style.fontFamily = 'var(--theme-font-sans)' }
  if (!isExpression && info?.sample !== undefined) pill.title += `\nSample: ${sampleText(info.sample)}`
  if (!isExpression && info?.problem) {
    pill.dataset.problem = info.problem
    pill.title += `\n⚠ ${info.problem}`
    pill.style.textDecoration = 'underline wavy var(--status-blocked)'
    pill.style.textUnderlineOffset = '2px'
  }
  pill.textContent = isExpression ? `ƒ ${name}` : (readable ?? name)
  return pill
}

/**
 * Replace the editor's contents with fresh text nodes + pills for the given
 * value. After rendering, an extra zero-width space is appended if the last
 * token was a pill, so the caret can land after it.
 */
function renderTokens(editor: HTMLElement, text: string, labels?: ReadonlyMap<string, string> | null) {
  editor.innerHTML = ''
  const tokens = tokenizeTemplate(text, labels ?? (editor as any).__pillLabels)
  const chip = (editor as any).__chipInfo as ChipLookup | undefined
  for (const tok of tokens) {
    if (tok.type === 'text') {
      editor.appendChild(document.createTextNode(tok.value))
    } else {
      editor.appendChild(createPillElement(tok.value, tok.isExpression, tok.label, tok.isExpression ? null : chip?.(tok.value)))
    }
  }
  if (tokens.length > 0 && tokens[tokens.length - 1].type === 'var') {
    editor.appendChild(document.createTextNode('​'))
  }
}

/**
 * Serialize the editor DOM back to its plain-text representation so we can
 * call onChange with a string. Pill elements become their `{{name}}` (or
 * `{{= name }}`) form; text nodes pass through verbatim; <br> becomes \n.
 */
function editorToText(el: Node): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Strip zero-width spaces from the serialized form
      text += (node.textContent ?? '').replace(/​/g, '')
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      const varName = element.dataset?.var
      if (varName) {
        const isExpr = element.dataset.expr === '1'
        text += isExpr ? `{{= ${varName} }}` : `{{${varName}}}`
      } else if (element.tagName === 'BR') {
        text += '\n'
      } else {
        text += editorToText(element)
      }
    }
  }
  return text
}

/**
 * Compute the caret offset as a character index in the plain-text form.
 * Walks the editor's children in order, converting each into its text-form
 * contribution, and stops when we hit the child that contains the caret.
 */
function getCaretOffsetInText(editor: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  let offset = 0
  for (const child of Array.from(editor.childNodes)) {
    if (child === range.startContainer) {
      // Zero-width spacers (after a trailing chip) are not part of the stored text.
      if (child.nodeType === Node.TEXT_NODE) offset += (child.textContent ?? '').slice(0, range.startOffset).replace(/\u200B/g, '').length
      return offset
    }
    if (child.nodeType === Node.TEXT_NODE) {
      offset += ((child.textContent ?? '').replace(/\u200B/g, '')).length
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement
      if (element.dataset?.var) {
        const name = element.dataset.var
        const isExpr = element.dataset.expr === '1'
        offset += isExpr ? `{{= ${name} }}`.length : `{{${name}}}`.length
      } else if (element.contains(range.startContainer)) {
        // Rare: the cursor landed inside a non-pill element we didn't generate.
        // Recurse to find it.
        return offset + getCaretOffsetInText(element)
      }
    }
  }
  return offset
}

/**
 * Text offset for a POINTER position (drag-drop) — mirrors getCaretOffsetInText's
 * pill-token serialization so a chip dropped mid-string lands where the cursor is,
 * not wherever the caret last sat.
 */
function caretOffsetFromPoint(editor: HTMLElement, x: number, y: number): number | null {
  return dropPosition(editor, x, y)?.offset ?? null
}

/** Length of one editor child in the plain-text form. */
function serializedLength(child: ChildNode): number {
  if (child.nodeType === Node.TEXT_NODE) return ((child.textContent ?? '').replace(/\u200B/g, '')).length
  if (child.nodeType !== Node.ELEMENT_NODE) return 0
  const element = child as HTMLElement
  if (element.dataset?.var) return element.dataset.expr === '1' ? `{{= ${element.dataset.var} }}`.length : `{{${element.dataset.var}}}`.length
  if (element.tagName === 'BR') return 1
  return editorToText(element).length
}

/**
 * Where a drop at (x, y) lands: the plain-text offset plus a caret rectangle
 * (viewport coords) for the preview. Over a chip: before or after the whole
 * token (by which half), never inside it.
 */
function dropPosition(editor: HTMLElement, x: number, y: number): { offset: number; rect: { left: number; top: number; height: number } | null } | null {
  const children = Array.from(editor.childNodes)
  let offset = 0
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).dataset?.var) {
      const box = (child as HTMLElement).getBoundingClientRect()
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        const after = x > box.left + box.width / 2
        return { offset: offset + (after ? serializedLength(child) : 0), rect: { left: after ? box.right + 1 : box.left - 2, top: box.top, height: box.height } }
      }
    }
    offset += serializedLength(child)
  }

  let container: Node | null = null
  let offsetInNode = 0
  const doc = document as any
  let range: Range | null = null
  if (typeof doc.caretRangeFromPoint === 'function') {
    range = doc.caretRangeFromPoint(x, y)
    if (range) { container = range.startContainer; offsetInNode = range.startOffset }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) { container = pos.offsetNode; offsetInNode = pos.offset; range = document.createRange(); range.setStart(pos.offsetNode, pos.offset) }
  }
  if (!container || !editor.contains(container)) return null
  const rectOf = (r: Range | null) => {
    const box = r ? (r.getClientRects()[0] ?? r.getBoundingClientRect()) : null
    return box && (box.height || box.left) ? { left: box.left, top: box.top, height: box.height || 14 } : null
  }

  // Between children (e.g. right after a chip): the first `offsetInNode` children.
  if (container === editor) {
    let at = 0
    children.slice(0, offsetInNode).forEach((child) => { at += serializedLength(child) })
    const prev = children[offsetInNode - 1] as HTMLElement | undefined
    const prevBox = prev && prev.nodeType === Node.ELEMENT_NODE ? prev.getBoundingClientRect() : null
    return { offset: at, rect: prevBox ? { left: prevBox.right + 1, top: prevBox.top, height: prevBox.height } : rectOf(range) }
  }

  let at = 0
  for (const child of children) {
    if (child === container) return { offset: at + (child.nodeType === Node.TEXT_NODE ? offsetInNode : 0), rect: rectOf(range) }
    if (child.contains(container)) return { offset: at, rect: rectOf(range) }
    at += serializedLength(child)
  }
  return { offset: at, rect: rectOf(range) }
}

/** Place the caret at the end of the editor's content. */
function moveCaretToEnd(editor: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** Put the caret at plain-text offset `offset` (after a chip when the offset is its end). */
function placeCaretAt(editor: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  let remaining = Math.max(0, offset)
  for (const child of Array.from(editor.childNodes)) {
    const len = serializedLength(child)
    if (child.nodeType === Node.TEXT_NODE && remaining <= len) {
      const t = child.textContent ?? ''
      let dom = 0
      let seen = 0
      while (dom < t.length && (seen < remaining || t[dom] === '​')) { if (t[dom] !== '​') seen++; dom++ }
      range.setStart(child, dom)
      range.collapse(true)
      sel.removeAllRanges(); sel.addRange(range)
      return
    }
    remaining -= len
    if (remaining === 0 && child.nodeType === Node.ELEMENT_NODE) {
      const next = child.nextSibling
      if (next && next.nodeType === Node.TEXT_NODE) {
        const t = next.textContent ?? ''
        range.setStart(next, t.startsWith('​') ? 1 : 0)
      } else range.setStartAfter(child)
      range.collapse(true)
      sel.removeAllRanges(); sel.addRange(range)
      return
    }
    if (remaining < 0) break
  }
  moveCaretToEnd(editor)
}

/** The chip right before (Backspace) or after (Delete) a collapsed caret, skipping the zero-width spacer. */
function chipNextToCaret(editor: HTMLElement, backwards: boolean): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const { startContainer: node, startOffset: at } = sel.getRangeAt(0)
  if (!editor.contains(node)) return null
  let sibling: Node | null = null
  if (node === editor) sibling = editor.childNodes[backwards ? at - 1 : at] ?? null
  else if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? ''
    const rest = backwards ? t.slice(0, at) : t.slice(at)
    if (rest.replace(/​/g, '').length) return null
    sibling = backwards ? node.previousSibling : node.nextSibling
  }
  return sibling && sibling.nodeType === Node.ELEMENT_NODE && (sibling as HTMLElement).dataset?.var ? sibling as HTMLElement : null
}

/** Where the menu opens: under the caret (container coordinates), kept inside the container's width where it can be. */
function menuPosition(container: HTMLElement, editor: HTMLElement, atCaret: boolean): { left: number; top: number; width: number } {
  const box = container.getBoundingClientRect()
  const editorBox = editor.getBoundingClientRect()
  const width = Math.max(260, Math.min(360, box.width))
  let left = 0
  let top = editorBox.bottom - box.top + 4
  if (atCaret) {
    const sel = window.getSelection()
    const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
    if (r && (r.left || r.top) && editor.contains(sel!.anchorNode)) {
      left = r.left - box.left
      top = Math.max(top, r.bottom - box.top + 4)
    }
  }
  left = Math.max(Math.min(left, box.width - width), Math.min(0, box.width - width))
  return { left: Math.round(left), top: Math.round(top), width }
}

// ─── Component ─────────────────────────────────────────────────────────

interface VariableInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  extraVariables?: { name: string; group: string; label?: string }[]
  triggerType?: string
  /** Multi-line text (bodies, templates, JSON): Enter inserts a newline; `rows` sets the minimum height. */
  multiline?: boolean
  rows?: number
  /** Classes of the outer wrapper (layout in flex rows: `flex-1 min-w-0`, a width, a margin). */
  wrapperClassName?: string
  /** The variables for where this input is (default: the nearest VariableScopeProvider; none: the workflow lists). */
  scope?: PickerScope | null
  /** Accessible name (default: the placeholder). */
  ariaLabel?: string
}

const PLAIN_GROUP = (group: string) => group === 'Status values' || group === 'Priority values' || group.startsWith('Rows in ')
const WORKFLOW_RECENT_KEY = 'ut.variables.recent'

type MenuState = { mode: 'inline' | 'button'; query: string; trigger: PickerTrigger | null; position: { left: number; top: number; width: number } }

export function VariableInput({
  value,
  onChange,
  placeholder,
  className,
  extraVariables,
  triggerType,
  multiline = false,
  rows = 3,
  wrapperClassName,
  scope: scopeProp,
  ariaLabel,
}: VariableInputProps) {
  const contextTriggerType = useContext(TriggerTypeContext)
  const effectiveTriggerType = triggerType ?? contextTriggerType
  const contextScope = useVariableScope()
  const scope = scopeProp === undefined ? contextScope : scopeProp
  // Tree data picker (upstream steps / response models) when the config panel provides one.
  const dataPicker = useDataPicker()
  const listboxId = `vp-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [recent, setRecent] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  // Insertion caret preview while dragging data over the editor (container coords).
  const [dropCaret, setDropCaret] = useState<{ left: number; top: number; height: number } | null>(null)
  // A list dropped here: choose first / all / loop before inserting.
  const [dropChoices, setDropChoices] = useState<{ payload: DataDragPayload; at: { x: number; y: number }; offset: number } | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // Last caret position (in plain-text offset) so click-to-insert from the
  // floating bar lands where the user was typing, even after the editor blurs.
  const caretOffsetRef = useRef(0)
  const focusedOnceRef = useRef(false)
  // Tracks the last value string we know the editor is synced with, so we
  // can skip re-rendering when the parent calls us with a value that already
  // matches what the editor shows (otherwise every keystroke would reset
  // the caret).
  const lastSyncedValueRef = useRef<string>('')
  // A key the open menu handled (its keyup must not re-run the trigger check).
  const menuKeyHandled = useRef(false)

  // Readable chip labels for form fields / inputs (renderTokens reads them off the editor).
  const pillLabels = useMemo(() => (dataPicker ? pathLabels(dataPicker.groups) : null), [dataPicker])
  const formSuggestions = useMemo(() => (dataPicker ? formFieldSuggestions(dataPicker.groups) : []), [dataPicker])

  // The entries: the scope's (plus local extras it doesn't have), else the workflow lists.
  const items = useMemo<PickerVariable[]>(() => {
    if (scope) {
      const taken = new Set(scope.items.map((i) => i.path))
      return [...legacyPickerEntries((extraVariables ?? []).filter((e) => !taken.has(e.name))), ...scope.items]
    }
    let vars: { name: string; group: string; label?: string }[] = formSuggestions.map((s) => ({ name: s.name, group: s.group, label: s.label }))
    vars = [...vars, ...CORE_VARIABLES.filter(v => {
      const requiredTriggers = GROUP_TRIGGER_MAP[v.group]
      if (!requiredTriggers) return true
      if (!effectiveTriggerType) return true
      return requiredTriggers.includes(effectiveTriggerType)
    }).filter((v) => !vars.some((f) => f.name === v.name))]
    for (const ev of extraVariables ?? []) if (!vars.some(v => v.name === ev.name)) vars.push(ev)
    // Local extras (the input's own placeholders) first, as the forms used to list them last.
    return legacyPickerEntries(vars, PLAIN_GROUP)
  }, [scope, extraVariables, effectiveTriggerType, formSuggestions])
  const recentKey = scope?.recentKey ?? WORKFLOW_RECENT_KEY

  // Chips: the scope's labels, samples and problems (renderTokens reads the lookup off the editor).
  const chipLookup = useMemo<ChipLookup | null>(() => {
    if (!scope) return null
    const extras = legacyPickerEntries(extraVariables ?? [])
    return (name: string) => chipInfo(name, scope) ?? (() => { const e = extras.find((x) => x.path === name); return e ? { label: e.label } : null })()
  }, [scope, extraVariables])
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const previous = (editor as any).__pillLabels as ReadonlyMap<string, string> | undefined
    ;(editor as any).__pillLabels = pillLabels
    const prevChips = (editor as any).__chipInfo
    ;(editor as any).__chipInfo = chipLookup ?? undefined
    const same = previous === pillLabels || (previous && pillLabels && previous.size === pillLabels.size && [...pillLabels].every(([k, v]) => previous.get(k) === v))
    if ((!same || prevChips !== (chipLookup ?? undefined)) && document.activeElement !== editor) renderTokens(editor, editorToText(editor), pillLabels)
  }, [pillLabels, chipLookup])

  const problems = useMemo(() => templateProblems(value, scope), [value, scope])

  // Sync editor content when the `value` prop changes from outside.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (lastSyncedValueRef.current === value) return
    const current = editorToText(editor)
    if (current === value) {
      lastSyncedValueRef.current = value
      return
    }
    // A focused editor keeps its caret (the parent may have normalised what was typed).
    const focused = document.activeElement === editor
    const caret = focused ? getCaretOffsetInText(editor) : 0
    renderTokens(editor, value)
    if (focused) placeCaretAt(editor, Math.min(caret, value.length))
    lastSyncedValueRef.current = value
    // Update the empty data attribute for the placeholder CSS
    updateEmptyState(editor)
  }, [value])

  // On mount, ensure the editor shows the initial value
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    ;(editor as any).__chipInfo = chipLookup ?? undefined
    renderTokens(editor, value)
    lastSyncedValueRef.current = value
    updateEmptyState(editor)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateEmptyState = useCallback((editor: HTMLElement) => {
    const text = editorToText(editor)
    if (text.length === 0) editor.setAttribute('data-empty', 'true')
    else editor.removeAttribute('data-empty')
  }, [])

  const openMenu = useCallback((mode: MenuState['mode'], trigger: PickerTrigger | null) => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || !container) return
    const position = menuPosition(container, editor, mode === 'inline')
    setMenu((current) => {
      if (current && current.mode === mode && mode === 'inline' && current.trigger?.start === trigger?.start) return { ...current, query: trigger?.query ?? '', trigger }
      return { mode, query: trigger?.query ?? '', trigger, position }
    })
    if (!menu || menu.mode !== mode) { setActive(0); setRecent(readRecentVariables(recentKey)) }
  }, [menu, recentKey])

  const closeMenu = useCallback(() => { setMenu(null); setActive(0) }, [])

  const updateSuggestionsForText = useCallback((text: string, cursorOffset: number) => {
    const trigger = detectTrigger(text, cursorOffset)
    if (trigger) { openMenu('inline', trigger); setActive(0); return }
    if (menu?.mode === 'inline') closeMenu()
  }, [openMenu, closeMenu, menu])

  // Handle live input — sync editor text back to parent, drive autocomplete
  const handleInput = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const text = editorToText(editor)
    lastSyncedValueRef.current = text
    onChange(text)
    updateEmptyState(editor)
    const cursorOffset = getCaretOffsetInText(editor)
    caretOffsetRef.current = cursorOffset
    updateSuggestionsForText(text, cursorOffset)
  }, [onChange, updateEmptyState, updateSuggestionsForText])

  // Keep the caret ref current on any focused interaction (typing/clicking/keys).
  const trackCaret = useCallback(() => {
    const editor = editorRef.current
    if (editor && document.activeElement === editor) caretOffsetRef.current = getCaretOffsetInText(editor)
  }, [])

  /** Commit a new value, re-render the chips and put the caret at `caret`. */
  const commitValue = useCallback((next: string, caret: number, focus = true) => {
    const editor = editorRef.current
    if (!editor) return
    onChange(next)
    renderTokens(editor, next)
    lastSyncedValueRef.current = next
    updateEmptyState(editor)
    caretOffsetRef.current = caret
    focusedOnceRef.current = true
    if (focus) {
      // At once when focused (the next key lands after the change); else once focus is back (the menu's search box had it).
      if (document.activeElement === editor) placeCaretAt(editor, caret)
      else requestAnimationFrame(() => { editor.focus(); placeCaretAt(editor, caret) })
    }
  }, [onChange, updateEmptyState])

  /** Insert a picked entry: replaces what was typed after `{{` / `{`, else goes in at the caret. */
  const insertEntry = useCallback((entry: PickerVariable) => {
    const editor = editorRef.current
    if (!editor) return
    const text = editorToText(editor)
    const caret = menu?.mode === 'inline' && document.activeElement === editor ? getCaretOffsetInText(editor) : focusedOnceRef.current ? caretOffsetRef.current : text.length
    const trigger = menu?.mode === 'inline' ? detectTrigger(text, caret) : null
    const next = applyPick(text, trigger, Math.min(caret, text.length), entry)
    if (!entry.plain) setRecent(rememberRecentVariable(recentKey, entry.path))
    closeMenu()
    commitValue(next.value, next.caret)
  }, [menu, recentKey, closeMenu, commitValue])

  // Paste: strip formatting
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    // Use execCommand for broad compatibility — modern browsers still
    // support it for text insertion inside contentEditable.
    document.execCommand('insertText', false, text)
  }, [])

  /** Put `token` at text offset `offset` (an empty field is replaced). */
  const insertAt = useCallback((offset: number, token: string) => {
    const next = insertTokenAt(value, offset, token)
    commitValue(next.value, next.caret, false)
  }, [value, commitValue])

  // Drag-over: highlight and preview where the token will land.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
    const container = containerRef.current
    const editor = editorRef.current
    const position = editor ? dropPosition(editor, e.clientX, e.clientY) : null
    if (!container || !position?.rect) { setDropCaret(null); return }
    const box = container.getBoundingClientRect()
    const next = { left: Math.round(position.rect.left - box.left), top: Math.round(position.rect.top - box.top), height: Math.round(position.rect.height) }
    setDropCaret((current) => (current && current.left === next.left && current.top === next.top ? current : next))
  }, [])

  // Drop: insert where the token was DROPPED (caret, then the end as fallbacks);
  // a list (or a field inside one) asks first / all / loop like the picker.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    setDropCaret(null)
    const editor = editorRef.current
    if (!editor) return
    const payload = dataDropPayload(e)
    const varText = e.dataTransfer.getData('text/plain')
    if (!varText && !payload) return
    const pointerOffset = caretOffsetFromPoint(editor, e.clientX, e.clientY)
    const offset = Math.min(Math.max(pointerOffset ?? (focusedOnceRef.current ? caretOffsetRef.current : value.length), 0), value.length)
    if (payload?.needsChoices && dataPicker) {
      setDropChoices({ payload, at: { x: e.clientX, y: e.clientY }, offset })
      return
    }
    insertAt(offset, varText || `{{${payload!.path}}}`)
  }, [value, insertAt, dataPicker])

  // Insert an already-formed token (e.g. "{{field}}" or "{{=FUNC()}}") at the caret.
  // This is the click-to-insert channel used by the floating Variables/Expressions bar.
  const insertRawToken = useCallback((token: string) => {
    const editor = editorRef.current
    if (!editor) return
    // Use the live caret when focused, else the last tracked position (the bar
    // click blurs the editor). Clamp defensively to the current value length.
    // Never focused yet (e.g. the data picker button was the first click) → append.
    const raw = document.activeElement === editor ? getCaretOffsetInText(editor) : focusedOnceRef.current ? caretOffsetRef.current : value.length
    const cursorOffset = Math.min(Math.max(raw, 0), value.length)
    commitValue(value.slice(0, cursorOffset) + token + value.slice(cursorOffset), cursorOffset + token.length)
  }, [value, commitValue])

  // Register as the "active input" while focused so the floating bar can insert
  // into it. Kept ref-fresh to avoid stale-closure inserts; unregistered on unmount.
  const insertRawTokenRef = useRef(insertRawToken)
  insertRawTokenRef.current = insertRawToken
  const { register: registerActiveInput } = useActiveInput()
  const unregisterActiveRef = useRef<null | (() => void)>(null)
  useEffect(() => () => unregisterActiveRef.current?.(), [])

  // On blur, re-tokenize manually-typed `{{foo}}` into pills so the editor
  // always settles into its pill form when the user clicks away.
  const handleBlur = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const text = editorToText(editor)
    if (/\{\{[^}]+\}\}/.test(text)) {
      renderTokens(editor, text)
      lastSyncedValueRef.current = text
    }
  }, [])

  // Close the menu on a click outside.
  useEffect(() => {
    if (!menu) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menu])

  function handleFocus() {
    const editor = editorRef.current
    if (!editor) return
    focusedOnceRef.current = true
    unregisterActiveRef.current?.()
    unregisterActiveRef.current = registerActiveInput((token) => insertRawTokenRef.current(token))
  }

  const query = menu?.query ?? ''
  const rowsShown = useMemo(() => (menu ? pickerRows(items, query, expanded, recent) : []), [menu, items, query, expanded, recent])

  useEffect(() => {
    setActive((current) => (rowsShown.length === 0 ? 0 : Math.min(current, rowsShown.length - 1)))
  }, [rowsShown.length])

  // Keep the active option in view.
  useEffect(() => {
    if (!menu) return
    document.getElementById(optionId(listboxId, active))?.scrollIntoView({ block: 'nearest' })
  }, [menu, active, listboxId])

  const toggle = useCallback((path: string) => {
    setExpanded((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })
  }, [])

  /** Enter / Tab / click on a row: a folded row / object opens (pick a column), anything else goes in. */
  const pickRow = useCallback((index: number) => {
    const row = rowsShown[index]
    if (!row) return
    if (row.kind === 'item' && row.expandable && !row.expanded) {
      toggle(row.item.path)
      // The first column, right after "Insert the whole row".
      setActive(index + 2)
      return
    }
    insertEntry(row.item)
  }, [rowsShown, toggle, insertEntry])

  /** Keys while the menu is open (the editor's or the search box's). True: handled. */
  const menuKey = useCallback((e: React.KeyboardEvent): boolean => {
    if (!menu) return false
    const n = rowsShown.length
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    if (e.key === 'ArrowDown') { stop(); if (n) setActive((c) => (c + 1) % n); return true }
    if (e.key === 'ArrowUp') { stop(); if (n) setActive((c) => (c - 1 + n) % n); return true }
    if ((e.key === 'Enter' || e.key === 'Tab') && n) { stop(); pickRow(active); return true }
    // Escape: the window listener below (it must run before a dialog's document listener).
    if (e.key === 'Escape') { stop(); return true }
    const row = rowsShown[active]
    if (e.key === 'ArrowRight' && row?.expandable && !row.expanded && (menu.mode === 'button' || !query)) { stop(); toggle(row.item.path); return true }
    if (e.key === 'ArrowLeft' && row && (row.expanded || row.depth > 0) && (menu.mode === 'button' || !query)) {
      stop()
      const parent = row.expanded ? row.item.path : rowsShown.slice(0, active).reverse().find((r) => r.expanded)?.item.path
      if (parent) { toggle(parent); setActive(Math.max(0, rowsShown.findIndex((r) => r.item.path === parent && r.kind === 'item'))) }
      return true
    }
    return false
  }, [menu, rowsShown, active, pickRow, toggle, query])

  // Escape closes the menu only. Dialogs (Radix) listen on the document in the capture
  // phase, so a React handler is too late: catch it on the window, before them.
  useEffect(() => {
    if (!menu) return
    const mode = menu.mode
    function onEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const container = containerRef.current
      if (!container || !container.contains(document.activeElement)) return
      e.stopPropagation()
      e.preventDefault()
      setMenu(null)
      if (mode === 'button') requestAnimationFrame(() => { const ed = editorRef.current; if (ed) { ed.focus(); placeCaretAt(ed, caretOffsetRef.current) } })
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [menu])

  const openFromButton = useCallback(() => {
    if (menu?.mode === 'button') { closeMenu(); return }
    const editor = editorRef.current
    if (editor && document.activeElement === editor) caretOffsetRef.current = getCaretOffsetInText(editor)
    openMenu('button', null)
    setActive(0)
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [menu, closeMenu, openMenu])

  const inline = menu?.mode === 'inline'
  const describedBy = problems.length ? `${listboxId}-problems` : undefined

  return (
    <div ref={containerRef} className={cn("relative", wrapperClassName)} data-variable-input>
      <div className="flex items-start gap-1">
        <div className="relative min-w-0 flex-1">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="combobox"
            aria-label={ariaLabel ?? (placeholder || 'Text with variables')}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={inline}
            aria-controls={inline ? listboxId : undefined}
            aria-activedescendant={inline && rowsShown.length ? optionId(listboxId, active) : undefined}
            aria-describedby={describedBy}
            aria-invalid={problems.length ? true : undefined}
            onInput={handleInput}
            onKeyUp={(e) => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) trackCaret(); if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') && !menuKeyHandled.current) { const ed = editorRef.current; if (ed) updateSuggestionsForText(editorToText(ed), getCaretOffsetInText(ed)) } menuKeyHandled.current = false }}
            onMouseUp={trackCaret}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (inline && menuKey(e)) { menuKeyHandled.current = true; return }
              const editor = editorRef.current
              // Backspace / Delete next to a chip removes the whole chip.
              if (editor && (e.key === 'Backspace' || e.key === 'Delete')) {
                const chip = chipNextToCaret(editor, e.key === 'Backspace')
                if (chip) {
                  e.preventDefault()
                  e.stopPropagation()
                  const before = getCaretOffsetInText(editor)
                  const len = serializedLength(chip)
                  const text = editorToText(editor)
                  const start = e.key === 'Backspace' ? before - len : before
                  commitValue(text.slice(0, start) + text.slice(start + len), start)
                  return
                }
              }
              // One line: Enter adds nothing (pre-wrap would keep a newline the value must not have).
              if (e.key === 'Enter' && !multiline && !e.nativeEvent.isComposing) e.preventDefault()
              if (e.key === 'Enter' && multiline && !e.nativeEvent.isComposing) {
                // A newline character (kept by pre-wrap), not a <div> block the serializer would drop.
                e.preventDefault()
                document.execCommand('insertText', false, '\n')
              }
              if (e.key !== 'Escape') e.stopPropagation()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDragLeave={() => { setDragOver(false); setDropCaret(null) }}
            onDrop={handleDrop}
            data-drop-zone="expression"
            data-placeholder={placeholder ?? ''}
            className={cn(
              'variable-input-editor w-full rounded-[var(--ds-radius-input)] border bg-input px-2 py-1 text-xs font-mono text-fg outline-none',
              'transition-[border-color,box-shadow] duration-[var(--ds-dur-fast)]',
              problems.length ? 'border-warning' : dragOver ? 'border-primary bg-primary-wash' : 'border-input-border hover:border-border-strong',
              dataPicker && 'pr-6',
              // pre-wrap: a typed trailing space stays a space (the stored text is what is shown).
              'whitespace-pre-wrap break-words',
              'focus:border-primary focus:ring-1 focus:ring-primary',
              dragOver && 'ring-2 ring-primary',
              className,
            )}
            style={{
              minHeight: multiline ? `${Math.max(1, rows) * 16 + 8}px` : '24px',
              lineHeight: '16px',
            }}
          />

          {dataPicker && <DataPickerButton onPick={(expression) => insertRawToken(expression)} />}
        </div>
        <button
          type="button"
          className={cn(
            'flex h-6 shrink-0 items-center rounded-md border px-1 font-mono text-2xs font-semibold text-primary-text transition-colors',
            menu?.mode === 'button' ? 'border-primary bg-primary-wash' : 'border-input-border bg-input hover:border-border-strong hover:bg-subtle',
          )}
          title="Insert variable (or type {{ or {)"
          aria-label="Insert variable"
          aria-haspopup="listbox"
          aria-expanded={menu?.mode === 'button'}
          onMouseDown={(e) => { e.preventDefault(); const editor = editorRef.current; if (editor && document.activeElement === editor) caretOffsetRef.current = getCaretOffsetInText(editor) }}
          onClick={openFromButton}
          data-variable-picker-button
        >
          {'{x}'}
        </button>
      </div>

      {problems.length > 0 && (
        <ul id={`${listboxId}-problems`} className="mt-1 space-y-0.5 text-xs text-warning" data-variable-warning>
          {problems.map((p) => <li key={p.path} className="flex items-start gap-1"><span aria-hidden>⚠</span><span><code className="font-mono text-2xs">{`{{${p.path}}}`}</code> — {p.problem}</span></li>)}
        </ul>
      )}

      {dragOver && dropCaret && (
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 w-0.5 rounded-full bg-primary animate-pulse"
          style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height }}
        />
      )}
      {dragOver && (
        <span aria-hidden className="pointer-events-none absolute -top-2 right-1 z-10 rounded bg-primary px-1 text-2xs font-medium text-primary-fg">
          {value.trim() ? 'Drop to insert' : 'Drop to set'}
        </span>
      )}
      {dropChoices && (
        <DropChoicesPopover
          payload={dropChoices.payload}
          at={dropChoices.at}
          onPick={(expression) => { insertAt(dropChoices.offset, expression); setDropChoices(null) }}
          onClose={() => setDropChoices(null)}
        />
      )}

      {menu && (
        <VariablePickerMenu
          listboxId={listboxId}
          rows={rowsShown}
          active={active}
          onActive={setActive}
          onPick={pickRow}
          onToggle={toggle}
          note={scope?.note}
          query={query}
          position={menu.position}
          empty={items.length ? 'No variable matches' : 'No variables here'}
          search={menu.mode === 'button' ? (
            <input
              ref={searchRef}
              autoFocus
              role="combobox"
              aria-label="Search variables"
              aria-autocomplete="list"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={rowsShown.length ? optionId(listboxId, active) : undefined}
              className="h-6 min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-subtle"
              placeholder="Search: row id, customer, today…"
              value={query}
              onChange={(e) => { const q = e.target.value; setMenu((m) => (m ? { ...m, query: q } : m)); setActive(0) }}
              onKeyDown={(e) => { if (!menuKey(e)) e.stopPropagation() }}
              data-variable-picker-search
            />
          ) : undefined}
        />
      )}
    </div>
  )
}
