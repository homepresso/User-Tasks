/**
 * Limits for the media steps. Instance-wide caps come from the environment
 * (self-hosters can raise them); a step can only lower them.
 */

import { MediaLimitError } from './types'

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const MB = 1024 * 1024

export const MEDIA_LIMITS = {
  /** Largest media input (MEDIA_MAX_MB, default 100). */
  get maxInputBytes() { return envNumber('MEDIA_MAX_MB', 100, 1, 2048) * MB },
  /** Longest audio / video accepted (MEDIA_MAX_DURATION_SECONDS, default 2 h). */
  get maxDurationSeconds() { return envNumber('MEDIA_MAX_DURATION_SECONDS', 7200, 10, 86_400) },
  /** In 'auto' run mode, longer media runs in the background (MEDIA_INLINE_MAX_SECONDS, default 300). */
  get inlineMaxSeconds() { return envNumber('MEDIA_INLINE_MAX_SECONDS', 300, 0, 86_400) },
  /** Budget of an inline step (MEDIA_TIMEOUT_SECONDS, default 120). */
  get inlineTimeoutMs() { return envNumber('MEDIA_TIMEOUT_SECONDS', 120, 5, 900) * 1000 },
  /** Budget of a background job, all polls included (MEDIA_JOB_TIMEOUT_SECONDS, default 1 h). */
  get jobTimeoutMs() { return envNumber('MEDIA_JOB_TIMEOUT_SECONDS', 3600, 60, 86_400) * 1000 },
  /** Largest decoded image (MEDIA_MAX_IMAGE_MEGAPIXELS, default 40). */
  get maxImagePixels() { return envNumber('MEDIA_MAX_IMAGE_MEGAPIXELS', 40, 1, 400) * 1_000_000 },
  /** Longest video Redact Video accepts (MEDIA_VIDEO_REDACT_MAX_SECONDS, default 600). */
  get maxRedactVideoSeconds() { return envNumber('MEDIA_VIDEO_REDACT_MAX_SECONDS', 600, 5, 14_400) },
  /** One FFmpeg command (MEDIA_FFMPEG_TIMEOUT_SECONDS, default 600). */
  get ffmpegTimeoutMs() { return envNumber('MEDIA_FFMPEG_TIMEOUT_SECONDS', 600, 5, 7200) * 1000 },
  /** Frames one step analyses at most (video analysis / redaction). */
  maxFrames: 600,
  /** Frames Media Utilities extracts at most. */
  maxExtractFrames: 100,
  /** Characters of text one Text to Speech step sends. */
  maxTtsChars: 20_000,
  /** Characters of a transcript shown in run logs. */
  logPreviewChars: 200,
  /** Findings kept in outputs. */
  maxFindings: 5000,
  /** Per-request provider timeout. */
  providerRequestTimeoutMs: 300_000,
}

/** Reject an input above the instance cap (or a lower per-step cap). */
export function assertMediaSize(size: number, name: string, maxBytes = MEDIA_LIMITS.maxInputBytes): void {
  if (size > maxBytes) {
    throw new MediaLimitError(`"${name}" is too large (${(size / MB).toFixed(1)} MB; at most ${Math.round(maxBytes / MB)} MB — MEDIA_MAX_MB)`)
  }
}

export function assertMediaDuration(seconds: number | undefined, name: string, max = MEDIA_LIMITS.maxDurationSeconds, setting = 'MEDIA_MAX_DURATION_SECONDS'): void {
  if (seconds !== undefined && Number.isFinite(seconds) && seconds > max) {
    throw new MediaLimitError(`"${name}" is ${formatDuration(seconds)} long; at most ${formatDuration(max)} (${setting})`)
  }
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** Run `work` with a deadline; rejects with a clear message when it is passed. */
export async function withMediaTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MediaLimitError(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
