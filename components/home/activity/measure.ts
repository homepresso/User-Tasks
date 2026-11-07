/**
 * Measurement guards for Home's widgets. Sub-pixel layout (fractional
 * widths on large screens and browser zoom) makes ResizeObserver report
 * values that wobble by a fraction of a pixel; feeding those straight back
 * into the grid makes it re-flow, which re-measures, which wobbles again.
 */

/** Whole pixels, rounded up (a box never reports less than it needs). */
export function wholePx(px: number): number {
  return Number.isFinite(px) && px > 0 ? Math.ceil(px - 0.01) : 0
}

/**
 * The next height to report, or `null` to report nothing: changes within
 * `tolerance` px of the last reported value are ignored, so a measurement
 * that oscillates by a pixel settles after the first pass.
 */
export function nextStableHeight(previous: number | null, measured: number, tolerance = 1): number | null {
  const px = wholePx(measured)
  if (px <= 0) return null
  if (previous !== null && Math.abs(px - previous) <= tolerance) return null
  return px
}
