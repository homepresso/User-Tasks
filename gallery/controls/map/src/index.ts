/**
 * <ut-map> — a Leaflet map (OpenStreetMap tiles) that shows the
 * location of another field (the `location` context: an Address value,
 * {lat, lng}, {latitude, longitude}, {lat, lon} or "lat,lng" text) and,
 * with `pick` on, lets people drop a pin (click / tap / keyboard / the
 * coordinate inputs).
 *
 * The frame's CSP only allows data: / blob: images, so tiles are fetched
 * through the host's `tile` service (server-fetched) and shown as blob: URLs (revoked
 * when Leaflet unloads the tile). Until an administrator approves the
 * hosts the fetches fail: the map shows a neutral background, the pin and
 * a note saying which host to approve.
 *
 * Value (json): { lat, lng } or null. Never emitted when `pick` is off.
 */
import leafletCss from 'leaflet/dist/leaflet.css'
import {
  GridLayer, divIcon, map as createMap, marker as createMarker,
  type Coords, type GridLayerInstance, type LeafletEvent, type LeafletMap, type LeafletMarker,
} from 'leaflet/dist/leaflet-src.esm.js'
import { unsafeCSS } from 'lit'
import { UtControl, css, define, html, nothing, uid, type PropertyValues } from '../../shared/base'

interface Point { lat: number; lng: number }

// OpenStreetMap's standard tiles. (CARTO's free basemaps answer "API key required" to requests
// without a known referrer, which a sandboxed frame never sends, so they are not offered.)
type TileStyle = 'osm'

const TILE_HOST: Record<TileStyle, string> = {
  osm: 'tile.openstreetmap.org',
}

function tileUrl(_style: TileStyle, c: Coords, _retina: boolean): string {
  return `https://tile.openstreetmap.org/${c.z}/${c.x}/${c.y}.png`
}

const DEFAULT_CENTER: [number, number] = [20, 0]
const DEFAULT_ZOOM = 2

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** A point from anything a location field may hold, or null. */
export function parsePoint(raw: unknown): Point | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/)
    return m ? valid(Number(m[1]), Number(m[2])) : null
  }
  if (Array.isArray(raw)) return raw.length === 2 ? valid(num(raw[0]), num(raw[1])) : null
  if (typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const lat = num(o.lat ?? o.latitude)
  const lng = num(o.lng ?? o.lon ?? o.long ?? o.longitude)
  if (lat !== null && lng !== null) return valid(lat, lng)
  // Nested: { location: { latitude, longitude } } (Places) or { geometry: { location: { lat, lng } } } (legacy).
  if (o.location && typeof o.location === 'object') return parsePoint(o.location)
  if (o.geometry && typeof o.geometry === 'object') return parsePoint(o.geometry)
  return null
}

function valid(lat: number | null, lng: number | null): Point | null {
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function round(p: Point): Point {
  let lng = p.lng
  while (lng > 180) lng -= 360
  while (lng < -180) lng += 360
  return { lat: Math.round(Math.max(-90, Math.min(90, p.lat)) * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }
}

const key = (p: Point | null) => (p ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : '')

interface TileCallbacks { ok(): void; fail(): void }

interface BlobTile extends HTMLElement { _url?: string; _abort?: AbortController }

/**
 * A GridLayer that loads each tile through the host (`tile` request: the
 * UserTasks server fetches OpenStreetMap tiles, which refuse the frame's
 * referrer-less requests) and shows it through a blob: URL (CSP: img-src
 * data: blob:).
 */
const BlobTileLayer = GridLayer.extend({
  createTile(this: GridLayerInstance, coords: Coords, done: (err: unknown, tile: HTMLElement) => void) {
    const tile = document.createElement('div') as BlobTile
    tile.className = 'ut-tile'
    const opts = this.options as { style: TileStyle; retina: boolean; callbacks: TileCallbacks; load: (c: { z: number; x: number; y: number }) => Promise<Blob> }
    const abort = new AbortController()
    tile._abort = abort
    void tileUrl
    opts.load({ z: coords.z, x: coords.x, y: coords.y })
      .then((blob) => {
        if (abort.signal.aborted) return
        const url = URL.createObjectURL(blob)
        tile._url = url
        const img = document.createElement('img')
        img.alt = ''
        img.setAttribute('role', 'presentation')
        img.draggable = false
        // The decoded image stays on screen after the URL is revoked: nothing leaks.
        img.onload = () => { URL.revokeObjectURL(url); tile._url = undefined; opts.callbacks.ok(); done(null, tile) }
        img.onerror = () => { URL.revokeObjectURL(url); tile._url = undefined; tile.classList.add('ut-tile-failed'); opts.callbacks.fail(); done(new Error('tile image'), tile) }
        img.src = url
        tile.appendChild(img)
      })
      .catch((error) => {
        if (abort.signal.aborted) return
        tile.classList.add('ut-tile-failed')
        opts.callbacks.fail()
        done(error, tile)
      })
    return tile
  },
})

const PIN_HTML = `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true" focusable="false">
  <path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z" fill="var(--_pin)" stroke="var(--_pin-ring)" stroke-width="2"/>
  <circle cx="16" cy="15.5" r="5.5" fill="var(--_pin-ring)"/></svg>`

// Leaflet's CSS without its PNG references (the frame's CSP refuses them; this control uses none of those images).
const LEAFLET_CSS = leafletCss.replace(/url\([^)]*\)/g, 'none')

export class UtMap extends UtControl {
  static properties = {
    tileState: { state: true },
    coordProblem: { state: true },
    announcement: { state: true },
    draftLat: { state: true },
    draftLng: { state: true },
  }

  static styles = [UtControl.styles, unsafeCSS(LEAFLET_CSS), css`
    :host { --_pin: var(--_primary); --_pin-ring: #ffffff; }
    .wrap { display: grid; gap: 8px; }
    .frame { position: relative; border: 1px solid var(--_border); border-radius: var(--_radius); overflow: hidden; background: var(--_surface); }
    :host([invalid]) .frame { border-color: var(--_error); box-shadow: 0 0 0 1px var(--_error); }
    .map { position: absolute; inset: 0; background: var(--_surface); font: inherit; }
    .map:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
    .leaflet-container { font: inherit; background: var(--_surface); }
    .ut-tile { background: var(--_surface); }
    .ut-tile img { display: block; width: 100%; height: 100%; }
    .ut-tile-failed { background:
      linear-gradient(var(--_border) 1px, transparent 1px) 0 0 / 64px 64px,
      linear-gradient(90deg, var(--_border) 1px, transparent 1px) 0 0 / 64px 64px, var(--_surface); opacity: 0.6; }
    .leaflet-bar { border: 1px solid var(--_border) !important; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12) !important; border-radius: var(--_radius) !important; overflow: hidden; }
    .leaflet-bar a { width: 32px !important; height: 32px !important; line-height: 30px !important; background: var(--_card) !important; color: var(--_text) !important; border-bottom-color: var(--_border) !important; }
    .leaflet-bar a:hover { background: var(--_surface) !important; }
    .leaflet-bar a.leaflet-disabled { color: var(--_muted) !important; opacity: 0.6; }
    .leaflet-bar a:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
    :host([data-mode='dark']) .frame.dim .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.88); }
    .ut-pin { background: none; border: 0; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.35)); }
    .ut-dot { background: var(--ut-primary, #2563eb); border: 2px solid #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); }
    .crosshair { position: absolute; left: 50%; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; pointer-events: none; display: none; z-index: 650; color: var(--_text); }
    .frame.pick .map:focus-visible:not([data-pointer]) ~ .crosshair { display: block; }
    .crosshair svg { width: 100%; height: 100%; filter: drop-shadow(0 0 2px var(--_card)); }
    .attrib { position: absolute; right: 0; bottom: 0; z-index: 800; padding: 2px 6px; font-size: 11px; line-height: 1.4;
      background: color-mix(in srgb, var(--_card) 85%, transparent); color: var(--_text); border-top-left-radius: 6px; max-width: 100%; }
    .note { position: absolute; left: 8px; right: 8px; top: 8px; z-index: 800; margin-left: 44px; padding: 6px 10px; font-size: 0.86em;
      border-radius: var(--_radius); background: var(--_card); color: var(--_text); border: 1px solid var(--_border); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); }
    .empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 700; padding: 6px 12px; border-radius: 999px;
      background: var(--_card); color: var(--_muted); border: 1px solid var(--_border); font-size: 0.9em; pointer-events: none; white-space: nowrap; }
    .below { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; }
    fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; min-width: 0; }
    legend { padding: 0; margin-bottom: 4px; font-size: 0.93em; color: var(--_muted); float: left; width: 100%; }
    label { display: grid; gap: 2px; font-size: 0.86em; color: var(--_muted); }
    input { font: inherit; width: 9.5em; min-height: 36px; padding: 0 10px; border-radius: var(--_radius); border: 1px solid var(--_border);
      background: var(--_input-bg); color: var(--_input-text); }
    input[aria-invalid='true'] { border-color: var(--_error); }
    input:focus-visible { outline: 2px solid var(--_focus); outline-offset: 0; border-color: var(--_focus); }
    .btn { min-height: 36px; padding: 0 12px; border-radius: var(--_radius); border: 1px solid var(--_border); background: var(--_card); color: var(--_text); cursor: pointer; }
    .btn:hover:not(:disabled) { background: var(--_surface); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    .coords { font-variant-numeric: tabular-nums; color: var(--_text); }
    .hint { color: var(--_muted); font-size: 0.86em; width: 100%; }
    .problem { color: var(--_error); font-size: 0.86em; width: 100%; }
  `]

  declare tileState: 'loading' | 'ok' | 'blocked'
  declare coordProblem: string
  declare announcement: string
  declare draftLat: string
  declare draftLng: string

  private leaflet: LeafletMap | null = null
  private layer: GridLayerInstance | null = null
  private layerStyle: TileStyle | null = null
  private pin: LeafletMarker | null = null
  private pinKey = ''
  private contextKey: string | null = null
  private selfPick = false
  private tilesOk = 0
  private tilesFailed = 0
  private resizeObserver: ResizeObserver | null = null
  private ids = { desc: uid('map-desc'), hint: uid('map-hint') }

  constructor() {
    super()
    this.tileState = 'loading'
    this.coordProblem = ''
    this.announcement = ''
    this.draftLat = ''
    this.draftLng = ''
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    // Keep the Leaflet map (the shadow DOM survives a re-attach); stop what is in flight.
    // (map.remove() during a zoom / fade animation throws inside Leaflet's timers.)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    for (const tile of this.renderRoot.querySelectorAll<HTMLElement>('.ut-tile') as NodeListOf<BlobTile>) {
      tile._abort?.abort()
      if (tile._url) URL.revokeObjectURL(tile._url)
      tile._url = undefined
    }
    this.leaflet?.stop()
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (this.leaflet) {
      const el = this.leaflet.getContainer()
      this.resizeObserver = new ResizeObserver(() => this.leaflet?.invalidateSize({ animate: false }))
      this.resizeObserver.observe(el)
    }
  }

  private get picking(): boolean { return this.boolProp('pick', false) && !this.locked }
  private get valuePoint(): Point | null { return parsePoint(this.value) }
  private get contextPoint(): Point | null { return parsePoint(this.contextValue('location')) }
  private get zoomLevel(): number { return Math.round(this.numberProp('zoom', 15, 1, 19)) }

  /** The pin on the map: the picked value in pick mode, else the mapped location (or a stored value). */
  private get pinPoint(): Point | null {
    return this.boolProp('pick', false) ? (this.valuePoint ?? this.contextPoint) : (this.contextPoint ?? this.valuePoint)
  }

  private get tileStyle(): TileStyle {
    return 'osm'
  }

  validate(): string | null {
    if (this.value === null || this.value === undefined || this.value === '') return null
    return this.valuePoint ? null : 'The location could not be read'
  }

  // ── Leaflet ──────────────────────────────────────────────────────────

  protected firstUpdated(): void {
    this.ensureMap()
  }

  private ensureMap() {
    if (this.leaflet) return
    const el = this.renderRoot.querySelector<HTMLElement>('.map')
    if (!el) return
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = this.pinPoint
    const m = createMap(el, {
      center: start ? [start.lat, start.lng] : DEFAULT_CENTER,
      zoom: start ? this.zoomLevel : DEFAULT_ZOOM,
      attributionControl: false,
      zoomAnimation: !reduce,
      fadeAnimation: !reduce,
      markerZoomAnimation: !reduce,
      worldCopyJump: true,
      trackResize: false,
      keyboard: true,
      keyboardPanDelta: 80,
      minZoom: 1,
      maxZoom: 19,
    })
    this.leaflet = m
    m.on('click', (e: LeafletEvent) => {
      if (!this.picking || !e.latlng) return
      this.place(e.latlng, false)
    })
    // The crosshair is for keyboard use only: hide it after a pointer press until the next key.
    el.addEventListener('pointerdown', () => { el.dataset.pointer = '1' })
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      delete el.dataset.pointer
      if (!this.picking || e.target !== el) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.place(m.getCenter(), false)
      }
    })
    this.resizeObserver = new ResizeObserver(() => m.invalidateSize({ animate: false }))
    this.resizeObserver.observe(el)
    this.syncTiles()
    this.syncPin()
    this.syncPlaces()
  }

  private syncTiles() {
    const m = this.leaflet
    if (!m) return
    const style = this.tileStyle
    if (style === this.layerStyle && this.layer) return
    this.layer?.remove()
    this.tilesOk = 0
    this.tilesFailed = 0
    this.tileState = 'loading'
    const callbacks: TileCallbacks = {
      ok: () => { this.tilesOk++; if (this.tileState !== 'ok') this.tileState = 'ok' },
      fail: () => { this.tilesFailed++; if (!this.tilesOk && this.tileState !== 'blocked') this.tileState = 'blocked' },
    }
    const layer = new BlobTileLayer({
      style, retina: false, callbacks,
      load: async (c: { z: number; x: number; y: number }) => {
        const tile = await this.request('tile', c) as { type?: string; bytes?: ArrayBuffer }
        if (!(tile?.bytes instanceof ArrayBuffer)) throw new Error('no tile')
        return new Blob([tile.bytes], { type: tile.type || 'image/png' })
      },
      tileSize: 256, maxZoom: 19, minZoom: 1, updateWhenIdle: true, keepBuffer: 1,
    })
    layer.on('tileunload', (e: LeafletEvent) => {
      const tile = e.tile as BlobTile | undefined
      if (!tile) return
      tile._abort?.abort()
      if (tile._url) URL.revokeObjectURL(tile._url)
      tile._url = undefined
    })
    layer.addTo(m)
    this.layer = layer
    this.layerStyle = style
  }

  /** Put the marker where the pin is (re-created when pick mode toggles dragging). */
  private syncPin() {
    const m = this.leaflet
    if (!m) return
    const p = this.pinPoint
    const draggable = this.picking
    const k = key(p)
    const markerKey = `${k}|${draggable}`
    this.pinKey = k
    if (markerKey === this.markerKey) return
    this.markerKey = markerKey
    this.pin?.remove()
    this.pin = null
    if (!p) return
    this.pin = createMarker([p.lat, p.lng], {
      icon: divIcon({ className: 'ut-pin', html: PIN_HTML, iconSize: [32, 42], iconAnchor: [16, 41] }),
      keyboard: false, draggable, autoPanOnFocus: false,
    }).addTo(m)
    this.pin.on('dragend', () => { if (this.pin && this.picking) this.place(this.pin.getLatLng(), false) })
  }

  private markerKey = ''
  private zoomProp: number | null = null
  private places: LeafletMarker[] = []
  private placesKey = ''

  /** The `markers` prop (often bound to a data table or an API by the host): [{ lat, lng, label }] — at most 500. */
  private get markerPoints(): Array<Point & { label?: string }> {
    let raw = this.prop<unknown>('markers', null)
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = null } }
    if (!Array.isArray(raw)) return []
    return raw.slice(0, 500).flatMap((m) => {
      const p = parsePoint(m)
      if (!p) return []
      const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
      const label = [o.label, o.name, o.title].find((v) => typeof v === 'string' && v.trim()) as string | undefined
      return [{ ...p, ...(label ? { label: label.trim().slice(0, 120) } : {}) }]
    })
  }

  /** Draw the markers; with no pin, the map centres on the first one. */
  private syncPlaces() {
    const m = this.leaflet
    if (!m) return
    const points = this.markerPoints
    const k = JSON.stringify(points)
    if (k === this.placesKey) return
    this.placesKey = k
    for (const marker of this.places) marker.remove()
    this.places = points.map((p) => createMarker([p.lat, p.lng], {
      icon: divIcon({ className: 'ut-dot', iconSize: [14, 14], iconAnchor: [7, 7] }),
      keyboard: false, title: p.label ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, alt: p.label ?? '',
    }).addTo(m))
    if (points.length && !this.pinPoint) m.setView([points[0].lat, points[0].lng], this.zoomLevel)
  }

  /** Drop the pin (pick mode): emits the value. */
  private place(p: Point, recenter: boolean) {
    if (!this.picking) return
    const next = round(p)
    this.selfPick = !recenter
    this.coordProblem = ''
    this.announcement = `Pin dropped at ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`
    this.emitChange(next)
    this.requestUpdate()
  }

  private clearPin() {
    if (!this.picking) return
    this.announcement = 'Pin removed'
    this.coordProblem = ''
    this.emitChange(null)
    this.requestUpdate()
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    this.ensureMap()
    const m = this.leaflet
    if (!m) return
    if (changed.has('theme') || changed.has('props')) this.syncTiles()
    if (changed.has('props')) this.syncPlaces()
    // The mapped location changed (e.g. the person chose an address): centre on it; in pick mode it becomes the pin.
    const ck = key(this.contextPoint)
    if (this.contextKey === null) this.contextKey = ck
    else if (ck !== this.contextKey) {
      this.contextKey = ck
      const cp = this.contextPoint
      if (cp) {
        if (this.picking && key(this.valuePoint) !== ck) {
          this.emitChange(round(cp))
          this.announcement = 'The pin moved to the new location'
        }
        m.setView([cp.lat, cp.lng], this.zoomLevel)
      }
    }
    const before = this.pinKey
    const recenter = !this.selfPick
    this.selfPick = false
    this.syncPin()
    const p = this.pinPoint
    if (p && this.pinKey !== before && recenter) m.setView([p.lat, p.lng], this.zoomLevel)
    // The designer changed the zoom.
    const z = this.zoomLevel
    if (this.zoomProp !== null && z !== this.zoomProp && p) m.setView([p.lat, p.lng], z)
    this.zoomProp = z
  }

  // ── Coordinates inputs ───────────────────────────────────────────────

  private onCoordsChange() {
    if (!this.picking) return
    const lat = this.renderRoot.querySelector<HTMLInputElement>('#lat')!.value.trim()
    const lng = this.renderRoot.querySelector<HTMLInputElement>('#lng')!.value.trim()
    if (!lat && !lng) { this.clearPin(); return }
    if (!lat || !lng) { this.coordProblem = 'Enter both the latitude and the longitude'; return }
    const la = Number(lat)
    const ln = Number(lng)
    if (!Number.isFinite(la) || la < -90 || la > 90) { this.coordProblem = 'Latitude must be a number from -90 to 90'; return }
    if (!Number.isFinite(ln) || ln < -180 || ln > 180) { this.coordProblem = 'Longitude must be a number from -180 to 180'; return }
    this.place({ lat: la, lng: ln }, true)
  }

  // ── Render ───────────────────────────────────────────────────────────

  private renderBelow(p: Point | null) {
    if (this.picking) {
      const latBad = /Latitude|both/.test(this.coordProblem)
      const lngBad = /Longitude|both/.test(this.coordProblem)
      return html`
        <div class="below">
          <fieldset>
            <legend>Coordinates</legend>
            <label>Latitude
              <input id="lat" type="number" inputmode="decimal" step="any" min="-90" max="90" .value=${p ? String(p.lat) : ''}
                aria-invalid=${latBad ? 'true' : 'false'} aria-describedby=${this.coordProblem ? this.ids.hint : nothing}
                @change=${this.onCoordsChange} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.onCoordsChange() } }}>
            </label>
            <label>Longitude
              <input id="lng" type="number" inputmode="decimal" step="any" min="-180" max="180" .value=${p ? String(p.lng) : ''}
                aria-invalid=${lngBad ? 'true' : 'false'} aria-describedby=${this.coordProblem ? this.ids.hint : nothing}
                @change=${this.onCoordsChange} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.onCoordsChange() } }}>
            </label>
            <button type="button" class="btn" @click=${this.clearPin} ?disabled=${!this.valuePoint} aria-label="Clear the pin">Clear</button>
          </fieldset>
          ${this.coordProblem
            ? html`<span class="problem" id=${this.ids.hint} role="alert">${this.coordProblem}</span>`
            : html`<span class="hint">Click or tap the map to drop the pin, or focus the map and press Enter to drop it at the centre.</span>`}
        </div>`
    }
    if (!this.boolProp('show_coordinates', true)) return nothing
    return html`<div class="below" style="align-items:baseline"><span class="hint" style="width:auto">Coordinates</span>
      <span class="coords">${p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '—'}</span></div>`
  }

  render() {
    const p = this.pinPoint
    const style = this.tileStyle
    const height = Math.round(this.numberProp('height', 320, 160, 800))
    const name = this.utLabel || 'Map'
    const where = p ? `Pin at ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'No location'
    const help = this.picking ? 'Arrow keys pan, plus and minus zoom, Enter drops the pin at the centre.' : 'Arrow keys pan, plus and minus zoom.'
    return html`
      <div class="wrap" @focusout=${(e: FocusEvent) => { if (!this.renderRoot.contains(e.relatedTarget as Node)) this.emitBlur() }}>
        <div class="frame ${this.picking ? 'pick' : ''} ${this.textProp('tiles', 'auto') === 'auto' ? 'dim' : ''}" style="height:${height}px">
          <div class="map" role="application" aria-roledescription="map" aria-label=${`${name}. ${where}.`}
            aria-describedby=${this.ids.desc}></div>
          <div class="crosshair" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M14 2v8M14 18v8M2 14h8M18 14h8"/><circle cx="14" cy="14" r="2.5"/></svg></div>
          ${!p && !this.markerPoints.length ? html`<div class="empty">${this.picking ? 'Click the map to drop a pin' : 'No location yet'}</div>` : nothing}
          ${this.tileState === 'blocked'
            ? html`<div class="note" role="status">Map tiles are blocked until an administrator approves ${TILE_HOST[style]} (Extensibility → Form controls)</div>`
            : nothing}
          <div class="attrib">© OpenStreetMap contributors</div>
        </div>
        ${this.renderBelow(p)}
      </div>
      <span id=${this.ids.desc} class="sr-only">${help}${this.utDescription ? ` ${this.utDescription}` : ''}${this.markerPoints.length ? ` ${this.markerPoints.length} place${this.markerPoints.length === 1 ? '' : 's'} marked: ${this.markerPoints.slice(0, 20).map((x) => x.label ?? `${x.lat.toFixed(3)}, ${x.lng.toFixed(3)}`).join('; ')}.` : ''}</span>
      <div class="sr-only" aria-live="polite">${this.announcement}</div>
    `
  }
}

define('ut-map', UtMap)
