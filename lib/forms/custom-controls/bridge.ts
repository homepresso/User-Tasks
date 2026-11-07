/**
 * The host side of the custom form control bridge: which postMessage events
 * the form accepts from a control's sandboxed frame, and the checks every
 * one of them passes before it can touch the form —
 *
 *   1. source: the event comes from THIS control's iframe window (each frame
 *      has its own channel; a message from another frame, a popup or the
 *      page itself is ignored);
 *   2. origin: a sandboxed frame without allow-same-origin has the opaque
 *      origin, which postMessage reports as the string "null" — anything
 *      else (the app's own origin included) is refused;
 *   3. shape: `ut === BRIDGE_VERSION`, the frame's random channel id, a
 *      known type, and a payload of the right shape and size;
 *   4. capability: a `request` must name a kind the control's manifest
 *      declared AND the host granted.
 *
 * Pure: the React host (components/forms/custom-control-field.tsx) feeds
 * events through acceptFrameMessage and acts on the result.
 */

import { isPlainObject } from '@/lib/utils/guards'
import {
  BRIDGE_LIMITS, BRIDGE_VERSION, CONTROL_REQUEST_KINDS, REQUEST_CAPABILITY,
  type ControlCapability, type ControlRequestKind, type FrameMessage, type HostMessage, type ControlState,
} from './contract'

/** The origin a sandboxed (opaque-origin) frame posts from. */
export const OPAQUE_ORIGIN = 'null'

export interface FrameMessageCheck {
  /** event.source of the message. */
  source: unknown
  /** event.origin of the message. */
  origin: string
  data: unknown
}

export interface FrameExpectation {
  /** The control iframe's contentWindow. */
  frameWindow: unknown
  channel: string
  /** Capabilities this instance may use (manifest ∩ granted). */
  capabilities: readonly ControlCapability[]
  /**
   * Trusted controls rendered inline post from the app's own window; the
   * runtime then passes the app origin here. Sandboxed frames: 'null'.
   */
  origin?: string
}

export type FrameMessageResult =
  | { ok: true; message: FrameMessage }
  | { ok: false; reason: 'source' | 'origin' | 'shape' | 'channel' | 'capability' | 'size'; detail?: string }

function jsonSize(value: unknown): number {
  try { return JSON.stringify(value)?.length ?? 0 } catch { return Infinity }
}

function clampText(value: unknown, max: number = BRIDGE_LIMITS.messageLength): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

/** Validate one message from a control frame. */
export function acceptFrameMessage(event: FrameMessageCheck, expect: FrameExpectation): FrameMessageResult {
  if (!event.source || event.source !== expect.frameWindow) return { ok: false, reason: 'source' }
  if (event.origin !== (expect.origin ?? OPAQUE_ORIGIN)) return { ok: false, reason: 'origin', detail: event.origin }
  const data = event.data
  if (!isPlainObject(data) || data.ut !== BRIDGE_VERSION || typeof data.type !== 'string') return { ok: false, reason: 'shape' }
  if (data.channel !== expect.channel) return { ok: false, reason: 'channel' }
  const base = { ut: BRIDGE_VERSION as 1, channel: expect.channel }
  switch (data.type) {
    case 'hello':
      return { ok: true, message: { ...base, type: 'hello' } }
    case 'ready':
      return { ok: true, message: { ...base, type: 'ready', tag: clampText(data.tag, 100) ?? '', version: clampText(data.version, 64) ?? '' } }
    case 'change':
      if (!('value' in data)) return { ok: false, reason: 'shape' }
      if (jsonSize(data.value) > BRIDGE_LIMITS.valueBytes) return { ok: false, reason: 'size' }
      return { ok: true, message: { ...base, type: 'change', value: data.value === undefined ? null : data.value } }
    case 'blur':
    case 'focus':
      return { ok: true, message: { ...base, type: data.type } }
    case 'validity':
      if (typeof data.valid !== 'boolean') return { ok: false, reason: 'shape' }
      return { ok: true, message: { ...base, type: 'validity', valid: data.valid, ...(clampText(data.message) ? { message: clampText(data.message) } : {}) } }
    case 'resize': {
      const height = typeof data.height === 'number' && Number.isFinite(data.height) ? data.height : NaN
      if (Number.isNaN(height)) return { ok: false, reason: 'shape' }
      return { ok: true, message: { ...base, type: 'resize', height: Math.round(Math.min(BRIDGE_LIMITS.maxHeight, Math.max(0, height))) } }
    }
    case 'focus-exit':
      if (data.direction !== 'forward' && data.direction !== 'backward') return { ok: false, reason: 'shape' }
      return { ok: true, message: { ...base, type: 'focus-exit', direction: data.direction } }
    case 'error':
      return { ok: true, message: { ...base, type: 'error', message: clampText(data.message) ?? 'The control failed to load' } }
    case 'request': {
      const kind = data.kind as ControlRequestKind
      if (!(CONTROL_REQUEST_KINDS as readonly unknown[]).includes(kind)) return { ok: false, reason: 'shape' }
      if (typeof data.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.request_id)) return { ok: false, reason: 'shape' }
      if (!expect.capabilities.includes(REQUEST_CAPABILITY[kind])) return { ok: false, reason: 'capability', detail: kind }
      const payload = data.payload
      if (kind === 'lookup') {
        if (!isPlainObject(payload) || typeof payload.query !== 'string' || payload.query.length > 500) return { ok: false, reason: 'shape' }
        return { ok: true, message: { ...base, type: 'request', request_id: data.request_id, kind, payload: { query: payload.query } } }
      }
      if (kind === 'file') {
        // Which ids are allowed is the host's check (the control's own value and context only).
        if (!isPlainObject(payload) || typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.id)) return { ok: false, reason: 'shape' }
        return { ok: true, message: { ...base, type: 'request', request_id: data.request_id, kind, payload: { id: payload.id } } }
      }
      if (kind === 'tile') {
        const z = isPlainObject(payload) ? payload.z : null
        const x = isPlainObject(payload) ? payload.x : null
        const y = isPlainObject(payload) ? payload.y : null
        const ok = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max
        if (!ok(z, 19) || !ok(x, 2 ** (z as number) - 1) || !ok(y, 2 ** (z as number) - 1)) return { ok: false, reason: 'shape' }
        return { ok: true, message: { ...base, type: 'request', request_id: data.request_id, kind, payload: { z, x, y } } }
      }
            if (kind === 'report') {
        // The report itself is the field's (server-side config); the control only picks a row cap.
        const limit = isPlainObject(payload) && typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? Math.round(Math.min(1000, Math.max(1, payload.limit))) : undefined
        return { ok: true, message: { ...base, type: 'request', request_id: data.request_id, kind, payload: limit ? { limit } : {} } }
      }
      // upload
      if (!isPlainObject(payload) || typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 255) return { ok: false, reason: 'shape' }
      if (!(payload.bytes instanceof ArrayBuffer)) return { ok: false, reason: 'shape' }
      if (payload.bytes.byteLength > BRIDGE_LIMITS.uploadBytes) return { ok: false, reason: 'size' }
      const type = typeof payload.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(payload.type) ? payload.type : 'application/octet-stream'
      return { ok: true, message: { ...base, type: 'request', request_id: data.request_id, kind, payload: { name: payload.name.trim(), type, bytes: payload.bytes } } }
    }
    default:
      return { ok: false, reason: 'shape' }
  }
}

/** A host → frame message (the runtime in the frame validates it too). */
export function hostMessage(channel: string, body: { type: 'init'; state: ControlState } | { type: 'update'; state: Partial<ControlState> } | { type: 'focus'; from: 'start' | 'end' } | { type: 'response'; request_id: string; ok: boolean; result?: unknown; error?: string }): HostMessage {
  return { ut: BRIDGE_VERSION, channel, ...body } as HostMessage
}

/** A random channel id for one control instance. */
export function newChannelId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Height the host gives the frame: what the control reports, inside the manifest's bounds and the host's. */
export function clampFrameHeight(reported: number, size: { min_height?: number; max_height?: number } | undefined): number {
  const min = Math.max(BRIDGE_LIMITS.minHeight, size?.min_height ?? BRIDGE_LIMITS.minHeight)
  const max = Math.min(BRIDGE_LIMITS.maxHeight, size?.max_height ?? BRIDGE_LIMITS.maxHeight)
  return Math.round(Math.min(max, Math.max(min, reported)))
}
