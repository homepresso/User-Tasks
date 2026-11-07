/**
 * <ut-rich-text> — a small rich-text editor: a contenteditable textbox with
 * an ARIA toolbar (roving tab stop, aria-pressed toggles). Formatting uses
 * document.execCommand where the browser supports it (feature-detected; the
 * text still edits without it). Everything the control emits, renders or
 * inserts (a paste, a drop, a stored value) goes through the allowlist
 * sanitiser in ./sanitize. Value: { html, text } or null when empty.
 */
import { UtControl, css, define, html, nothing, svg, type PropertyValues } from '../../shared/base'
import { plainTextOf, safeHref, sanitizeHtmlToFragment, sanitizeNode, serialise } from './sanitize'

const HTML_LIMIT = 100_000

type Cmd = 'bold' | 'italic' | 'underline' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'link' | 'clear' | 'undo' | 'redo'
interface Tool { cmd: Cmd; label: string; keys?: string; icon: ReturnType<typeof svg> | string; toggle?: boolean; basic?: boolean }

const I = {
  bold: svg`<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>`,
  italic: svg`<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>`,
  underline: svg`<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>`,
  ul: svg`<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>`,
  ol: svg`<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>`,
  quote: svg`<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>`,
  link: svg`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  clear: svg`<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/>`,
  undo: svg`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>`,
  redo: svg`<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>`,
}

const TOOLS: Array<Tool | 'sep'> = [
  { cmd: 'bold', label: 'Bold', keys: 'Control+B', icon: I.bold, toggle: true, basic: true },
  { cmd: 'italic', label: 'Italic', keys: 'Control+I', icon: I.italic, toggle: true, basic: true },
  { cmd: 'underline', label: 'Underline', keys: 'Control+U', icon: I.underline, toggle: true, basic: true },
  'sep',
  { cmd: 'h2', label: 'Heading', icon: 'H2', toggle: true },
  { cmd: 'h3', label: 'Subheading', icon: 'H3', toggle: true },
  'sep',
  { cmd: 'ul', label: 'Bulleted list', icon: I.ul, toggle: true, basic: true },
  { cmd: 'ol', label: 'Numbered list', icon: I.ol, toggle: true, basic: true },
  { cmd: 'quote', label: 'Quote', icon: I.quote, toggle: true },
  { cmd: 'link', label: 'Link', keys: 'Control+K', icon: I.link, toggle: true, basic: true },
  'sep',
  { cmd: 'clear', label: 'Clear formatting', icon: I.clear },
  { cmd: 'undo', label: 'Undo', keys: 'Control+Z', icon: I.undo, basic: true },
  { cmd: 'redo', label: 'Redo', keys: 'Control+Shift+Z', icon: I.redo, basic: true },
]

type Active = Partial<Record<Cmd, boolean>>

function canExec(): boolean {
  try {
    return typeof document.execCommand === 'function' && (typeof document.queryCommandSupported !== 'function' || document.queryCommandSupported('bold'))
  } catch {
    return false
  }
}

/** Pull { html, text } out of an unknown value (a stored value may be a bare string). */
function readValue(v: unknown): { html: string; text: string } | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return { html: v, text: '' }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const h = typeof o.html === 'string' ? o.html : ''
    const t = typeof o.text === 'string' ? o.text : ''
    if (!h && t) {
      // Text only: escape by building text nodes, one paragraph per line.
      const frag = document.createDocumentFragment()
      for (const line of t.split('\n')) { const p = document.createElement('p'); p.textContent = line; if (!line) p.appendChild(document.createElement('br')); frag.appendChild(p) }
      return { html: serialise(frag), text: t }
    }
    return { html: h, text: t }
  }
  return null
}

export class UtRichText extends UtControl {
  static properties = {
    active: { state: true }, focusIndex: { state: true }, linkOpen: { state: true }, linkError: { state: true },
    linkDraft: { state: true }, linkExisting: { state: true }, empty: { state: true }, count: { state: true },
  }
  static styles = [UtControl.styles, css`
    .box { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_input-bg); color: var(--_input-text); overflow: hidden; }
    .box:focus-within { border-color: var(--_focus); box-shadow: 0 0 0 1px var(--_focus); }
    :host([invalid]) .box { border-color: var(--_error); }
    :host([invalid]) .box:focus-within { box-shadow: 0 0 0 1px var(--_error); }
    :host([disabled]) .box { opacity: 0.6; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 4px; border-bottom: 1px solid var(--_border); background: var(--_surface); }
    .tool { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 6px;
      border-radius: 6px; color: var(--_muted); cursor: pointer; font-weight: 700; font-size: 0.86em; letter-spacing: 0.02em; }
    .tool svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .tool:hover { background: var(--_card); color: var(--_text); }
    .tool[aria-pressed='true'] { background: var(--_primary-light); color: var(--_primary-text); box-shadow: inset 0 0 0 1px var(--_primary); }
    .tool:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
    .tool[aria-disabled='true'] { opacity: 0.45; cursor: default; }
    .sep { width: 1px; height: 20px; margin: 0 4px; background: var(--_border); }
    .linkbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px; border-bottom: 1px solid var(--_border); background: var(--_card); }
    .linkbar input { flex: 1 1 180px; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--_border); border-radius: 6px;
      background: var(--_input-bg); color: var(--_input-text); font: inherit; }
    .linkbar input:focus-visible { outline: 2px solid var(--_focus); outline-offset: 0; }
    .linkbar input[aria-invalid='true'] { border-color: var(--_error); }
    .btn { all: unset; box-sizing: border-box; height: 32px; padding: 0 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.93em;
      display: inline-flex; align-items: center; border: 1px solid var(--_border); color: var(--_text); background: var(--_card); }
    .btn.primary { background: var(--_primary); border-color: var(--_primary); color: var(--_on-primary); }
    .btn:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .linkerr { flex-basis: 100%; color: var(--_error); font-size: 0.86em; }
    .editor-wrap { position: relative; }
    .editor { padding: 10px 12px; outline: none; overflow-wrap: anywhere; word-break: break-word; overflow-y: auto; max-height: 640px; }
    .placeholder { position: absolute; top: 10px; left: 12px; right: 12px; color: var(--_muted); pointer-events: none; }
    .editor > :first-child { margin-top: 0; }
    .editor > :last-child { margin-bottom: 0; }
    .editor p { margin: 0 0 0.6em; }
    .editor h2 { font-size: 1.3em; line-height: 1.3; margin: 0.8em 0 0.4em; }
    .editor h3 { font-size: 1.12em; line-height: 1.3; margin: 0.7em 0 0.35em; }
    .editor ul, .editor ol { margin: 0 0 0.6em; padding-left: 1.5em; }
    .editor blockquote { margin: 0 0 0.6em; padding: 2px 0 2px 12px; border-left: 3px solid var(--_border); color: var(--_muted); }
    .editor a { color: var(--_primary-text); text-decoration: underline; }
    .footer { display: flex; justify-content: flex-end; padding: 2px 10px 6px; font-size: 0.82em; color: var(--_muted); font-variant-numeric: tabular-nums; }
    .footer.near { color: var(--_text); font-weight: 600; }
    .footer.over { color: var(--_error); font-weight: 600; }
    .readonly { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_surface); }
    .empty-ro { color: var(--_muted); font-style: italic; padding: 10px 12px; }
  `]

  declare active: Active
  declare focusIndex: number
  declare linkOpen: boolean
  declare linkError: string
  declare linkDraft: string
  declare linkExisting: boolean
  declare empty: boolean
  declare count: number

  /** The html we last emitted or rendered (to tell host echoes from new values). */
  private shownHtml: string | null = null
  /**
   * Recent html we emitted while typing. The host echoes every change back
   * asynchronously, so an echo of an earlier keystroke can arrive after newer
   * text was typed: it is ours and stale, not a new value — re-rendering it
   * would drop the newer text and move the caret. The host may hand it back
   * re-serialised (a saved draft), so the plain text is compared too.
   */
  private recentEmits: Array<{ html: string; text: string }> = []
  private savedRange: Range | null = null
  private exec = canExec()
  private onSelectionChange = () => this.trackSelection()

  constructor() {
    super()
    this.active = {}
    this.focusIndex = 0
    this.linkOpen = false
    this.linkError = ''
    this.linkDraft = ''
    this.linkExisting = false
    this.empty = true
    this.count = 0
  }

  connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('selectionchange', this.onSelectionChange)
  }

  disconnectedCallback(): void {
    document.removeEventListener('selectionchange', this.onSelectionChange)
    super.disconnectedCallback()
  }

  get maxLength(): number { return Math.round(this.numberProp('max_length', 5000, 1, 100000)) }
  get tools(): Tool[] {
    const basic = this.textProp('toolbar', 'full') === 'basic'
    return TOOLS.filter((t): t is Tool => t !== 'sep' && (!basic || !!t.basic))
  }
  get editor(): HTMLElement | null { return this.renderRoot.querySelector('.editor') }

  validate(): string | null {
    const v = readValue(this.value)
    if (!v) return null
    if (v.text.length > this.maxLength) return `Shorten the text to ${this.maxLength} characters`
    if (v.html.length > HTML_LIMIT) return 'The formatted text is too long: remove some text or formatting'
    return null
  }

  // ── content sync ─────────────────────────────────────────────────────────

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    const ed = this.editor
    if (!ed) return
    const v = readValue(this.value)
    const html = v?.html ?? ''
    if (html !== this.shownHtml && ed.dataset.filled === '1' && this.recentEmits.some((e) => e.html === html || (e.text === (v?.text ?? '') && e.text !== ''))) return
    if (html !== this.shownHtml || ed.dataset.filled !== '1') {
      // A value from the host (initial, or changed elsewhere): render it sanitised.
      const frag = sanitizeHtmlToFragment(html)
      ed.replaceChildren(frag)
      ed.dataset.filled = '1'
      this.shownHtml = html
      this.refreshCounts()
    }
  }

  private refreshCounts() {
    const ed = this.editor
    if (!ed) return
    const text = plainTextOf(sanitizeNode(ed))
    const empty = !text.trim()
    if (empty !== this.empty) this.empty = empty
    if (text.length !== this.count) this.count = text.length
  }

  /** Read the editor, sanitise, emit. */
  private emitFromEditor() {
    const ed = this.editor
    if (!ed || this.locked) return
    const frag = sanitizeNode(ed)
    const text = plainTextOf(frag)
    const out = text.trim() || frag.querySelector('li') ? { html: serialise(frag), text } : null
    this.shownHtml = out?.html ?? ''
    this.recentEmits = [...this.recentEmits.slice(-199), { html: this.shownHtml, text }]
    this.empty = !text.trim()
    this.count = text.length
    const prev = readValue(this.value)
    if (prev && out && prev.html === out.html && prev.text === out.text) return
    if (!prev && !out) return
    this.emitChange(out)
  }

  // ── selection ────────────────────────────────────────────────────────────

  private selection(): Selection | null {
    const root = this.renderRoot as ShadowRoot & { getSelection?: () => Selection | null }
    try { return root.getSelection?.() ?? document.getSelection() } catch { return document.getSelection() }
  }

  private rangeInEditor(): Range | null {
    const sel = this.selection()
    const ed = this.editor
    if (!sel || !ed || !sel.rangeCount) return null
    const r = sel.getRangeAt(0)
    return ed.contains(r.commonAncestorContainer) ? r : null
  }

  private trackSelection() {
    if (this.locked) return
    const r = this.rangeInEditor()
    if (!r) return
    this.savedRange = r.cloneRange()
    this.active = this.computeActive(r)
  }

  private ancestors(node: Node | null): string[] {
    const ed = this.editor
    const out: string[] = []
    let n: Node | null = node
    while (n && n !== ed) {
      if (n.nodeType === 1) out.push((n as Element).localName)
      n = n.parentNode
    }
    return out
  }

  private computeActive(r: Range): Active {
    const names = this.ancestors(r.startContainer)
    const has = (...tags: string[]) => tags.some((t) => names.includes(t))
    const nearestList = names.find((n) => n === 'ul' || n === 'ol')
    return {
      bold: has('b', 'strong'), italic: has('i', 'em'), underline: has('u'),
      h2: has('h2'), h3: has('h3'), ul: nearestList === 'ul', ol: nearestList === 'ol',
      quote: has('blockquote'), link: has('a'),
    }
  }

  private linkAt(r: Range | null): HTMLAnchorElement | null {
    let n: Node | null = r?.startContainer ?? null
    const ed = this.editor
    while (n && n !== ed) {
      if (n.nodeType === 1 && (n as Element).localName === 'a') return n as HTMLAnchorElement
      n = n.parentNode
    }
    return null
  }

  /** Focus the editor and put the caret / selection back where it was. */
  private restore(): boolean {
    const ed = this.editor
    if (!ed) return false
    ed.focus({ preventScroll: true })
    const sel = this.selection()
    if (this.savedRange && sel && ed.contains(this.savedRange.commonAncestorContainer)) {
      try { sel.removeAllRanges(); sel.addRange(this.savedRange) } catch { /* ignore */ }
    }
    try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* ignore */ }
    return true
  }

  private run(command: string, arg?: string): boolean {
    if (!this.exec) return false
    try { return document.execCommand(command, false, arg) } catch { return false }
  }

  // ── commands ─────────────────────────────────────────────────────────────

  private apply(cmd: Cmd) {
    if (this.locked) return
    if (cmd === 'link') { this.openLink(); return }
    this.restore()
    const a = this.active
    switch (cmd) {
      case 'bold': case 'italic': case 'underline': this.run(cmd); break
      case 'h2': case 'h3': this.run('formatBlock', a[cmd] ? 'p' : cmd); break
      case 'quote': this.run('formatBlock', a.quote ? 'p' : 'blockquote'); break
      case 'ul': this.run('insertUnorderedList'); break
      case 'ol': this.run('insertOrderedList'); break
      case 'clear':
        this.run('removeFormat')
        this.run('unlink')
        if (a.h2 || a.h3 || a.quote) this.run('formatBlock', 'p')
        break
      case 'undo': case 'redo': this.run(cmd); break
    }
    this.trackSelection()
    this.emitFromEditor()
  }

  private openLink() {
    if (this.locked) return
    const r = this.rangeInEditor() ?? this.savedRange
    if (r) this.savedRange = r.cloneRange()
    const existing = this.linkAt(r)
    this.linkExisting = !!existing
    this.linkDraft = existing?.getAttribute('href') ?? ''
    this.linkError = ''
    this.linkOpen = true
    this.updateComplete.then(() => (this.renderRoot.querySelector('.linkbar input') as HTMLInputElement | null)?.focus())
  }

  private closeLink(refocus = true) {
    this.linkOpen = false
    this.linkError = ''
    if (refocus) this.updateComplete.then(() => this.restore())
  }

  private normaliseUrl(raw: string): string | null {
    const s = raw.trim()
    if (!s) return null
    if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return safeHref(`mailto:${s}`)
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return safeHref(s)
    return safeHref(`https://${s.replace(/^\/+/, '')}`)
  }

  private applyLink() {
    const url = this.normaliseUrl(this.linkDraft)
    if (!url) {
      this.linkError = 'Enter a web address (https://…) or an email address'
      return
    }
    this.closeLink(false)
    this.updateComplete.then(() => {
      this.restore()
      const r = this.rangeInEditor()
      const existing = this.linkAt(r)
      if (existing) {
        existing.setAttribute('href', url)
      } else if (r && !r.collapsed) {
        if (!this.run('createLink', url)) this.wrapLink(r, url)
      } else {
        // Nothing selected: insert the address as the link text.
        const a = document.createElement('a')
        a.setAttribute('href', url)
        a.textContent = url.replace(/^mailto:/, '')
        if (!this.run('insertHTML', a.outerHTML) && r) { r.insertNode(a); r.setStartAfter(a); r.collapse(true) }
      }
      this.trackSelection()
      this.emitFromEditor()
    })
  }

  /** createLink fallback: wrap the selected text in <a> by hand. */
  private wrapLink(r: Range, url: string) {
    const a = document.createElement('a')
    a.setAttribute('href', url)
    try { a.appendChild(r.extractContents()); r.insertNode(a) } catch { /* ignore */ }
  }

  private removeLink() {
    this.closeLink(false)
    this.updateComplete.then(() => {
      this.restore()
      const r = this.rangeInEditor()
      const a = this.linkAt(r)
      if (a) {
        if (!this.run('unlink') || a.isConnected) {
          a.replaceWith(...Array.from(a.childNodes))
        }
      }
      this.trackSelection()
      this.emitFromEditor()
    })
  }

  private onLinkKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); this.applyLink() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeLink() }
  }

  // ── editor events ────────────────────────────────────────────────────────

  private onEditorKey(e: KeyboardEvent) {
    if (this.locked) return
    const mod = e.ctrlKey || e.metaKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    const map: Record<string, Cmd> = { b: 'bold', i: 'italic', u: 'underline' }
    if (map[k] && !e.shiftKey) {
      if (this.tools.some((t) => t.cmd === map[k])) { e.preventDefault(); this.apply(map[k]) }
      return
    }
    if (k === 'k') { e.preventDefault(); this.openLink(); return }
    if (k === 'z' || k === 'y') {
      e.preventDefault()
      this.apply(k === 'y' || e.shiftKey ? 'redo' : 'undo')
    }
  }

  private onInput() {
    if (this.locked) return
    this.emitFromEditor()
  }

  private insertSanitised(dt: DataTransfer | null) {
    if (!dt) return
    const htmlIn = dt.getData('text/html')
    const textIn = dt.getData('text/plain')
    this.restore()
    if (htmlIn) {
      const clean = serialise(sanitizeHtmlToFragment(htmlIn))
      if (clean && this.run('insertHTML', clean)) return
      const r = this.rangeInEditor()
      if (r) { r.deleteContents(); r.insertNode(sanitizeHtmlToFragment(htmlIn)); r.collapse(false) }
      return
    }
    if (textIn && !this.run('insertText', textIn)) {
      const r = this.rangeInEditor()
      if (r) { r.deleteContents(); const t = document.createTextNode(textIn); r.insertNode(t); r.setStartAfter(t); r.collapse(true) }
    }
  }

  private onPaste(e: ClipboardEvent) {
    e.preventDefault()
    if (this.locked) return
    this.insertSanitised(e.clipboardData)
    this.emitFromEditor()
  }

  private onDrop(e: DragEvent) {
    e.preventDefault()
    if (this.locked) return
    // Move the caret to the drop point when the browser can tell us where it is.
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (r && this.editor?.contains(r.startContainer)) this.savedRange = r
    this.insertSanitised(e.dataTransfer)
    this.emitFromEditor()
  }

  private onFocusOut(e: FocusEvent) {
    if (!this.renderRoot.contains(e.relatedTarget as Node | null)) {
      if (this.linkOpen) this.closeLink(false)
      this.emitBlur()
    }
  }

  // ── toolbar keyboard (roving tab stop) ───────────────────────────────────

  private onToolbarKey(e: KeyboardEvent) {
    const n = this.tools.length
    let i = this.focusIndex
    switch (e.key) {
      case 'ArrowRight': i = (i + 1) % n; break
      case 'ArrowLeft': i = (i - 1 + n) % n; break
      case 'Home': i = 0; break
      case 'End': i = n - 1; break
      default: return
    }
    e.preventDefault()
    this.focusIndex = i
    this.updateComplete.then(() => (this.renderRoot.querySelectorAll('.tool')[i] as HTMLElement | undefined)?.focus())
  }

  // ── render ───────────────────────────────────────────────────────────────

  private renderCounter() {
    const max = this.maxLength
    const count = this.count
    const near = count >= max * 0.9
    const over = count > max
    const left = max - count
    const live = over ? `Over the ${max} character limit` : near ? `About ${Math.max(0, Math.ceil(left / 10) * 10)} characters left` : ''
    return html`
      <div class="footer ${over ? 'over' : near ? 'near' : ''}" aria-hidden="true">${count} / ${max}</div>
      <span class="sr-only" aria-live="polite">${live}</span>
    `
  }

  render() {
    const desc = this.utDescription
    const name = this.utLabel || 'Text'
    if (this.locked) {
      const v = readValue(this.value)
      return html`
        <div class="readonly ${this.disabled ? 'box' : ''}">
          <div class="editor" role="textbox" aria-multiline="true" aria-readonly="true" aria-disabled=${this.disabled ? 'true' : nothing}
            aria-label=${name} aria-describedby=${desc ? 'desc' : nothing} tabindex=${this.disabled ? '-1' : '0'} ?hidden=${!v}></div>
          ${!v ? html`<div class="empty-ro">No text</div>` : nothing}
        </div>
        ${desc ? html`<span id="desc" class="sr-only">${desc}</span>` : nothing}
      `
    }
    const tools = this.tools
    const basic = this.textProp('toolbar', 'full') === 'basic'
    const minHeight = Math.round(this.numberProp('min_height', 160, 60, 1200))
    const placeholder = this.textProp('placeholder')
    const focusIndex = Math.min(this.focusIndex, tools.length - 1)
    let toolIndex = -1
    return html`
      <div class="box" @focusout=${this.onFocusOut}>
        ${this.exec ? html`<div class="toolbar" role="toolbar" aria-label=${`${name} formatting`} aria-controls="editor" @keydown=${this.onToolbarKey}>
          ${TOOLS.filter((t) => t === 'sep' ? !basic : !basic || t.basic).map((t, k, list) => {
            if (t === 'sep') return k > 0 && k < list.length - 1 ? html`<span class="sep" aria-hidden="true"></span>` : nothing
            toolIndex++
            const idx = toolIndex
            return html`<button type="button" class="tool" tabindex=${idx === focusIndex ? '0' : '-1'}
              aria-label=${t.label} title=${t.keys ? `${t.label} (${t.keys.replace('Control', 'Ctrl')})` : t.label}
              aria-keyshortcuts=${t.keys ?? nothing}
              aria-pressed=${t.toggle ? (this.active[t.cmd] ? 'true' : 'false') : nothing}
              aria-expanded=${t.cmd === 'link' ? (this.linkOpen ? 'true' : 'false') : nothing}
              @mousedown=${(e: Event) => e.preventDefault()}
              @focus=${() => { this.focusIndex = idx }}
              @click=${() => { this.focusIndex = idx; this.apply(t.cmd) }}>
              ${typeof t.icon === 'string' ? t.icon : html`<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>`}
            </button>`
          })}
        </div>` : nothing}
        ${this.linkOpen ? html`<div class="linkbar" role="group" aria-label="Link" @keydown=${this.onLinkKey}>
            <input type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com or name@example.com"
              aria-label="Link address" .value=${this.linkDraft} aria-invalid=${this.linkError ? 'true' : 'false'}
              aria-describedby=${this.linkError ? 'linkerr' : nothing}
              @input=${(e: Event) => { this.linkDraft = (e.target as HTMLInputElement).value; this.linkError = '' }} />
            <button type="button" class="btn primary" @click=${() => this.applyLink()}>${this.linkExisting ? 'Update' : 'Add link'}</button>
            ${this.linkExisting ? html`<button type="button" class="btn" @click=${() => this.removeLink()}>Remove link</button>` : nothing}
            <button type="button" class="btn" @click=${() => this.closeLink()}>Cancel</button>
            ${this.linkError ? html`<span id="linkerr" class="linkerr" role="alert">${this.linkError}</span>` : nothing}
          </div>` : nothing}
        <div class="editor-wrap">
          ${this.empty && placeholder ? html`<span class="placeholder" aria-hidden="true">${placeholder}</span>` : nothing}
          <div id="editor" class="editor" contenteditable="true" role="textbox" aria-multiline="true"
            aria-label=${name} aria-describedby=${desc ? 'desc' : nothing} aria-placeholder=${placeholder || nothing}
            aria-required=${this.required ? 'true' : 'false'} aria-invalid=${this.invalid ? 'true' : 'false'}
            spellcheck="true" style=${`min-height:${minHeight}px`}
            @input=${this.onInput} @keydown=${this.onEditorKey} @paste=${this.onPaste} @drop=${this.onDrop}
            @focus=${() => { try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* ignore */ } }}
            @keyup=${() => this.trackSelection()} @mouseup=${() => this.trackSelection()}></div>
        </div>
        ${this.renderCounter()}
      </div>
      ${desc ? html`<span id="desc" class="sr-only">${desc}</span>` : nothing}
    `
  }
}

define('ut-rich-text', UtRichText)
