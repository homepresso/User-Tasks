'use client'

/**
 * The email template HTML code editor (CodeMirror 6). Loaded on demand with
 * next/dynamic (ssr: false) from the template editor, so CodeMirror's code
 * is only fetched when someone opens a template.
 *
 * Syntax highlighting, line numbers, auto-closing tags, bracket matching,
 * find / replace (⌘F / Ctrl+F), undo history, `{{` variable autocomplete
 * (lib/email-editor/completions.ts) and lint diagnostics (unclosed tags,
 * client compatibility, unknown variables — lib/email-editor/lint.ts).
 * Dropping a variable from the variables panel inserts it where it lands.
 */

import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { forceLinting, linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { tags as t } from '@lezer/highlight'
import { variableCompletions } from '@/lib/email-editor/completions'
import type { EmailLintIssue } from '@/lib/email-editor/lint'
import type { EmailVariableDeclaration } from '@/lib/email-editor/variables'

export interface HtmlCodeEditorApi {
  /** Insert text at the cursor (replacing the selection) and focus. */
  insert(text: string): void
  /** Replace the whole document (one undoable change). */
  replaceAll(text: string): void
  focus(): void
  /** Move the cursor to an offset and scroll it into view. */
  reveal(from: number, to?: number): void
}

export interface HtmlCodeEditorProps {
  value: string
  onChange(value: string): void
  onReady?(api: HtmlCodeEditorApi): void
  /** Lint results for the current value (computed by the parent, debounced). */
  issues: EmailLintIssue[]
  declarations: EmailVariableDeclaration[]
  extraVariables?: Array<{ name: string; label?: string; group?: string }>
  placeholder?: string
  readOnly?: boolean
  className?: string
}

const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket], color: 'var(--color-primary-text)' },
  { tag: t.attributeName, color: 'var(--color-accent-text, var(--color-fg))' },
  { tag: [t.attributeValue, t.string], color: 'var(--color-success)' },
  { tag: t.comment, color: 'var(--color-fg-subtle)', fontStyle: 'italic' },
  { tag: [t.propertyName], color: 'var(--color-primary-text)' },
  { tag: [t.number, t.unit, t.color], color: 'var(--color-warning)' },
  { tag: [t.keyword, t.definitionKeyword, t.modifier], color: 'var(--color-accent-text, var(--color-primary-text))' },
  { tag: t.processingInstruction, color: 'var(--color-fg-muted)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--color-panel)', color: 'var(--color-fg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--color-fg)' },
  '.cm-gutters': { backgroundColor: 'var(--color-subtle)', color: 'var(--color-fg-subtle)', borderRight: '1px solid var(--color-border-subtle)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 22%, transparent) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--color-elevated)', color: 'var(--color-fg)', border: '1px solid var(--color-border)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--color-primary-wash)', color: 'var(--color-fg)' },
  '.cm-completionDetail': { color: 'var(--color-fg-muted)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-panels': { backgroundColor: 'var(--color-subtle)', color: 'var(--color-fg)' },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--color-muted)', border: 'none', color: 'var(--color-fg-muted)' },
})

export default function HtmlCodeEditor({ value, onChange, onReady, issues, declarations, extraVariables, placeholder, readOnly, className }: HtmlCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Latest props for the extensions (created once).
  const latest = useRef({ onChange, issues, declarations, extraVariables })
  latest.current = { onChange, issues, declarations, extraVariables }
  const readOnlyCompartment = useRef(new Compartment())

  useEffect(() => {
    if (!host.current) return
    const completionSource = (context: CompletionContext) => {
      const line = context.state.doc.lineAt(context.pos)
      const before = line.text.slice(0, context.pos - line.from)
      const result = variableCompletions(before, latest.current.declarations, latest.current.extraVariables)
      if (!result) return null
      return {
        from: line.from + result.from,
        options: result.options.map((o) => ({ label: o.label, detail: o.detail, info: o.info, apply: o.apply, section: o.section, type: 'variable' })),
        validFor: /^[\w.\-[\]]*$/,
      }
    }
    const lintSource = (): Diagnostic[] => {
      const length = view.current?.state.doc.length ?? 0
      return latest.current.issues
        .filter((i) => i.rule !== 'gmail-clip' && i.rule !== 'gmail-clip-near')
        .map((i) => ({ from: Math.min(i.from, length), to: Math.min(Math.max(i.to, i.from), length), severity: i.severity, message: i.message, source: i.rule }))
    }
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        html({ autoCloseTags: true, matchClosingTags: true }),
        syntaxHighlighting(highlight),
        autocompletion({ override: [completionSource], activateOnTyping: true, icons: false }),
        linter(lintSource, { delay: 400 }),
        lintGutter(),
        EditorView.lineWrapping,
        theme,
        readOnlyCompartment.current.of(EditorState.readOnly.of(!!readOnly)),
        cmPlaceholder(placeholder ?? ''),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString())
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'HTML body', 'data-email-html-editor': '' }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    onReady?.({
      insert(text) {
        const sel = v.state.selection.main
        v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, scrollIntoView: true })
        v.focus()
      },
      replaceAll(text) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
      },
      focus() { v.focus() },
      reveal(from, to) {
        const len = v.state.doc.length
        v.dispatch({ selection: { anchor: Math.min(from, len), head: Math.min(to ?? from, len) }, scrollIntoView: true })
        v.focus()
      },
    })
    return () => { v.destroy(); view.current = null }
    // Created once; value / readOnly changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External value changes (starter, Design tab, format) — not our own typing.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(!!readOnly)) })
  }, [readOnly])

  // Re-run the linter when the parent's issues change.
  useEffect(() => {
    const v = view.current
    if (!v) return
    forceLinting(v)
  }, [issues])

  return <div ref={host} className={className} data-email-code-editor="" />
}
