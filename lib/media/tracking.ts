/**
 * Video redaction over time (pure): detections on sampled frames → regions
 * with a time span, ready for the FFmpeg graph (lib/media/ffmpeg.ts
 * buildVideoRedactFilter).
 *
 * A face seen on the frame at t (frames sampled every `interval` s) is
 * hidden from t − interval to t + interval, so it stays covered while it
 * moves between two samples; the box is padded more than on a still image
 * for the same reason. Detections of the same thing on consecutive samples
 * (overlapping boxes) are joined into one region whose box is their union,
 * as long as that union stays compact (a face crossing the frame becomes
 * several regions rather than one huge box).
 */

import type { Box } from './types'
import { area, clampBox, iou, padBox, toPixels, unionBoxes } from './geometry'
import type { TimedRegion } from './ffmpeg'

export interface FrameDetection {
  /** Seconds. */
  time: number
  box: Box
  /** face, plate, us_ssn, custom, … */
  type: string
}

export interface Track { type: string; box: Box; start: number; end: number; samples: number; /** Largest single detection (growth limit). */ base: number }

export function trackDetections(detections: FrameDetection[], options: { interval: number; duration: number; padding?: number; maxGrowth?: number }): Track[] {
  const interval = Math.max(0.04, options.interval)
  const maxGrowth = options.maxGrowth ?? 2
  const padding = options.padding ?? 15
  const byTime = [...detections].sort((a, b) => a.time - b.time)
  const open: Track[] = []
  const closed: Track[] = []
  for (const d of byTime) {
    const box = padBox(d.box, padding)
    // Tracks not seen for more than one interval are closed.
    for (let i = open.length - 1; i >= 0; i--) {
      if (d.time - (open[i].end - interval) > interval * 1.5) closed.push(...open.splice(i, 1))
    }
    let best: Track | null = null
    let bestScore = 0
    for (const t of open) {
      if (t.type !== d.type) continue
      const score = iou(t.box, box)
      if (score > bestScore) { best = t; bestScore = score }
    }
    const start = Math.max(0, d.time - interval)
    const end = Math.min(options.duration > 0 ? options.duration : Infinity, d.time + interval)
    if (best && bestScore > 0.1) {
      const merged = unionBoxes([best.box, box])!
      const base = Math.max(best.base, area(box))
      if (area(merged) <= base * maxGrowth) {
        best.box = merged
        best.base = base
        best.end = Math.max(best.end, end)
        best.samples++
        continue
      }
      // Moved too far: close the old track, start a new one overlapping in time.
      open.splice(open.indexOf(best), 1)
      closed.push(best)
    }
    open.push({ type: d.type, box, start, end, samples: 1, base: area(box) })
  }
  return [...closed, ...open].sort((a, b) => a.start - b.start)
}

/** Tracks → pixel regions for the filter graph. */
export function tracksToRegions(tracks: Track[], frame: { width: number; height: number }): TimedRegion[] {
  return tracks.flatMap((t) => {
    const b = clampBox(t.box)
    if (!b) return []
    const px = toPixels(b, frame.width, frame.height)
    return px.width > 0 && px.height > 0 ? [{ ...px, start: t.start, end: t.end }] : []
  })
}

/** Sample times for `duration` seconds every `interval` (at most `max`, spreading them out when needed). */
export function sampleTimes(duration: number, interval: number, max: number): { times: number[]; interval: number } {
  if (!(duration > 0)) return { times: [0], interval }
  let step = Math.max(0.2, interval)
  if (Math.ceil(duration / step) > max) step = duration / max
  const times: number[] = []
  for (let t = Math.min(step / 2, duration / 2); t < duration && times.length < max; t += step) times.push(Math.round(t * 1000) / 1000)
  return { times, interval: step }
}
