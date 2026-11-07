/** Minimal typings for the parts of Leaflet 1.9.4 (ESM build) this control uses. */
declare module 'leaflet/dist/leaflet-src.esm.js' {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  export interface LatLng { lat: number; lng: number }
  export interface Coords { x: number; y: number; z: number }
  export interface LeafletEvent { type: string; target: any; latlng?: LatLng; tile?: HTMLElement; coords?: Coords; error?: unknown; originalEvent?: Event }
  export interface Evented {
    on(type: string, fn: (e: LeafletEvent) => void, ctx?: unknown): this
    off(type?: string, fn?: (e: LeafletEvent) => void, ctx?: unknown): this
  }
  export interface LeafletMap extends Evented {
    setView(center: [number, number] | LatLng, zoom?: number, options?: { animate?: boolean }): this
    getCenter(): LatLng
    getZoom(): number
    setZoom(zoom: number, options?: { animate?: boolean }): this
    invalidateSize(options?: boolean | { animate?: boolean }): this
    remove(): this
    stop(): this
    getContainer(): HTMLElement
    addLayer(layer: unknown): this
    removeLayer(layer: unknown): this
    hasLayer(layer: unknown): boolean
    dragging: { enable(): void; disable(): void }
    keyboard: { enable(): void; disable(): void }
  }
  export interface LeafletMarker extends Evented {
    setLatLng(latlng: [number, number] | LatLng): this
    getLatLng(): LatLng
    addTo(map: LeafletMap): this
    remove(): this
    dragging?: { enable(): void; disable(): void }
  }
  export interface GridLayerInstance extends Evented {
    addTo(map: LeafletMap): this
    remove(): this
    options: Record<string, any>
  }
  export const GridLayer: {
    extend(props: Record<string, unknown>): new (options?: Record<string, unknown>) => GridLayerInstance
    prototype: Record<string, any>
  }
  export function map(el: HTMLElement, options?: Record<string, unknown>): LeafletMap
  export function marker(latlng: [number, number], options?: Record<string, unknown>): LeafletMarker
  export function divIcon(options: Record<string, unknown>): unknown
  export const DomEvent: { stopPropagation(e: Event): void; disableClickPropagation(el: HTMLElement): void }
}
