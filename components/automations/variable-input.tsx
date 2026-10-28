"use client"

import { useState, useRef, useEffect, useMemo, useCallback, createContext, useContext } from "react"
import { TASK_VARIABLE_CATALOG } from '@/lib/task-data'
import { useActiveInput } from './active-input'
import { DataPickerButton, DropChoicesPopover, dataDropPayload, useDataPicker } from './data-picker'
import { cn } from "@/lib/utils"
import { formFieldSuggestions, pathLabels } from '@/lib/workflow-data-picker'
import { insertTokenAt, tokenizeTemplate, type DataDragPayload } from '@/lib/workflow-data-drop'

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

/** Build a styled pill DOM element for a variable or expression token. */
function createPillElement(name: string, isExpression?: boolean, label?: string): HTMLSpanElement {
  const pill = document.createElement('span')
  pill.contentEditable = 'false'
  pill.dataset.var = name
  if (isExpression) pill.dataset.expr = '1'
  pill.className = 'variable-pill inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md font-mono text-[10px] font-semibold align-middle whitespace-nowrap select-none'
  // Expression pills stay violet but blend toward the theme's text colour so
  // they read clearly on both light and fully-dark themes (the old static
  // --status-info violet looked greyed-out on dark themes like Nebula).
  pill.style.backgroundColor = isExpression ? 'color-mix(in srgb, #7D5B7A 20%, transparent)' : 'var(--theme-primary-light)'
  pill.style.color = isExpression ? 'color-mix(in srgb, #7D5B7A 55%, var(--theme-card-text))' : 'var(--theme-primary-text)'
  pill.style.border = `1px solid ${isExpression ? 'color-mix(in srgb, #7D5B7A 45%, transparent)' : 'color-mix(in srgb, var(--theme-accent) 40%, transparent)'}`
  pill.style.lineHeight = '1'
  pill.title = isExpression ? `Expression: ${name}` : label ? `${label}: {{${name}}}` : `Variable: ${name}`
  // Known form fields / inputs read as their label (sans), the key on hover.
  if (label) { pill.dataset.label = label; pill.style.fontFamily = 'var(--theme-font-sans)'; pill.style.fontSize = '11px' }
  pill.textContent = isExpression ? `ƒ ${name}` : (label ?? name)
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
  for (const tok of tokens) {
    if (tok.type === 'text') {
      editor.appendChild(document.createTextNode(tok.value))
    } else {
      editor.appendChild(createPillElement(tok.value, tok.isExpression, tok.label))
    }
  }
  if (tokens.length > 0 && tokens[tokens.length - 1].type === 'var') {
    editor.appendChild(document.createTextNode('\u200B'))
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
      text += (node.textContent ?? '').replace(/\u200B/g, '')
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
      if (child.nodeType === Node.TEXT_NODE) offset += range.startOffset
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
}

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
}: VariableInputProps) {
  const contextTriggerType = useContext(TriggerTypeContext)
  const effectiveTriggerType = triggerType ?? contextTriggerType
  // Tree data picker (upstream steps / response models) when the config panel provides one.
  const dataPicker = useDataPicker()

  const [showSuggestions, setShowSuggestions] = useState(false)
  const [filter, setFilter] = useState("")
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  // Insertion caret preview while dragging data over the editor (container coords).
  const [dropCaret, setDropCaret] = useState<{ left: number; top: number; height: number } | null>(null)
  // A list dropped here: choose first / all / loop before inserting.
  const [dropChoices, setDropChoices] = useState<{ payload: DataDragPayload; at: { x: number; y: number }; offset: number } | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Last caret position (in plain-text offset) so click-to-insert from the
  // floating bar lands where the user was typing, even after the editor blurs.
  const caretOffsetRef = useRef(0)
  const focusedOnceRef = useRef(false)
  // Tracks the last value string we know the editor is synced with, so we
  // can skip re-rendering when the parent calls us with a value that already
  // matches what the editor shows (otherwise every keystroke would reset
  // the caret).
  const lastSyncedValueRef = useRef<string>('')

  // Readable chip labels for form fields / inputs (renderTokens reads them off the editor).
  const pillLabels = useMemo(() => (dataPicker ? pathLabels(dataPicker.groups) : null), [dataPicker])
  const formSuggestions = useMemo(() => (dataPicker ? formFieldSuggestions(dataPicker.groups) : []), [dataPicker])
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const previous = (editor as any).__pillLabels as ReadonlyMap<string, string> | undefined
    ;(editor as any).__pillLabels = pillLabels
    const same = previous && pillLabels && previous.size === pillLabels.size && [...pillLabels].every(([k, v]) => previous.get(k) === v)
    if (!same && document.activeElement !== editor) renderTokens(editor, editorToText(editor), pillLabels)
  }, [pillLabels])

  const allVariables = useMemo(() => {
    // Form fields (scoped to this step, labelled) first — what designers look for.
    let vars: { name: string; group: string; label?: string }[] = formSuggestions.map((s) => ({ name: s.name, group: s.group, label: s.label }))
    vars = [...vars, ...CORE_VARIABLES.filter(v => {
      const requiredTriggers = GROUP_TRIGGER_MAP[v.group]
      if (!requiredTriggers) return true
      if (!effectiveTriggerType) return true
      return requiredTriggers.includes(effectiveTriggerType)
    }).filter((v) => !vars.some((f) => f.name === v.name))]
    if (extraVariables?.length) {
      for (const ev of extraVariables) {
        if (!vars.some(v => v.name === ev.name)) {
          vars.push(ev)
        }
      }
    }
    return vars
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraVariables, effectiveTriggerType, formSuggestions])

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
    renderTokens(editor, value)
    lastSyncedValueRef.current = value
    // Update the empty data attribute for the placeholder CSS
    updateEmptyState(editor)
  }, [value])

  // On mount, ensure the editor shows the initial value
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
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

  const updateSuggestionsForText = useCallback((text: string, cursorOffset: number) => {
    const textBefore = text.slice(0, cursorOffset)
    const lastOpen = textBefore.lastIndexOf('{{')
    const lastClose = textBefore.lastIndexOf('}}')

    if (lastOpen > lastClose) {
      const partial = textBefore.slice(lastOpen + 2).replace(/^\s*=\s*/, '')
      setFilter(partial.toLowerCase())
      setShowSuggestions(true)
      setActiveSuggestion(0)
      return
    }

    setShowSuggestions(false)
  }, [])

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

  // Insert a variable at the current caret (or replacing a partial `{{xyz`)
  const insertVariable = useCallback((name: string) => {
    const editor = editorRef.current
    if (!editor) return

    const cursorOffset = getCaretOffsetInText(editor)
    const textBefore = value.slice(0, cursorOffset)
    const textAfter = value.slice(cursorOffset)
    const lastOpen = textBefore.lastIndexOf('{{')
    const lastClose = textBefore.lastIndexOf('}}')

    let newValue: string
    if (lastOpen > lastClose) {
      newValue = textBefore.slice(0, lastOpen) + `{{${name}}}` + textAfter
    } else {
      newValue = textBefore + `{{${name}}}` + textAfter
    }

    onChange(newValue)
    renderTokens(editor, newValue)
    lastSyncedValueRef.current = newValue
    updateEmptyState(editor)
    setShowSuggestions(false)
    setActiveSuggestion(0)

    // Focus the editor and move caret to the end so subsequent typing
    // continues after the inserted pill.
    requestAnimationFrame(() => {
      editor.focus()
      moveCaretToEnd(editor)
    })
  }, [value, onChange, updateEmptyState])

  const selectPlainValue = useCallback((val: string) => {
    const editor = editorRef.current
    if (!editor) return
    onChange(val)
    renderTokens(editor, val)
    lastSyncedValueRef.current = val
    updateEmptyState(editor)
    setShowSuggestions(false)
    setActiveSuggestion(0)
  }, [onChange, updateEmptyState])

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
    const editor = editorRef.current
    if (!editor) return
    const next = insertTokenAt(value, offset, token)
    onChange(next.value)
    renderTokens(editor, next.value)
    lastSyncedValueRef.current = next.value
    updateEmptyState(editor)
    caretOffsetRef.current = next.caret
    focusedOnceRef.current = true
  }, [value, onChange, updateEmptyState])

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
    const newValue = value.slice(0, cursorOffset) + token + value.slice(cursorOffset)
    onChange(newValue)
    renderTokens(editor, newValue)
    lastSyncedValueRef.current = newValue
    updateEmptyState(editor)
    caretOffsetRef.current = cursorOffset + token.length
    requestAnimationFrame(() => { editor.focus(); moveCaretToEnd(editor) })
  }, [value, onChange, updateEmptyState])

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
    // Only re-render if the plain-text form contains an unpilled variable
    // (i.e., a {{ ... }} sequence where the editor's DOM still has it as
    // raw text rather than a pill).
    const hasRawToken = /\{\{[^}]+\}\}/.test(text)
    // Detect whether the DOM already represents those tokens as pills by
    // comparing the current serialization with a fresh tokenization.
    if (hasRawToken) {
      renderTokens(editor, text)
      lastSyncedValueRef.current = text
    }
  }, [])

  // Close suggestions on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleFocus() {
    const editor = editorRef.current
    if (!editor) return

    focusedOnceRef.current = true
    unregisterActiveRef.current?.()
    unregisterActiveRef.current = registerActiveInput((token) => insertRawTokenRef.current(token))

    if (value === '') {
      setFilter('')
      setShowSuggestions(true)
      setActiveSuggestion(0)
      return
    }

    updateSuggestionsForText(value, getCaretOffsetInText(editor))
  }

  const filtered = allVariables.filter(
    (v) =>
      v.name.toLowerCase().includes(filter) ||
      ((v as any).label?.toLowerCase().includes(filter)) ||
      // Group names match for the built-in lists; labelled form fields match by label / key only.
      (!(v as any).label && v.group.toLowerCase().includes(filter))
  )

  useEffect(() => {
    setActiveSuggestion((current) => {
      if (filtered.length === 0) return 0
      return Math.min(current, filtered.length - 1)
    })
  }, [filtered.length])

  const groups = filtered.reduce(
    (acc, v) => {
      if (!acc[v.group]) acc[v.group] = []
      acc[v.group].push(v)
      return acc
    },
    {} as Record<string, { name: string; group: string; label?: string }[]>
  )

  const flatSuggestions = filtered.map((variable) => ({
    ...variable,
    isPlain: variable.group === 'Status values' || variable.group === 'Priority values' || variable.group.startsWith('Rows in '),
  }))

  const commitSuggestion = useCallback((suggestion?: (typeof flatSuggestions)[number]) => {
    if (!suggestion) return
    if (suggestion.isPlain) {
      selectPlainValue(suggestion.name)
    } else {
      insertVariable(suggestion.name)
    }
  }, [insertVariable, selectPlainValue])

  return (
    <div ref={containerRef} className={cn("relative", wrapperClassName)}>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyUp={trackCaret}
        onMouseUp={trackCaret}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (showSuggestions && flatSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              e.stopPropagation()
              setActiveSuggestion((current) => (current + 1) % flatSuggestions.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              e.stopPropagation()
              setActiveSuggestion((current) => (current - 1 + flatSuggestions.length) % flatSuggestions.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              e.stopPropagation()
              commitSuggestion(flatSuggestions[activeSuggestion])
              return
            }
          }
          if (e.key === 'Escape') {
            setShowSuggestions(false)
            return
          }
          if (e.key === 'Enter' && multiline && !e.nativeEvent.isComposing) {
            // A newline character (kept by pre-wrap), not a <div> block the serializer would drop.
            e.preventDefault()
            document.execCommand('insertText', false, '\n')
          }
          e.stopPropagation()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={() => { setDragOver(false); setDropCaret(null) }}
        onDrop={handleDrop}
        data-drop-zone="expression"
        data-placeholder={placeholder ?? ''}
        className={cn(
          'variable-input-editor w-full rounded-md border px-2 py-1 text-[10px] font-mono outline-none',
          dataPicker && 'pr-6',
          multiline && 'whitespace-pre-wrap break-words',
          'focus:ring-1',
          dragOver && 'ring-2',
          className,
        )}
        style={{
          minHeight: multiline ? `${Math.max(1, rows) * 16 + 8}px` : '24px',
          lineHeight: '16px',
          backgroundColor: dragOver ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)',
          borderColor: dragOver ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
          color: 'var(--theme-card-text)',
          // @ts-ignore
          '--tw-ring-color': 'var(--theme-primary)',
        }}
      />

      {dataPicker && <DataPickerButton onPick={(expression) => insertRawToken(expression)} />}

      {dragOver && dropCaret && (
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 w-0.5 rounded-full animate-pulse"
          style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height, backgroundColor: 'var(--theme-primary)' }}
        />
      )}
      {dragOver && (
        <span aria-hidden className="pointer-events-none absolute -top-2 right-1 z-10 rounded px-1 text-[9px] font-medium" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
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

      {showSuggestions && Object.keys(groups).length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-48 overflow-y-auto rounded-lg border shadow-lg"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
          }}
        >
          {Object.entries(groups).map(([group, vars]) => (
            <div key={group}>
              <div
                className="px-2 py-1 text-[9px] font-semibold uppercase sticky top-0"
                style={{
                  backgroundColor: 'var(--theme-surface)',
                  color: 'var(--theme-muted-text)',
                }}
              >
                {group}
              </div>
              {vars.map((v) => {
                const isPlain = v.group === 'Status values' || v.group === 'Priority values' || v.group.startsWith('Rows in ')
                const suggestionIndex = flatSuggestions.findIndex((suggestion) => suggestion.group === v.group && suggestion.name === v.name)
                const isActive = suggestionIndex === activeSuggestion
                return (
                  <button
                    key={`${v.group}-${v.name}`}
                    type="button"
                    className="flex items-center w-full px-2 py-1.5 text-[10px] hover:opacity-80 text-left"
                    style={{ backgroundColor: isActive ? 'var(--theme-surface)' : 'var(--theme-card-bg)' }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commitSuggestion({ ...v, isPlain })
                    }}
                    onMouseEnter={() => {
                      if (suggestionIndex >= 0) setActiveSuggestion(suggestionIndex)
                    }}
                  >
                    {!isPlain && (v as any).label ? (
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate font-medium" style={{ color: 'var(--theme-card-text)' }}>{(v as any).label}</span>
                        <code className="font-mono truncate text-[9px]" style={{ color: 'var(--theme-primary-text)' }}>{`{{${v.name}}}`}</code>
                      </span>
                    ) : (
                    <code
                      className="font-mono truncate"
                      style={{ color: isPlain ? 'var(--theme-card-text)' : 'var(--theme-primary-text)' }}
                    >
                      {isPlain ? ((v as any).label ?? v.name) : `{{${v.name}}}`}
                    </code>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
