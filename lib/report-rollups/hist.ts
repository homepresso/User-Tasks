/**
 * Duration histograms of the report rollups (supabase/migrations/20270123100000_report_rollups.sql).
 *
 * public.report_rollup_ms_bucket puts a duration in ms in a log bucket:
 *   bucket 1        < 1 ms
 *   bucket b ≥ 2    [2^((b−2)/4), 2^((b−1)/4)) ms   (four buckets per doubling)
 *   bucket 160      everything from 2^39.5 ms (~24 years) up
 * A histogram is an int[] (1-based in SQL, so index 0 here is bucket 1).
 *
 * Percentiles are percentile_cont (linear interpolation between the two
 * nearest ranks, as the live SQL / the widgets' quantile()) over the bucket
 * midpoints 2^((b−1.5)/4) — each value is replaced by its bucket's
 * geometric midpoint, which is at most 2^(1/8) ≈ 1.0905 times off. So a
 * percentile is within HIST_RELATIVE_ERROR (9.1%) of the exact one, except
 * for values under 1 ms (reported as 0) and over ~24 years.
 */

export const HIST_BUCKETS = 160
/** Worst-case relative error of a histogram percentile (bucket half-width in log space). */
export const HIST_RELATIVE_ERROR = 2 ** (1 / 8) - 1

/** Representative value (ms) of 1-based bucket `b`. */
export function bucketMidpointMs(b: number): number {
  if (b <= 1) return 0
  return 2 ** ((b - 1.5) / 4)
}

/** The bucket SQL would choose (for tests; SQL is the source of truth). */
export function msBucket(ms: number): number {
  if (!Number.isFinite(ms) || ms < 1) return 1
  return Math.min(HIST_BUCKETS, 2 + Math.floor((4 * Math.log(ms)) / Math.LN2))
}

export type Hist = readonly number[]

export function histCount(h: Hist | null | undefined): number {
  let n = 0
  for (const v of h ?? []) n += Number(v) || 0
  return n
}

/** Element-wise sum. */
export function mergeHists(...hists: Array<Hist | null | undefined>): number[] {
  const out: number[] = []
  for (const h of hists) {
    if (!h) continue
    for (let i = 0; i < h.length; i++) out[i] = (out[i] ?? 0) + (Number(h[i]) || 0)
  }
  for (let i = 0; i < out.length; i++) out[i] ??= 0
  return out
}

/** Midpoint (ms) of the k-th smallest value (0-based). */
function valueAtRank(h: Hist, k: number): number {
  let seen = 0
  for (let i = 0; i < h.length; i++) {
    seen += Number(h[i]) || 0
    if (seen > k) return bucketMidpointMs(i + 1)
  }
  return bucketMidpointMs(h.length)
}

/** percentile_cont(q) of the histogram's values (ms); null when empty. */
export function histQuantile(h: Hist | null | undefined, q: number): number | null {
  if (!h) return null
  const n = histCount(h)
  if (n <= 0) return null
  const pos = (n - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = valueAtRank(h, lo)
  const b = hi === lo ? a : valueAtRank(h, hi)
  return a + (b - a) * (pos - lo)
}
