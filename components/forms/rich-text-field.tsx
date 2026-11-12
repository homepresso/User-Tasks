'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Code, Heading3, Heading4, Italic, Link2, List, ListOrdered, Quote, RemoveFormatting, Strikethrough, Underline, type LucideIcon } from 'lucide-react'
import { safeLinkHref } from '@/lib/html-sanitize'
import { richTextMaxLength, richTextPlainText, sanitizeRichText, type RichTextConfig } from '@/lib/forms/rich-text'
import { controlClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Rich text (lib/forms/rich-text.ts): a small contentEditable editor with
 * an ARIA toolbar (one tab stop, arrow keys move between buttons; each
 * button's pressed state follows the selection). Bold / italic / underline
 * also by Ctrl/Cmd+B / I / U, a link by Ctrl/Cmd+K. Pasted content is
 * sanitised before it is inserted; what is reported is sanitised again (the
 * server sanitises the submission once more — the browser is never trusted).
 */

type Command = {
  key: string
  label: string
  icon: LucideIcon
  /** document.queryCommandState name / the current block — for aria-pressed. */
  state?: string
  block?: string
  full?: boolean
  shortcut?: string
}

/** The toolbar: `key` is the editing command (or a block / action) runCommand performs. */
const COMMANDS: Command[] = [
  { key: 'bold', label: 'Bold', icon: Bold, state: 'bold', shortcut: 'Ctrl+B' },
  { key: 'italic', label: 'Italic', icon: Italic, state: 'italic', shortcut: 'Ctrl+I' },
  { key: 'underline', label: 'Underline', icon: Underline, state: 'underline', shortcut: 'Ctrl+U' },
  { key: 'strikeThrough', label: 'Strikethrough', icon: Strikethrough, state: 'strikeThrough', full: true },
  { key: 'insertUnorderedList', label: 'Bulleted list', icon: List, state: 'insertUnorderedList' },
  { key: 'insertOrderedList', label: 'Numbered list', icon: ListOrdered, state: 'insertOrderedList' },
  { key: 'h3', label: 'Heading', icon: Heading3, block: 'h3', full: true },
  { key: 'h4', label: 'Subheading', icon: Heading4, block: 'h4', full: true },
  { key: 'blockquote', label: 'Quote', icon: Quote, block: 'blockquote', full: true },
  { key: 'code', label: 'Code', icon: Code, state: 'code', full: true },
  { key: 'link', label: 'Link', icon: Link2, shortcut: 'Ctrl+K' },
  { key: 'clear', label: 'Clear formatting', icon: RemoveFormatting },
]

/** Styles of the stored HTML (the task description styles: lists, quotes, code, links). */
export const RICH_TEXT_CLASS = 'task-description text-sm text-fg'

function exec(command: string, value?: string) {
  // execCommand: still the only cross-browser editing API for contentEditable.
  document.execCommand(command, false, value)
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function RichTextField({ value, onChange, id, labelledBy, describedBy, invalid, disabled, readOnly, config, placeholder, required }: {
  value: unknown
  onChange: (html: string) => void
  id: string
  labelledBy?: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  /** Read only by a rule: shown, focusable and selectable, not editable. */
  readOnly?: boolean
  config?: RichTextConfig
  placeholder?: string
  required?: boolean
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const emitted = useRef<string | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [active, setActive] = useState<Record<string, boolean>>({})
  // Characters of text (the reported value is the editor's sanitised HTML).
  const length = richTextPlainText(value).length
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const editable = !disabled && !readOnly
  const max = richTextMaxLength(config)
  const full = config?.toolbar === 'full'

  // The stored value → the editor (on mount and when it changes from outside: a rule, a reset, a draft).
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const html = typeof value === 'string' ? value : ''
    if (html === emitted.current) return
    el.innerHTML = sanitizeRichText(html)
    emitted.current = html
  }, [value])

  const report = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const html = sanitizeRichText(el.innerHTML)
    emitted.current = html
    onChange(html)
  }, [onChange])

  const refreshState = useCallback(() => {
    const el = editorRef.current
    const selection = typeof document !== 'undefined' ? document.getSelection() : null
    if (!el || !selection?.anchorNode || !el.contains(selection.anchorNode)) return
    let block = ''
    for (let node: Node | null = selection.anchorNode; node && node !== el; node = node.parentNode) {
      if (node instanceof HTMLElement && /^(H3|H4|BLOCKQUOTE)$/.test(node.tagName)) { block = node.tagName.toLowerCase(); break }
    }
    let code = false
    for (let node: Node | null = selection.anchorNode; node && node !== el; node = node.parentNode) if (node instanceof HTMLElement && node.tagName === 'CODE') code = true
    const q = (name: string) => { try { return document.queryCommandState(name) } catch { return false } }
    setActive({
      bold: q('bold'), italic: q('italic'), underline: q('underline'), strikeThrough: q('strikeThrough'),
      insertUnorderedList: q('insertUnorderedList'), insertOrderedList: q('insertOrderedList'),
      h3: block === 'h3', h4: block === 'h4', blockquote: block === 'blockquote', code,
    })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', refreshState)
    return () => document.removeEventListener('selectionchange', refreshState)
  }, [refreshState])

  const focusEditor = () => editorRef.current?.focus()
  // Typing starts in a paragraph (not loose text in the editor), and Enter makes paragraphs, not divs.
  const startParagraph = () => {
    try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* older browsers */ }
    const el = editorRef.current
    if (!el || !editable || el.innerHTML.trim()) return
    el.innerHTML = '<p><br></p>'
    const range = document.createRange()
    range.setStart(el.firstChild!, 0)
    range.collapse(true)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  const act = (fn: () => void) => {
    if (!editable) return
    focusEditor()
    fn()
    report()
    refreshState()
  }
  const toggleBlock = (tag: string) => act(() => exec('formatBlock', active[tag] ? 'p' : tag))

  const openLink = () => {
    if (!editable) return
    const selection = document.getSelection()
    savedRange.current = selection && selection.rangeCount && editorRef.current?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null
    let href = ''
    for (let node: Node | null = selection?.anchorNode ?? null; node && node !== editorRef.current; node = node.parentNode) {
      if (node instanceof HTMLAnchorElement) { href = node.getAttribute('href') ?? ''; break }
    }
    setLinkUrl(href)
    setLinkError(null)
    setLinkOpen(true)
  }
  const restoreSelection = () => {
    focusEditor()
    const range = savedRange.current
    if (!range) return
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  const applyLink = () => {
    const raw = linkUrl.trim()
    const href = safeLinkHref(/^[^\s@:/]+@[^\s@]+\.[^\s@]+$/.test(raw) ? `mailto:${raw}` : raw)
    if (!href) { setLinkError('Use an https:// address or an e-mail address'); return }
    restoreSelection()
    const selection = document.getSelection()
    if (selection && selection.isCollapsed) exec('insertHTML', `<a href="${escape(href).replace(/"/g, '&quot;')}">${escape(raw)}</a>`)
    else exec('createLink', href)
    setLinkOpen(false)
    report()
  }
  const removeLink = () => {
    restoreSelection()
    exec('unlink')
    setLinkOpen(false)
    report()
  }

  const runCommand = (key: string) => {
    switch (key) {
      case 'bold': case 'italic': case 'underline': case 'strikeThrough': case 'insertUnorderedList': case 'insertOrderedList':
        return act(() => exec(key))
      case 'h3': case 'h4': case 'blockquote':
        return toggleBlock(key)
      case 'code':
        return act(() => {
          const text = document.getSelection()?.toString() ?? ''
          if (text) exec('insertHTML', `<code>${escape(text)}</code>`)
        })
      case 'link':
        return openLink()
      case 'clear':
        return act(() => { exec('removeFormat'); exec('unlink'); exec('formatBlock', 'p') })
    }
  }
  const commands = full ? COMMANDS : COMMANDS.filter((c) => !c.full)

  const onToolbarKey = (e: React.KeyboardEvent) => {
    const last = commands.length - 1
    const next = e.key === 'ArrowRight' ? Math.min(focusIndex + 1, last) : e.key === 'ArrowLeft' ? Math.max(focusIndex - 1, 0) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (next === null) return
    e.preventDefault()
    setFocusIndex(next)
    const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
    buttons[next]?.focus()
  }

  const onEditorKey = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); openLink() }
    else if (['b', 'i', 'u'].includes(e.key.toLowerCase())) { requestAnimationFrame(() => { report(); refreshState() }) }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    if (!editable) return
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    exec('insertHTML', html ? sanitizeRichText(html) : sanitizeRichText(text))
    report()
  }

  const empty = length === 0
  const over = length > max
  const counterId = `${id}-count`

  return (
    <div className={cn(controlClass, 'h-auto p-0 focus-within:border-primary', invalid && 'border-danger', readOnly && 'border-dashed bg-subtle', disabled && 'bg-subtle opacity-60')} data-rich-text>
      {!readOnly && (
        <div role="toolbar" aria-label="Formatting" aria-controls={id} onKeyDown={onToolbarKey}
          className="flex flex-wrap items-center gap-0.5 border-b border-border px-1 py-1">
          {commands.map((c, i) => {
            const pressed = c.state ? Boolean(active[c.state]) : c.block ? Boolean(active[c.block]) : undefined
            const Icon = c.icon
            return (
              <button key={c.key} type="button" tabIndex={i === focusIndex ? 0 : -1} aria-label={c.label} title={c.shortcut ? `${c.label} (${c.shortcut})` : c.label}
                aria-pressed={c.key === 'link' || c.key === 'clear' ? undefined : pressed} aria-keyshortcuts={c.shortcut?.replace('Ctrl', 'Control')}
                disabled={!editable}
                onMouseDown={(e) => e.preventDefault()}
                onFocus={() => setFocusIndex(i)}
                onClick={() => runCommand(c.key)}
                className={cn('inline-flex size-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50 sm:size-8',
                  pressed && 'bg-primary-wash text-primary-text')}>
                <Icon size={15} aria-hidden />
              </button>
            )
          })}
        </div>
      )}
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5" role="group" aria-label="Link">
          <label htmlFor={`${id}-link`} className="text-2xs font-medium text-fg-muted">Link address</label>
          <input id={`${id}-link`} type="url" inputMode="url" autoFocus value={linkUrl} placeholder="https://… or name@example.com"
            aria-invalid={Boolean(linkError) || undefined} aria-describedby={linkError ? `${id}-link-error` : undefined}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } else if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false); restoreSelection() } }}
            className={cn(controlClass, 'h-8 min-w-0 flex-1 basis-40 px-2 text-xs')} />
          <button type="button" onClick={applyLink} className="h-8 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-fg">Apply</button>
          <button type="button" onClick={removeLink} className="h-8 rounded-md border border-border px-2.5 text-xs text-fg">Remove link</button>
          <button type="button" onClick={() => { setLinkOpen(false); restoreSelection() }} className="h-8 rounded-md px-2 text-xs text-fg-muted">Cancel</button>
          {linkError && <p id={`${id}-link-error`} role="alert" className="w-full text-2xs text-danger">{linkError}</p>}
        </div>
      )}
      <div className="relative">
        {empty && placeholder && <span aria-hidden className="pointer-events-none absolute left-3 top-2 text-sm text-fg-subtle">{placeholder}</span>}
        <div
          ref={editorRef}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={labelledBy}
          aria-describedby={[describedBy, counterId].filter(Boolean).join(' ')}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          aria-readonly={readOnly || undefined}
          aria-disabled={disabled || undefined}
          aria-placeholder={placeholder}
          tabIndex={disabled ? -1 : 0}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={report}
          onBlur={report}
          onKeyDown={onEditorKey}
          onKeyUp={refreshState}
          onMouseUp={refreshState}
          onPaste={onPaste}
          onFocus={startParagraph}
          className={cn(RICH_TEXT_CLASS, 'min-h-28 max-h-[28rem] overflow-y-auto px-3 py-2 outline-none')}
        />
      </div>
      <p id={counterId} className={cn('border-t border-border px-3 py-1 text-right text-2xs tabular-nums', over ? 'text-danger' : 'text-fg-muted')}>
        <span className="sr-only">Characters: </span>{length.toLocaleString()} / {max.toLocaleString()}
      </p>
    </div>
  )
}

/** Read-only: the stored (sanitised) HTML, sanitised again before it is shown. */
export function RichTextView({ value }: { value: unknown }) {
  const html = sanitizeRichText(value)
  if (!html) return <p className="text-sm text-fg">—</p>
  return <div className={RICH_TEXT_CLASS} data-rich-text-value dangerouslySetInnerHTML={{ __html: html }} />
}
