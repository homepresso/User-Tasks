/**
 * Boxes: normalised (fractions of the image, origin top-left) ↔ pixels,
 * padding, clamping, union, IoU, and boxes given by people / earlier steps
 * (pixels or fractions, several spellings). Pure and client-safe.
 */

import type { Box } from './types'

export interface PixelBox { left: number; top: number; width: number; height: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** Clamp a normalised box to the image; null when nothing is left. */
export function clampBox(box: Box): Box | null {
  const x = clamp01(box.x)
  const y = clamp01(box.y)
  const right = clamp01(box.x + box.width)
  const bottom = clamp01(box.y + box.height)
  if (right - x <= 0 || bottom - y <= 0) return null
  // Unclamped sides keep their exact values (no float noise from right − x).
  const width = x === box.x && right === box.x + box.width ? box.width : right - x
  const height = y === box.y && bottom === box.y + box.height ? box.height : bottom - y
  return { x, y, width, height }
}

/** Grow a box by `percent` of its own size on every side (10 → 10 % each side), clamped. */
export function padBox(box: Box, percent: number): Box {
  const p = Math.max(0, Math.min(100, percent)) / 100
  const dx = box.width * p
  const dy = box.height * p
  return clampBox({ x: box.x - dx, y: box.y - dy, width: box.width + 2 * dx, height: box.height + 2 * dy }) ?? box
}

/** Normalised → pixels (outward rounding so the whole area is covered), within the image. */
export function toPixels(box: Box, width: number, height: number): PixelBox {
  // A tiny tolerance so float noise (0.2 + 0.1) does not add a pixel.
  const EPS = 1e-6
  const left = Math.max(0, Math.floor(box.x * width + EPS))
  const top = Math.max(0, Math.floor(box.y * height + EPS))
  const right = Math.min(width, Math.ceil((box.x + box.width) * width - EPS))
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * height - EPS))
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** Pixels → normalised. */
export function fromPixels(box: PixelBox, width: number, height: number): Box {
  return { x: box.left / width, y: box.top / height, width: box.width / width, height: box.height / height }
}

/** Smallest box containing all. */
export function unionBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x, y, width: right - x, height: bottom - y }
}

export function area(b: Box): number {
  return Math.max(0, b.width) * Math.max(0, b.height)
}

/** Intersection over union (0–1). */
export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = area(a) + area(b) - inter
  return union > 0 ? inter / union : 0
}

/** A polygon of points (pixels or fractions) → its bounding box in the same units. */
export function polygonBounds(points: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!pts.length) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

export interface CustomBox { box: Box; label?: string; start?: number; end?: number }

/**
 * Boxes from config / an earlier step → normalised boxes. Accepted entries:
 *  - { x, y, width, height } fractions (all ≤ 1), or pixels (any > 1);
 *  - { left, top, width, height } pixels (Rekognition-style Left/Top/Width/Height too);
 *  - { box: {…} } / { box_px: {…} } (findings of Analyze / Redact Image);
 *  - [x, y, width, height].
 * Optional label and start / end seconds (video). Invalid entries are dropped.
 */
export function parseCustomBoxes(value: unknown, image: { width: number; height: number }): CustomBox[] {
  let v = value
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    try { v = JSON.parse(t) } catch { return [] }
  }
  const list = Array.isArray(v) ? (v.length === 4 && v.every((n) => typeof n === 'number') ? [v] : v) : v && typeof v === 'object' ? [v] : []
  const out: CustomBox[] = []
  for (const raw of list.slice(0, 1000)) {
    const entry = raw as Record<string, unknown> | number[]
    let candidate: Record<string, unknown> | null = null
    let pixels = false
    if (Array.isArray(entry)) {
      candidate = { x: entry[0], y: entry[1], width: entry[2], height: entry[3] }
    } else if (entry && typeof entry === 'object') {
      if (entry.box_px && typeof entry.box_px === 'object') { candidate = entry.box_px as Record<string, unknown>; pixels = true }
      else if (entry.box && typeof entry.box === 'object') candidate = entry.box as Record<string, unknown>
      else candidate = entry
    }
    if (!candidate) continue
    const left = finite(candidate.left ?? candidate.Left)
    const top = finite(candidate.top ?? candidate.Top)
    const x = finite(candidate.x ?? candidate.X)
    const y = finite(candidate.y ?? candidate.Y)
    const w = finite(candidate.width ?? candidate.Width ?? candidate.w)
    const h = finite(candidate.height ?? candidate.Height ?? candidate.h)
    if (w === null || h === null || w <= 0 || h <= 0) continue
    let box: Box
    if (left !== null && top !== null) {
      // Left/Top: pixels, unless every value is a fraction (Rekognition BoundingBox).
      const fractional = !pixels && [left, top, w, h].every((n) => n >= 0 && n <= 1)
      box = fractional ? { x: left, y: top, width: w, height: h } : fromPixels({ left, top, width: w, height: h }, image.width, image.height)
    } else if (x !== null && y !== null) {
      const fractional = !pixels && [x, y, w, h].every((n) => n >= 0 && n <= 1)
      box = fractional ? { x, y, width: w, height: h } : fromPixels({ left: x, top: y, width: w, height: h }, image.width, image.height)
    } else continue
    const clamped = clampBox(box)
    if (!clamped) continue
    const rec = !Array.isArray(entry) && entry && typeof entry === 'object' ? entry : {}
    const start = finite((rec as Record<string, unknown>).start)
    const end = finite((rec as Record<string, unknown>).end)
    out.push({
      box: clamped,
      ...(typeof (rec as Record<string, unknown>).label === 'string' ? { label: String((rec as Record<string, unknown>).label).slice(0, 100) } : {}),
      ...(start !== null ? { start } : {}),
      ...(end !== null ? { end } : {}),
    })
  }
  return out
}

/** Round a normalised box for outputs (4 decimals). */
export function roundBox(b: Box): Box {
  const r = (n: number) => Math.round(n * 10_000) / 10_000
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) }
}
