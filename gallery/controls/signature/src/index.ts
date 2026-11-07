/**
 * <ut-signature> — draw a signature with a finger, pen or mouse (or type a
 * name, drawn in a cursive font: the keyboard way to sign), then "Use this
 * signature" uploads a trimmed PNG through the host's Attachments pipeline.
 * Value (type files): `[{ id, name, size, type }]` — one stored PNG — or null.
 * Read-only / an existing value: the stored image, fetched with
 * request('file') and shown through a blob: URL.
 */
import SignaturePad from 'signature_pad'
import { UtControl, css, define, html, nothing, type FileResult, type PropertyValues, type UploadResult } from '../../shared/base'

interface StoredFile { id: string; name: string; size: number; type: string }

const TYPED_FONT = "'Segoe Script', 'Bradley Hand', 'Brush Script MT', 'Snell Roundhand', cursive"
const INK_ON_WHITE = '#1b1916'

function storedFile(value: unknown): StoredFile | null {
  const first = Array.isArray(value) ? value[0] : value
  if (!first || typeof first !== 'object') return null
  const f = first as Record<string, unknown>
  if (typeof f.id !== 'string' || !f.id) return null
  return {
    id: f.id,
    name: typeof f.name === 'string' ? f.name : 'signature.png',
    size: typeof f.size === 'number' ? f.size : 0,
    type: typeof f.type === 'string' ? f.type : 'image/png',
  }
}

export class UtSignature extends UtControl {
  static properties = {
    hasInk: { state: true },
    typing: { state: true },
    typed: { state: true },
    busy: { state: true },
    problem: { state: true },
    imageUrl: { state: true },
    imageState: { state: true },
  }

  static styles = [UtControl.styles, css`
    .wrap { display: grid; gap: 8px; }
    .pad { position: relative; border: 1px solid var(--_border); border-radius: var(--_radius); overflow: hidden; background: var(--_input-bg); }
    .pad.white { background: #ffffff; }
    :host([invalid]) .pad { border-color: var(--_error); box-shadow: 0 0 0 1px var(--_error); }
    canvas { display: block; width: 100%; touch-action: none; cursor: crosshair; }
    canvas:focus-visible { outline: none; }
    .pad:focus-within { border-color: var(--_focus); box-shadow: 0 0 0 1px var(--_focus); }
    .line { position: absolute; left: 16px; right: 16px; bottom: 30px; border-bottom: 1px dashed var(--_line, var(--_border)); pointer-events: none; }
    .prompt { position: absolute; left: 16px; bottom: 8px; font-size: 0.86em; color: var(--_prompt, var(--_muted)); pointer-events: none; user-select: none; }
    .pad.white { --_line: #b9b3a6; --_prompt: #5f5a50; }
    .cross { position: absolute; left: 16px; bottom: 34px; font-size: 18px; line-height: 1; color: var(--_prompt, var(--_muted)); pointer-events: none; }
    .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .spacer { flex: 1 1 auto; }
    .btn { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: var(--_radius);
      border: 1px solid var(--_border); background: var(--_card); color: var(--_text); cursor: pointer; font-size: 0.93em; }
    .btn:hover:not(:disabled) { background: var(--_surface); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .btn.primary { background: var(--_primary); border-color: var(--_primary); color: var(--_on-primary); font-weight: 600; }
    .btn.primary:hover:not(:disabled) { background: var(--_primary); filter: brightness(1.06); }
    .btn svg { width: 16px; height: 16px; flex: none; }
    .link { all: unset; cursor: pointer; color: var(--_primary-text); text-decoration: underline; text-underline-offset: 2px; font-size: 0.93em; min-height: 32px; display: inline-flex; align-items: center; border-radius: 4px; }
    .link:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .typed { display: grid; gap: 4px; }
    .typed label { font-size: 0.93em; color: var(--_muted); }
    input { font: inherit; min-height: 40px; padding: 0 12px; border-radius: var(--_radius); border: 1px solid var(--_border);
      background: var(--_input-bg); color: var(--_input-text); width: 100%; }
    input:focus-visible { outline: 2px solid var(--_focus); outline-offset: 0; border-color: var(--_focus); }
    .saved { display: grid; gap: 8px; }
    .sheet { border: 1px solid var(--_border); border-radius: var(--_radius); padding: 12px; display: flex; align-items: center; justify-content: center; min-height: 96px; background: var(--_input-bg); }
    .sheet.white { background: #ffffff; }
    .sheet img { display: block; max-width: 100%; max-height: var(--_img-h, 140px); object-fit: contain; }
    .status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--_success); }
    .badge svg { width: 16px; height: 16px; }
    .alert { color: var(--_error); font-size: 0.93em; }
    .hint { color: var(--_muted); font-size: 0.86em; }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; border-right-color: currentColor; opacity: 0.6; } }
  `]

  declare hasInk: boolean
  declare typing: boolean
  declare typed: string
  declare busy: boolean
  declare problem: string | null
  declare imageUrl: string | null
  declare imageState: 'idle' | 'loading' | 'ready' | 'error'

  private pad: SignaturePad | null = null
  private padCanvas: HTMLCanvasElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private lastWidth = 0
  private imageFor: string | null = null
  private localImages = new Map<string, Blob>()

  constructor() {
    super()
    this.hasInk = false
    this.typing = false
    this.typed = ''
    this.busy = false
    this.problem = null
    this.imageUrl = null
    this.imageState = 'idle'
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.detachPad()
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl)
    this.imageUrl = null
    this.imageFor = null
  }

  /** Host request (the mixin's typing covers lookup / upload only). */
  private ask(kind: 'upload' | 'file', payload: unknown): Promise<unknown> {
    return (this.request as unknown as (k: string, p: unknown) => Promise<unknown>)(kind, payload)
  }

  private get file(): StoredFile | null { return storedFile(this.value) }
  private get whiteBackground(): boolean { return this.textProp('background', 'white') !== 'transparent' }
  private get padHeight(): number { return Math.round(this.numberProp('height', 180, 100, 480)) }

  private penColor(): string {
    const chosen = this.textProp('pen_color', '')
    if (chosen) return chosen
    // On white paper the ink is dark in either theme; on a transparent pad it follows the theme's text colour.
    if (this.whiteBackground) return INK_ON_WHITE
    const fromTheme = getComputedStyle(this).getPropertyValue('--_text').trim()
    return fromTheme || INK_ON_WHITE
  }

  validate(): string | null {
    if (this.value === null || this.value === undefined) return null
    if (Array.isArray(this.value) && this.value.length === 0) return null
    if (!this.file) return 'The signature could not be read: sign again'
    if (Array.isArray(this.value) && this.value.length > 1) return 'Only one signature is kept'
    return null
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    this.syncPad()
    if (this.pad && (changed.has('theme') || changed.has('props'))) {
      this.pad.penColor = this.penColor()
      if (this.typing) this.drawTyped()
    }
    this.syncImage()
  }

  // ── The drawing pad ──────────────────────────────────────────────────

  private syncPad() {
    const canvas = this.renderRoot.querySelector<HTMLCanvasElement>('canvas.draw')
    if (canvas === this.padCanvas) {
      if (canvas) this.fitCanvas()
      return
    }
    this.detachPad()
    if (!canvas) return
    this.padCanvas = canvas
    this.pad = new SignaturePad(canvas, { penColor: this.penColor(), backgroundColor: 'rgba(0,0,0,0)', minWidth: 0.8, maxWidth: 2.6 })
    this.pad.addEventListener('endStroke', () => {
      this.hasInk = !this.pad!.isEmpty()
      this.problem = null
    })
    if (this.typing) this.pad.off()
    this.lastWidth = 0
    this.fitCanvas()
    this.resizeObserver = new ResizeObserver(() => this.fitCanvas())
    this.resizeObserver.observe(canvas)
  }

  private detachPad() {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.pad?.off()
    this.pad = null
    this.padCanvas = null
  }

  /** Size the bitmap for the CSS size × devicePixelRatio; strokes are kept when the width changes. */
  private fitCanvas() {
    const canvas = this.padCanvas
    const pad = this.pad
    if (!canvas || !pad) return
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const width = canvas.offsetWidth
    const height = this.padHeight
    if (!width) return
    if (width === this.lastWidth && canvas.height === Math.round(height * ratio)) return
    this.lastWidth = width
    const data = pad.toData()
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.getContext('2d')!.scale(ratio, ratio)
    pad.clear()
    if (this.typing) this.drawTyped()
    else if (data.length) pad.fromData(data)
  }

  private drawTyped() {
    const canvas = this.padCanvas
    if (!canvas || !this.pad) return
    this.pad.clear()
    const ctx = canvas.getContext('2d')!
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const w = canvas.width / ratio
    const h = canvas.height / ratio
    const text = this.typed.trim()
    if (!text) { this.hasInk = false; return }
    let size = Math.min(56, h * 0.42)
    ctx.save()
    ctx.fillStyle = this.penColor()
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'
    for (; size > 14; size -= 2) {
      ctx.font = `italic ${size}px ${TYPED_FONT}`
      if (ctx.measureText(text).width <= w - 40) break
    }
    ctx.fillText(text, w / 2, h - 36, w - 40)
    ctx.restore()
    this.hasInk = true
  }

  private clear() {
    if (this.locked) return
    this.pad?.clear()
    this.typed = ''
    this.hasInk = false
    this.problem = null
  }

  private undo() {
    if (this.locked || !this.pad) return
    if (this.typing) { this.clear(); return }
    const data = this.pad.toData()
    data.pop()
    this.pad.fromData(data)
    this.hasInk = !this.pad.isEmpty()
  }

  private toggleTyping() {
    if (this.locked) return
    this.typing = !this.typing
    this.pad?.clear()
    this.typed = ''
    this.hasInk = false
    if (this.typing) {
      this.pad?.off()
      this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('#typed')?.focus())
    } else {
      this.pad?.on()
    }
  }

  private onTyped(e: Event) {
    this.typed = (e.target as HTMLInputElement).value.slice(0, 80)
    this.problem = null
    this.drawTyped()
  }

  // ── Export + upload ──────────────────────────────────────────────────

  /** The pad's ink, trimmed to its bounds plus a margin, on the chosen background. */
  private async exportPng(): Promise<Blob | null> {
    const canvas = this.padCanvas
    if (!canvas) return null
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas
    const pixels = ctx.getImageData(0, 0, width, height).data
    let top = height, left = width, right = -1, bottom = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] > 8) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    if (right < 0) return null
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const margin = Math.round(12 * ratio)
    const cw = right - left + 1
    const ch = bottom - top + 1
    const out = document.createElement('canvas')
    out.width = cw + margin * 2
    out.height = ch + margin * 2
    const octx = out.getContext('2d')!
    if (this.whiteBackground) {
      octx.fillStyle = '#ffffff'
      octx.fillRect(0, 0, out.width, out.height)
    }
    octx.drawImage(canvas, left, top, cw, ch, margin, margin, cw, ch)
    return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'))
  }

  private async useSignature() {
    if (this.locked || this.busy || !this.hasInk) return
    this.busy = true
    this.problem = null
    try {
      const blob = await this.exportPng()
      if (!blob) { this.problem = 'Draw or type your signature first'; return }
      const bytes = await blob.arrayBuffer()
      const result = await this.ask('upload', { name: 'signature.png', type: 'image/png', bytes }) as UploadResult
      if (!result || typeof result.id !== 'string') throw new Error('The upload did not return a file')
      const file: StoredFile = { id: result.id, name: result.name || 'signature.png', size: Number(result.size) || blob.size, type: result.type || 'image/png' }
      this.localImages.set(file.id, blob)
      this.emitChange([file])
      this.pad?.clear()
      this.hasInk = false
      this.typed = ''
      this.typing = false
      this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.again')?.focus())
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : ''
      this.problem = `The signature could not be saved${message ? `: ${message}` : ''}. Try again.`
    } finally {
      this.busy = false
    }
  }

  private signAgain() {
    if (this.locked) return
    this.emitChange(null)
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('canvas.draw')?.focus())
  }

  private onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null
    if (next && this.renderRoot.contains(next)) return
    // Leaving with ink on the pad: keep it (the same as pressing "Use this signature").
    if (!this.locked && !this.file && this.hasInk && !this.busy) void this.useSignature()
    this.emitBlur()
  }

  // ── The stored image ─────────────────────────────────────────────────

  private syncImage() {
    const file = this.file
    const id = file?.id ?? null
    if (id === this.imageFor) return
    this.imageFor = id
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl)
    this.imageUrl = null
    if (!id) { this.imageState = 'idle'; return }
    const local = this.localImages.get(id)
    if (local) {
      this.imageUrl = URL.createObjectURL(local)
      this.imageState = 'ready'
      return
    }
    this.imageState = 'loading'
    this.ask('file', { id }).then((res) => {
      if (this.imageFor !== id) return
      const r = res as FileResult
      if (!r || !(r.bytes instanceof ArrayBuffer)) throw new Error('no bytes')
      this.imageUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.type || 'image/png' }))
      this.imageState = 'ready'
    }).catch(() => {
      if (this.imageFor === id) this.imageState = 'error'
    })
  }

  // ── Render ───────────────────────────────────────────────────────────

  private renderSaved(file: StoredFile) {
    const white = this.whiteBackground
    return html`
      <div class="saved">
        <div class="sheet ${white ? 'white' : ''}" style="--_img-h:${Math.max(80, this.padHeight - 40)}px">
          ${this.imageState === 'ready' && this.imageUrl
            ? html`<img src=${this.imageUrl} alt=${this.utLabel ? `Signature: ${this.utLabel}` : 'Signature'}>`
            : this.imageState === 'error'
              ? html`<span class="hint">${file.name}: the signature image could not be loaded.</span>`
              : html`<span class="hint" role="status"><span class="spin" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:6px"></span>Loading the signature…</span>`}
        </div>
        <div class="status">
          <span class="badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            Signed
          </span>
          ${this.locked ? nothing : html`<span class="spacer"></span>
            <button type="button" class="btn again" @click=${this.signAgain}>Sign again</button>`}
        </div>
      </div>`
  }

  private renderPad() {
    const white = this.whiteBackground
    const height = this.padHeight
    const prompt = this.textProp('prompt', 'Sign above')
    const allowTyped = this.boolProp('allow_typed', true)
    const name = `${this.utLabel || 'Signature'}${this.required ? ' (required)' : ''}`
    const canvasLabel = this.typing
      ? `${name}: typed signature${this.typed.trim() ? `, ${this.typed.trim()}` : ''}`
      : `${name}: drawing area. Sign with a mouse, pen or finger${this.hasInk ? '. Signature drawn' : ''}${allowTyped ? ', or choose Type your name instead' : ''}`
    return html`
      <div class="pad ${white ? 'white' : ''}">
        <canvas class="draw" style="height:${height}px" role="img" aria-label=${canvasLabel}
          aria-describedby=${this.utDescription ? 'desc' : nothing} tabindex=${this.typing ? -1 : 0}></canvas>
        <span class="cross" aria-hidden="true">×</span>
        <span class="line" aria-hidden="true"></span>
        <span class="prompt" aria-hidden="true">${prompt}</span>
      </div>
      ${this.typing ? html`
        <div class="typed">
          <label for="typed">Type your full name</label>
          <input id="typed" type="text" autocomplete="name" maxlength="80" .value=${this.typed} @input=${this.onTyped}
            aria-required=${this.required ? 'true' : 'false'} aria-invalid=${this.invalid ? 'true' : 'false'}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void this.useSignature() } }}>
        </div>` : nothing}
      <div class="bar">
        <button type="button" class="btn" @click=${this.undo} ?disabled=${!this.hasInk || this.busy} aria-label="Undo the last stroke">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
          Undo
        </button>
        <button type="button" class="btn" @click=${this.clear} ?disabled=${!this.hasInk || this.busy} aria-label="Clear the signature">Clear</button>
        ${allowTyped ? html`<button type="button" class="link" @click=${this.toggleTyping} ?disabled=${this.busy}>${this.typing ? 'Draw instead' : 'Type your name instead'}</button>` : nothing}
        <span class="spacer"></span>
        <button type="button" class="btn primary" @click=${this.useSignature} ?disabled=${!this.hasInk || this.busy}>
          ${this.busy ? html`<span class="spin" aria-hidden="true"></span>Saving…` : 'Use this signature'}
        </button>
      </div>`
  }

  render() {
    const file = this.file
    let body
    if (file) body = this.renderSaved(file)
    else if (this.locked) body = html`<div class="sheet"><span class="hint">Not signed</span></div>`
    else body = this.renderPad()
    return html`
      <div class="wrap" role="group" aria-label=${this.utLabel || 'Signature'} aria-describedby=${this.utDescription ? 'desc' : nothing}
        @focusout=${this.onFocusOut}>
        ${body}
        <div role="alert" class="alert">${this.problem ?? ''}</div>
      </div>
      ${this.utDescription ? html`<span id="desc" class="sr-only">${this.utDescription}</span>` : nothing}
    `
  }
}

define('ut-signature', UtSignature)
