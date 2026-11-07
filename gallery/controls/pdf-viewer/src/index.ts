/**
 * <ut-pdf-viewer> — shows a PDF inside the form with pdf.js (bundled, no
 * Worker: the worker code runs in the main thread through pdf.js's "fake
 * worker", because the frame's CSP forbids workers; no eval, no network).
 *
 * The PDF shown is the control's own value when uploads are allowed and the
 * person uploaded one, else the first PDF of the `document` context entry (an
 * Attachments field the designer maps), read with request('file', { id }).
 * One page at a time (memory stays low), device-pixel-ratio aware, with the
 * page's text in a visually hidden element for screen readers.
 */
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs'
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { UtControl, css, define, html, nothing, svg, type FileResult, type PropertyValues, type UploadResult } from '../../shared/base'

// The fake worker: pdf.js picks up WorkerMessageHandler from here instead of starting a Worker.
;(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfjsWorker

const UPLOAD_LIMIT = 25 * 1024 * 1024
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3]

interface FileRef { id: string; name: string; size?: number; type?: string }
type Status = 'empty' | 'loading' | 'ready' | 'error'

const I = {
  prev: svg`<path d="m15 18-6-6 6-6"/>`,
  next: svg`<path d="m9 18 6-6-6-6"/>`,
  out: svg`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>`,
  in: svg`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>`,
  fit: svg`<path d="M21 12H3"/><path d="m7 8-4 4 4 4"/><path d="m17 8 4 4-4 4"/>`,
  rotate: svg`<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.7L21 8"/><path d="M21 3v5h-5"/>`,
  upload: svg`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>`,
  file: svg`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
  x: svg`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
}

function asFileRef(v: unknown): FileRef | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name : 'document.pdf',
    size: typeof o.size === 'number' ? o.size : undefined,
    type: typeof o.type === 'string' ? o.type : undefined,
  }
}

function isPdfRef(f: FileRef): boolean {
  if (f.type) return f.type === 'application/pdf' || f.type === 'application/x-pdf'
  return /\.pdf$/i.test(f.name)
}

/** "%PDF-" within the first KB (some files have junk before the header). */
function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024)
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true
  }
  return false
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

function formatSize(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export class UtPdfViewer extends UtControl {
  static properties = {
    status: { state: true }, message: { state: true }, page: { state: true }, pages: { state: true },
    zoom: { state: true }, rotation: { state: true }, renderedScale: { state: true }, pageText: { state: true }, uploading: { state: true },
  }
  static styles = [UtControl.styles, css`
    .frame { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_card); overflow: hidden; }
    :host([invalid]) .frame { border-color: var(--_error); }
    :host([disabled]) .frame { opacity: 0.6; }
    .toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 6px; border-bottom: 1px solid var(--_border); background: var(--_surface); }
    .group { display: inline-flex; align-items: center; gap: 2px; }
    .sep { width: 1px; height: 20px; background: var(--_border); margin: 0 4px; }
    .spacer { flex: 1; }
    .tool { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 32px; height: 32px; padding: 0 6px;
      border-radius: 6px; color: var(--_text); cursor: pointer; font-size: 0.93em; font-weight: 500; }
    .tool:hover:not([disabled]) { background: var(--_card); }
    .tool:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
    .tool[disabled] { opacity: 0.4; cursor: default; }
    .tool.label { padding: 0 10px; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .pageinfo { min-width: 88px; text-align: center; font-variant-numeric: tabular-nums; color: var(--_muted); font-size: 0.93em; }
    .zoominfo { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; color: var(--_muted); font-size: 0.86em; }
    .name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; color: var(--_muted); font-size: 0.86em; padding: 0 6px; }
    .name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .viewer { position: relative; overflow: auto; max-height: 720px; min-height: 160px; background: var(--_surface); outline: none; padding: 12px; }
    .viewer:focus-visible { box-shadow: inset 0 0 0 2px var(--_focus); }
    .sheet { margin: 0 auto; width: max-content; box-shadow: 0 1px 4px rgb(0 0 0 / 0.18); background: #fff; line-height: 0; }
    canvas { display: block; }
    .state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; min-height: 160px; padding: 20px; color: var(--_muted); line-height: 1.45; }
    .state svg { width: 28px; height: 28px; stroke-width: 1.5; }
    .state.error { color: var(--_error); }
    .spinner { width: 24px; height: 24px; border-radius: 50%; border: 3px solid var(--_border); border-top-color: var(--_primary); animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .primary { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: var(--_radius);
      background: var(--_primary); color: var(--_on-primary); font-weight: 600; cursor: pointer; }
    .primary:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .primary[aria-disabled='true'] { opacity: 0.6; cursor: default; }
    input[type='file'] { display: none; }
    @media (max-width: 480px) { .hide-sm { display: none; } .viewer { padding: 6px; } }
  `]

  declare status: Status
  declare message: string
  declare page: number
  declare pages: number
  declare zoom: number | 'fit'
  declare rotation: number
  declare pageText: string
  declare uploading: boolean
  declare renderedScale: number

  private doc: PDFDocumentProxy | null = null
  private loadedKey: string | null = null
  private loadSeq = 0
  private renderTask: RenderTask | null = null
  private renderSeq = 0
  private width = 0
  private resizeObs: ResizeObserver | null = null
  private localBytes = new Map<string, ArrayBuffer>()

  constructor() {
    super()
    this.status = 'empty'
    this.message = ''
    this.page = 1
    this.pages = 0
    this.zoom = 'fit'
    this.rotation = 0
    this.pageText = ''
    this.uploading = false
    this.renderedScale = 1
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.resizeObs?.disconnect()
    this.resizeObs = null
    this.renderTask?.cancel()
    void this.doc?.destroy()
    this.doc = null
    this.loadedKey = null
  }

  // ── source ───────────────────────────────────────────────────────────────

  get allowUpload(): boolean { return this.boolProp('allow_upload', false) }

  /** The own value's file (an upload). */
  get ownFile(): FileRef | null {
    const v = this.value
    const first = Array.isArray(v) ? v[0] : v
    return asFileRef(first)
  }

  /** The first PDF of the mapped Attachments field. */
  get contextFile(): FileRef | null {
    const raw = this.contextValue<unknown>('document')
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    const refs = list.map(asFileRef).filter((f): f is FileRef => !!f)
    return refs.find(isPdfRef) ?? null
  }

  get source(): FileRef | null { return this.ownFile ?? this.contextFile }

  validate(): string | null {
    const v = this.value
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return null
    if (!Array.isArray(v) || v.length > 1 || !asFileRef(v[0])) return 'Upload one PDF'
    return null
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    const src = this.source
    const key = src ? src.id : null
    if (key !== this.loadedKey) void this.load(src)
    if (!this.resizeObs) {
      const viewer = this.renderRoot.querySelector('.viewer')
      if (viewer && typeof ResizeObserver === 'function') {
        this.resizeObs = new ResizeObserver((entries) => {
          const w = Math.floor(entries[0]?.contentRect.width ?? 0)
          if (w && Math.abs(w - this.width) > 2) {
            this.width = w
            if (this.zoom === 'fit' && this.doc) void this.renderPage()
          }
        })
        this.resizeObs.observe(viewer)
      }
    }
    if ((changed.has('page') || changed.has('zoom') || changed.has('rotation')) && this.doc && this.status === 'ready') void this.renderPage()
  }

  private async load(src: FileRef | null) {
    const seq = ++this.loadSeq
    this.loadedKey = src ? src.id : null
    this.renderTask?.cancel()
    const old = this.doc
    this.doc = null
    if (old) void old.destroy()
    this.pages = 0
    this.page = 1
    this.pageText = ''
    if (!src) { this.status = 'empty'; this.message = ''; return }
    this.status = 'loading'
    this.message = ''
    try {
      let bytes = this.localBytes.get(src.id)
      if (!bytes) {
        const result = (await this.request('file', { id: src.id })) as Partial<FileResult> | null
        if (seq !== this.loadSeq) return
        const raw = result?.bytes
        if (!raw || typeof (raw as ArrayBuffer).byteLength !== 'number') throw Object.assign(new Error('The document came back empty.'), { name: 'EmptyFile' })
        bytes = raw instanceof ArrayBuffer ? raw : (raw as Uint8Array).buffer as ArrayBuffer
      }
      // pdf.js takes ownership of (detaches) the buffer: give it a copy.
      const data = new Uint8Array(bytes.slice(0))
      if (!looksLikePdf(data)) throw Object.assign(new Error('not a PDF'), { name: 'InvalidPDFException' })
      const task = pdfjs.getDocument({
        data,
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: false,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true,
        enableXfa: false,
        verbosity: 0,
      })
      const doc = await task.promise
      if (seq !== this.loadSeq) { void doc.destroy(); return }
      this.doc = doc
      this.pages = doc.numPages
      this.page = 1
      this.status = 'ready'
      await this.updateComplete
      await this.renderPage()
    } catch (e) {
      if (seq !== this.loadSeq) return
      const name = errorName(e)
      this.status = 'error'
      this.message = name === 'PasswordException'
        ? 'This PDF is password-protected, so it can’t be shown here.'
        : name === 'InvalidPDFException' || name === 'FormatError'
          ? `“${src.name}” couldn’t be opened: it isn’t a PDF, or the file is damaged.`
          : name === 'EmptyFile'
            ? `“${src.name}” couldn’t be loaded: the file is empty.`
            : `“${src.name}” couldn’t be loaded. Check it is still attached, then try again.`
    }
  }

  private async renderPage() {
    const doc = this.doc
    if (!doc) return
    const seq = ++this.renderSeq
    this.renderTask?.cancel()
    this.renderTask = null
    const n = Math.min(Math.max(1, this.page), doc.numPages)
    try {
      const page = await doc.getPage(n)
      if (seq !== this.renderSeq) return
      const canvas = this.renderRoot.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return
      const base = page.getViewport({ scale: 1, rotation: this.rotation })
      const viewer = this.renderRoot.querySelector('.viewer') as HTMLElement | null
      const pad = viewer ? parseFloat(getComputedStyle(viewer).paddingLeft) * 2 : 24
      const avail = Math.max(120, (this.width || viewer?.clientWidth || 600) - (viewer && this.width ? 0 : pad))
      const scale = this.zoom === 'fit' ? Math.min(4, avail / base.width) : this.zoom
      this.renderedScale = scale
      const viewport = page.getViewport({ scale, rotation: this.rotation })
      const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1))
      // Keep the canvas under ~16 M pixels (mobile Safari's limit).
      const maxPixels = 16_000_000
      const ratio = Math.min(dpr, Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height)))
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      this.renderTask = task
      const textPromise = page.getTextContent().then((tc) => tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim()).catch(() => '')
      await task.promise
      const text = await textPromise
      if (seq !== this.renderSeq) return
      this.pageText = text
      page.cleanup()
    } catch (e) {
      if (errorName(e) === 'RenderingCancelledException' || seq !== this.renderSeq) return
      this.status = 'error'
      this.message = `Page ${n} couldn’t be shown: the file may be damaged.`
    }
  }

  // ── navigation ───────────────────────────────────────────────────────────

  private goTo(n: number) {
    if (!this.pages) return
    const next = Math.min(this.pages, Math.max(1, n))
    if (next !== this.page) {
      this.page = next
      const viewer = this.renderRoot.querySelector('.viewer') as HTMLElement | null
      viewer?.scrollTo?.({ top: 0 })
    }
  }

  private zoomBy(dir: 1 | -1) {
    const cur = this.zoom === 'fit' ? this.renderedScale : this.zoom
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((z) => z < cur - 0.01) ?? ZOOMS[0]
    this.zoom = next
  }

  private onViewerKey(e: KeyboardEvent) {
    if (this.status !== 'ready') return
    const viewer = e.currentTarget as HTMLElement
    const atBottom = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2
    const atTop = viewer.scrollTop <= 1
    let handled = true
    switch (e.key) {
      case 'PageDown': if (atBottom || viewer.scrollHeight <= viewer.clientHeight) this.goTo(this.page + 1); else handled = false; break
      case 'PageUp': if (atTop) this.goTo(this.page - 1); else handled = false; break
      case 'Home': if (e.ctrlKey || e.metaKey || atTop) this.goTo(1); else handled = false; break
      case 'End': if (e.ctrlKey || e.metaKey || atBottom) this.goTo(this.pages); else handled = false; break
      case 'ArrowRight': if (viewer.scrollWidth <= viewer.clientWidth) this.goTo(this.page + 1); else handled = false; break
      case 'ArrowLeft': if (viewer.scrollWidth <= viewer.clientWidth) this.goTo(this.page - 1); else handled = false; break
      case '+': case '=': this.zoomBy(1); break
      case '-': case '_': this.zoomBy(-1); break
      case '0': this.zoom = 'fit'; break
      default: handled = false
    }
    if (handled) e.preventDefault()
  }

  // ── upload ───────────────────────────────────────────────────────────────

  private pick() {
    if (this.locked || !this.allowUpload || this.uploading) return
    ;(this.renderRoot.querySelector('input[type="file"]') as HTMLInputElement | null)?.click()
  }

  private async onFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || this.locked || !this.allowUpload) return
    if (file.size > UPLOAD_LIMIT) { this.status = 'error'; this.message = `“${file.name}” is larger than 25 MB.`; return }
    this.uploading = true
    try {
      const bytes = await file.arrayBuffer()
      if (!looksLikePdf(new Uint8Array(bytes))) {
        this.status = 'error'
        this.message = `“${file.name}” isn’t a PDF. Choose a PDF file.`
        return
      }
      const result = (await this.request('upload', { name: file.name, type: 'application/pdf', bytes: bytes.slice(0) })) as Partial<UploadResult> | null
      const ref = asFileRef(result)
      if (!ref) throw new Error('The upload returned no file')
      this.localBytes.clear()
      this.localBytes.set(ref.id, bytes)
      this.emitChange([{ id: ref.id, name: ref.name, size: typeof ref.size === 'number' ? ref.size : file.size, type: ref.type || 'application/pdf' }])
    } catch {
      this.status = 'error'
      this.message = `“${file.name}” couldn’t be uploaded. Try again.`
      this.loadedKey = '__failed__'
    } finally {
      this.uploading = false
    }
  }

  private removeFile() {
    if (this.locked) return
    this.localBytes.clear()
    this.emitChange(null)
  }

  private onFocusOut(e: FocusEvent) {
    if (!this.renderRoot.contains(e.relatedTarget as Node | null)) this.emitBlur()
  }

  // ── render ───────────────────────────────────────────────────────────────

  private renderState(src: FileRef | null) {
    const canUpload = this.allowUpload && !this.locked
    if (this.status === 'loading' || this.uploading) {
      return html`<div class="state" role="status"><span class="spinner" aria-hidden="true"></span>${this.uploading ? 'Uploading…' : `Loading ${src?.name ?? 'document'}…`}</div>`
    }
    if (this.status === 'error') {
      return html`<div class="state error" role="alert"><svg viewBox="0 0 24 24" aria-hidden="true">${I.file}</svg><span>${this.message}</span>
        ${canUpload ? html`<button type="button" class="primary" @click=${this.pick}><svg viewBox="0 0 24 24" aria-hidden="true">${I.upload}</svg>Choose a PDF</button>` : nothing}</div>`
    }
    return html`<div class="state"><svg viewBox="0 0 24 24" aria-hidden="true">${I.file}</svg>
      <span>${canUpload ? 'No document yet. Choose a PDF to view it here.' : 'No document yet — map an Attachments field in the designer, or allow uploads.'}</span>
      ${canUpload ? html`<button type="button" class="primary" @click=${this.pick}><svg viewBox="0 0 24 24" aria-hidden="true">${I.upload}</svg>Choose a PDF</button>` : nothing}</div>`
  }

  render() {
    const src = this.source
    const ready = this.status === 'ready' && !this.uploading
    const name = this.utLabel || 'Document'
    const desc = this.utDescription
    const canUpload = this.allowUpload && !this.locked
    const own = !!this.ownFile
    const zoomPct = Math.round((this.zoom === 'fit' ? this.renderedScale : this.zoom) * 100)
    return html`
      <div class="frame" @focusout=${this.onFocusOut}>
        ${ready || (src && canUpload) ? html`<div class="toolbar" role="toolbar" aria-label=${`${name}: document controls`}>
          ${ready ? html`
            <span class="group">
              <button type="button" class="tool" aria-label="Previous page" title="Previous page (Page Up)" ?disabled=${this.page <= 1} @click=${() => this.goTo(this.page - 1)}><svg viewBox="0 0 24 24" aria-hidden="true">${I.prev}</svg></button>
              <span class="pageinfo" aria-live="polite">Page ${this.page} of ${this.pages}</span>
              <button type="button" class="tool" aria-label="Next page" title="Next page (Page Down)" ?disabled=${this.page >= this.pages} @click=${() => this.goTo(this.page + 1)}><svg viewBox="0 0 24 24" aria-hidden="true">${I.next}</svg></button>
            </span>
            <span class="sep hide-sm" aria-hidden="true"></span>
            <span class="group">
              <button type="button" class="tool" aria-label="Zoom out" title="Zoom out (−)" ?disabled=${zoomPct <= ZOOMS[0] * 100} @click=${() => this.zoomBy(-1)}><svg viewBox="0 0 24 24" aria-hidden="true">${I.out}</svg></button>
              <span class="zoominfo" aria-hidden="true">${zoomPct}%</span>
              <button type="button" class="tool" aria-label="Zoom in" title="Zoom in (+)" ?disabled=${zoomPct >= ZOOMS[ZOOMS.length - 1] * 100} @click=${() => this.zoomBy(1)}><svg viewBox="0 0 24 24" aria-hidden="true">${I.in}</svg></button>
              <button type="button" class="tool" aria-label="Fit to width" title="Fit to width (0)" aria-pressed=${this.zoom === 'fit' ? 'true' : 'false'} @click=${() => { this.zoom = 'fit' }}><svg viewBox="0 0 24 24" aria-hidden="true">${I.fit}</svg></button>
              <button type="button" class="tool" aria-label="Rotate clockwise" title="Rotate" @click=${() => { this.rotation = (this.rotation + 90) % 360 }}><svg viewBox="0 0 24 24" aria-hidden="true">${I.rotate}</svg></button>
            </span>` : nothing}
          <span class="spacer"></span>
          ${src ? html`<span class="name hide-sm" title=${src.name}><svg viewBox="0 0 24 24" aria-hidden="true">${I.file}</svg><span>${src.name}${src.size ? ` · ${formatSize(src.size)}` : ''}</span></span>` : nothing}
          ${canUpload ? html`
            <button type="button" class="tool label" @click=${this.pick} aria-label=${own ? 'Replace the PDF' : 'Choose a PDF'}><svg viewBox="0 0 24 24" aria-hidden="true">${I.upload}</svg><span class="hide-sm">${own ? 'Replace' : 'Choose a PDF'}</span></button>
            ${own ? html`<button type="button" class="tool" @click=${this.removeFile} aria-label="Remove the PDF" title="Remove"><svg viewBox="0 0 24 24" aria-hidden="true">${I.x}</svg></button>` : nothing}` : nothing}
        </div>` : nothing}
        <div class="viewer" role="region" aria-label=${`${name}: ${src ? src.name : 'PDF viewer'}`} aria-describedby=${desc ? 'desc' : nothing}
          tabindex=${ready ? '0' : '-1'} @keydown=${this.onViewerKey}>
          ${ready ? nothing : this.renderState(src)}
          <div class="sheet" ?hidden=${!ready}>
            <canvas role="img" aria-label=${`Page ${this.page} of ${this.pages}, ${src?.name ?? 'document'}`}></canvas>
          </div>
          ${ready ? html`<div class="sr-only">Text of page ${this.page}: ${this.pageText || 'this page has no text (it may be a scanned image).'}</div>` : nothing}
        </div>
        ${canUpload ? html`<input type="file" accept="application/pdf,.pdf" tabindex="-1" aria-hidden="true" @change=${this.onFile} />` : nothing}
      </div>
      ${desc ? html`<span id="desc" class="sr-only">${desc}</span>` : nothing}
    `
  }
}

define('ut-pdf-viewer', UtPdfViewer)
