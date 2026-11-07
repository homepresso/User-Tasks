/**
 * FFmpeg / ffprobe for the local media operations (server only).
 *
 *  - The binaries are FFMPEG_PATH / FFPROBE_PATH, else `ffmpeg` / `ffprobe`
 *    on PATH (the Docker image installs them: INCLUDE_MEDIA_TOOLS). Vercel has
 *    no FFmpeg (static builds are GPL and too large for a function), so local
 *    operations fail there with a clear message unless FFMPEG_PATH is set.
 *    MEDIA_TOOLS=off turns them off anywhere.
 *  - Every command is an ARGUMENT ARRAY passed to spawn() without a shell;
 *    user input never becomes an argument as text: times and sizes are parsed
 *    into numbers, formats come from allow-lists, and every path is a file
 *    this module named inside its own temp directory.
 *  - Each command has a timeout (MEDIA_FFMPEG_TIMEOUT_SECONDS) and is killed
 *    when it passes it; stderr kept for errors is capped.
 *  - withTempDir() creates a private directory (MEDIA_TMP_DIR or the OS temp
 *    dir) and always deletes it.
 *
 * The builders below are pure (unit-tested): they return the argument list.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MEDIA_LIMITS } from './limits'
import { MediaLimitError, MediaToolUnavailableError } from './types'

/* ── Binaries ──────────────────────────────────────────────────────── */

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
  const ffprobe = process.env.FFPROBE_PATH?.trim() || (process.env.FFMPEG_PATH?.trim() ? path.join(path.dirname(process.env.FFMPEG_PATH.trim()), 'ffprobe') : 'ffprobe')
  return { ffmpeg, ffprobe }
}

/** Why local media tools are off (null = maybe available). */
export function mediaToolsDisabledReason(env: Record<string, string | undefined> = process.env): string | null {
  if (String(env.MEDIA_TOOLS ?? '').toLowerCase() === 'off') return 'local media processing is turned off on this instance (MEDIA_TOOLS=off)'
  if (env.VERCEL && !env.FFMPEG_PATH) return 'this deployment (Vercel) has no FFmpeg. Use the Docker image (it includes FFmpeg) or set FFMPEG_PATH'
  return null
}

let availability: Promise<boolean> | null = null

/** Is FFmpeg installed and runnable? (cached per process) */
export function ffmpegAvailable(): Promise<boolean> {
  if (mediaToolsDisabledReason()) return Promise.resolve(false)
  availability ??= run(ffmpegPaths().ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 30_000 }).then(() => true, () => false)
  return availability
}

/** For tests: forget the cached availability. */
export function resetFfmpegAvailability(): void {
  availability = null
}

/** Throw a clear error when FFmpeg is missing. `what` names the operation ("Trim", "Redact Video"). */
export async function requireFfmpeg(what: string): Promise<void> {
  const reason = mediaToolsDisabledReason()
  if (reason) throw new MediaToolUnavailableError(`${what} needs FFmpeg: ${reason}.`)
  if (!(await ffmpegAvailable())) {
    throw new MediaToolUnavailableError(`${what} needs FFmpeg, which is not installed on this server. Install ffmpeg (the Docker image includes it: INCLUDE_MEDIA_TOOLS=true) or set FFMPEG_PATH.`)
  }
}

/* ── Running ───────────────────────────────────────────────────────── */

export class FfmpegError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message)
    this.name = 'FfmpegError'
  }
}

const STDERR_KEEP = 8_000
const STDOUT_MAX = 16 * 1024 * 1024

interface RunOptions { timeoutMs?: number; signal?: AbortSignal; cwd?: string }

function run(bin: string, args: readonly string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // No shell: arguments are passed as they are, never parsed by a shell.
    const child = spawn(bin, args as string[], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let done = false
    const timeoutMs = options.timeoutMs ?? MEDIA_LIMITS.ffmpegTimeoutMs
    const finish = (error: Error | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const kill = () => { try { child.kill('SIGKILL') } catch { /* gone */ } }
    const timer = setTimeout(() => { kill(); finish(new MediaLimitError(`FFmpeg took longer than ${Math.round(timeoutMs / 1000)} s (MEDIA_FFMPEG_TIMEOUT_SECONDS)`)) }, timeoutMs)
    const onAbort = () => { kill(); finish(new Error('Cancelled')) }
    options.signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > STDOUT_MAX) { kill(); finish(new MediaLimitError('FFmpeg output is too large')); return }
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ENOENT'
        ? new MediaToolUnavailableError(`${path.basename(bin)} is not installed on this server (set FFMPEG_PATH / FFPROBE_PATH, or use the Docker image)`)
        : error)
    })
    child.on('close', (code) => {
      if (code === 0) finish(null)
      else finish(new FfmpegError(`${path.basename(bin)} failed: ${lastErrorLine(stderr)}`, stderr.slice(-STDERR_KEEP)))
    })
  })
}

/** The most useful line of FFmpeg's stderr (temp paths removed). */
export function lastErrorLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const error = [...lines].reverse().find((l) => /error|invalid|no such|not found|does not|unsupported|could not|failed/i.test(l)) ?? lines[lines.length - 1] ?? 'unknown error'
  return error.replace(/\/[^\s'"]*ut-media-[^\s'"/]+\//g, '').slice(0, 300)
}

export async function runFfmpeg(args: readonly string[], options: RunOptions = {}): Promise<void> {
  await run(ffmpegPaths().ffmpeg, args, options)
}

export async function runFfprobe(args: readonly string[], options: RunOptions = {}): Promise<string> {
  return (await run(ffmpegPaths().ffprobe, args, { timeoutMs: 60_000, ...options })).stdout
}

/** A private temp directory, always removed afterwards. */
export async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const base = process.env.MEDIA_TMP_DIR?.trim() || tmpdir()
  const dir = await mkdtemp(path.join(base, 'ut-media-'))
  try {
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/* ── Probe ─────────────────────────────────────────────────────────── */

export interface MediaInfo {
  duration: number | null
  size: number | null
  format: string | null
  bit_rate: number | null
  has_video: boolean
  has_audio: boolean
  video: { codec: string | null; width: number | null; height: number | null; fps: number | null; rotation: number } | null
  audio: { codec: string | null; sample_rate: number | null; channels: number | null } | null
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n
}

function rate(v: unknown): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(String(v ?? ''))
  if (!m) return num(v)
  const d = Number(m[2])
  return d ? Math.round((Number(m[1]) / d) * 1000) / 1000 : null
}

/** ffprobe -show_format -show_streams JSON → MediaInfo. */
export function parseProbe(json: unknown): MediaInfo {
  const data = (json && typeof json === 'object' ? json : {}) as { format?: Record<string, any>; streams?: Array<Record<string, any>> }
  const streams = Array.isArray(data.streams) ? data.streams : []
  // Cover art in audio files is a "video" stream with attached_pic.
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic === 1))
  const a = streams.find((s) => s.codec_type === 'audio')
  const fmt = data.format ?? {}
  const rotationTag = num(v?.tags?.rotate)
  const sideRotation = Array.isArray(v?.side_data_list) ? num(v.side_data_list.find((d: any) => d && d.rotation !== undefined)?.rotation) : null
  const duration = num(fmt.duration) ?? num(v?.duration) ?? num(a?.duration)
  return {
    duration,
    size: num(fmt.size),
    format: typeof fmt.format_name === 'string' ? fmt.format_name.split(',')[0] : null,
    bit_rate: num(fmt.bit_rate),
    has_video: Boolean(v),
    has_audio: Boolean(a),
    video: v ? { codec: v.codec_name ?? null, width: num(v.width), height: num(v.height), fps: rate(v.avg_frame_rate) ?? rate(v.r_frame_rate), rotation: Math.round(((rotationTag ?? sideRotation ?? 0) % 360 + 360) % 360) } : null,
    audio: a ? { codec: a.codec_name ?? null, sample_rate: num(a.sample_rate), channels: num(a.channels) } : null,
  }
}

export async function probeMedia(file: string): Promise<MediaInfo> {
  const out = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  try {
    return parseProbe(JSON.parse(out))
  } catch {
    throw new FfmpegError('ffprobe returned unreadable output', '')
  }
}

/* ── Inputs to builders ────────────────────────────────────────────── */

/** "90", 90, "1:30", "00:01:30.5" → seconds. Throws on anything else (never passed through as text). */
export function parseTime(value: unknown, label = 'Time'): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) return value
    throw new MediaLimitError(`${label} must be a number of seconds or hh:mm:ss`)
  }
  const s = String(value ?? '').trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]?\d(?:\.\d{1,3})?)$/.exec(s)
  if (m) return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3])
  throw new MediaLimitError(`${label} "${s.slice(0, 20)}" must be a number of seconds or hh:mm:ss`)
}

/** Seconds as an FFmpeg argument (fixed decimals, never exponent notation). */
export function ts(seconds: number): string {
  return (Math.max(0, Math.round(seconds * 1000)) / 1000).toFixed(3)
}

const intArg = (n: number, min: number, max: number) => String(Math.max(min, Math.min(max, Math.round(n))))

export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac'
export type VideoFormat = 'mp4' | 'webm' | 'mov' | 'gif'
export type ImageFormat = 'png' | 'jpeg'

export const AUDIO_CODEC_ARGS: Record<AudioFormat, string[]> = {
  mp3: ['-c:a', 'libmp3lame', '-b:a', '128k'],
  wav: ['-c:a', 'pcm_s16le'],
  m4a: ['-c:a', 'aac', '-b:a', '128k'],
  ogg: ['-c:a', 'libopus', '-b:a', '96k'],
  flac: ['-c:a', 'flac'],
}

export const MEDIA_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg', aac: 'audio/aac', pcm: 'audio/L16',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', gif: 'image/gif',
  png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp',
  srt: 'application/x-subrip', vtt: 'text/vtt', txt: 'text/plain', json: 'application/json',
}

const BASE = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error']

function videoCodecArgs(format: VideoFormat, crf = 23): string[] {
  switch (format) {
    case 'mp4':
    case 'mov':
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', intArg(crf, 0, 51), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', ...(format === 'mp4' ? ['-movflags', '+faststart'] : [])]
    case 'webm':
      return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', intArg(crf + 8, 0, 63), '-row-mt', '1', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '96k']
    case 'gif':
      return ['-an']
  }
}

/** A downscale-only filter keeping the aspect ratio and even sizes (null when no limit). */
export function scaleFilter(maxWidth?: number | null, maxHeight?: number | null): string | null {
  const w = maxWidth && maxWidth > 0 ? Math.round(maxWidth) : null
  const h = maxHeight && maxHeight > 0 ? Math.round(maxHeight) : null
  if (!w && !h) return null
  const W = w ?? 16384
  const H = h ?? 16384
  return `scale='min(${W},iw)':'min(${H},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
}

/* ── Builders (pure) ───────────────────────────────────────────────── */

export function buildExtractAudioArgs(input: string, output: string, format: AudioFormat): string[] {
  return [...BASE, '-i', input, '-vn', '-map', '0:a:0', ...AUDIO_CODEC_ARGS[format], output]
}

/** Small mono speech audio for transcription uploads (about 0.25 MB per minute). */
export function buildSpeechAudioArgs(input: string, output: string, range?: { start: number; duration: number }): string[] {
  return [
    ...BASE,
    ...(range ? ['-ss', ts(range.start), '-t', ts(range.duration)] : []),
    '-i', input, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', output,
  ]
}

export function buildFramesArgs(input: string, outputPattern: string, options: { interval: number; count: number; format: ImageFormat; start?: number; maxWidth?: number }): string[] {
  const interval = Math.max(0.04, options.interval)
  const filters = [`fps=1/${ts(interval)}`, scaleFilter(options.maxWidth ?? null, null)].filter(Boolean).join(',')
  return [
    ...BASE,
    ...(options.start ? ['-ss', ts(options.start)] : []),
    '-i', input, '-vf', filters, '-frames:v', intArg(options.count, 1, MEDIA_LIMITS.maxFrames),
    ...(options.format === 'jpeg' ? ['-q:v', '3'] : []),
    outputPattern,
  ]
}

export function buildThumbnailArgs(input: string, output: string, at: number, options: { format: ImageFormat; maxWidth?: number }): string[] {
  const scale = scaleFilter(options.maxWidth ?? null, null)
  return [...BASE, '-ss', ts(at), '-i', input, '-frames:v', '1', ...(scale ? ['-vf', scale] : []), ...(options.format === 'jpeg' ? ['-q:v', '2'] : []), output]
}

export function buildTrimArgs(input: string, output: string, range: { start: number; end?: number | null }, format: VideoFormat | AudioFormat, hasVideo: boolean): string[] {
  const end = range.end ?? null
  if (end !== null && end <= range.start) throw new MediaLimitError('Trim: the end must be after the start')
  const video = hasVideo && isVideoFormat(format)
  const codec = video ? videoCodecArgs(format as VideoFormat) : AUDIO_CODEC_ARGS[(isAudioFormat(format) ? format : 'm4a') as AudioFormat]
  // -ss before -i seeks the input; -t is the length from there.
  return [...BASE, '-ss', ts(range.start), ...(end !== null ? ['-t', ts(end - range.start)] : []), '-i', input, ...(video ? [] : ['-vn']), ...codec, output]
}

export function isVideoFormat(f: string): f is VideoFormat {
  return f === 'mp4' || f === 'webm' || f === 'mov' || f === 'gif'
}

export function isAudioFormat(f: string): f is AudioFormat {
  return f === 'mp3' || f === 'wav' || f === 'm4a' || f === 'ogg' || f === 'flac'
}

export function buildConvertArgs(input: string, output: string, format: VideoFormat | AudioFormat, options: { maxWidth?: number | null; maxHeight?: number | null; hasVideo: boolean }): string[] {
  if (isAudioFormat(format)) return [...BASE, '-i', input, '-vn', '-map', '0:a:0', ...AUDIO_CODEC_ARGS[format], output]
  if (!options.hasVideo) throw new MediaLimitError(`Convert: the input has no video to convert to ${format.toUpperCase()}`)
  if (format === 'gif') {
    const scale = scaleFilter(options.maxWidth ?? 480, options.maxHeight ?? null)
    return [...BASE, '-i', input, '-filter_complex', `fps=10,${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`, '-an', '-loop', '0', output]
  }
  const scale = scaleFilter(options.maxWidth, options.maxHeight)
  return [...BASE, '-i', input, ...(scale ? ['-vf', scale] : []), ...videoCodecArgs(format), output]
}

export const COMPRESS_LEVELS = { high: { crf: 23, audio: '128k' }, medium: { crf: 28, audio: '96k' }, low: { crf: 32, audio: '64k' } } as const

export function buildCompressArgs(input: string, output: string, quality: keyof typeof COMPRESS_LEVELS, options: { maxWidth?: number | null; maxHeight?: number | null; hasVideo: boolean; format: VideoFormat | AudioFormat }): string[] {
  const level = COMPRESS_LEVELS[quality] ?? COMPRESS_LEVELS.medium
  if (!options.hasVideo || isAudioFormat(options.format)) {
    const fmt = isAudioFormat(options.format) ? options.format : 'm4a'
    const codec = fmt === 'wav' || fmt === 'flac' ? AUDIO_CODEC_ARGS.mp3 : [...AUDIO_CODEC_ARGS[fmt].slice(0, 2), '-b:a', level.audio]
    return [...BASE, '-i', input, '-vn', ...codec, output]
  }
  const scale = scaleFilter(options.maxWidth, options.maxHeight)
  const fmt = options.format === 'gif' ? 'mp4' : options.format
  const codec = videoCodecArgs(fmt, level.crf).map((a, i, all) => (all[i - 1] === '-b:a' ? level.audio : a))
  return [...BASE, '-i', input, ...(scale ? ['-vf', scale] : []), ...codec, output]
}

/** A path inside a filter graph option: escape the filtergraph and option-level specials. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\\\\\').replace(/'/g, "\\\\\\'").replace(/:/g, '\\\\:').replace(/([[\],;])/g, '\\$1')
}

export function buildBurnSubtitlesArgs(input: string, subtitles: string, output: string, format: VideoFormat): string[] {
  return [...BASE, '-i', input, '-vf', `subtitles=filename=${escapeFilterPath(subtitles)}:charenc=UTF-8`, ...videoCodecArgs(format === 'gif' ? 'mp4' : format), output]
}

/* ── Video redaction ───────────────────────────────────────────────── */

/** A region to hide, in pixels of the video frame, between two times. */
export interface TimedRegion { left: number; top: number; width: number; height: number; start: number; end: number }

export type VideoRedactStyle = 'blur' | 'pixelate' | 'box'

/** Regions above this make a graph too large for one argument; callers merge first. */
export const MAX_VIDEO_REGIONS = 400

const evenFloor = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
const evenCeil = (n: number) => Math.max(2, Math.ceil(n / 2) * 2)

/** Clamp a region to the frame, with even sizes (yuv420p). Null when nothing is left. */
export function clampRegion(r: TimedRegion, frameWidth: number, frameHeight: number): TimedRegion | null {
  const left = evenFloor(Math.max(0, Math.min(frameWidth - 2, r.left)))
  const top = evenFloor(Math.max(0, Math.min(frameHeight - 2, r.top)))
  const right = Math.min(frameWidth, Math.max(left + 2, r.left + r.width))
  const bottom = Math.min(frameHeight, Math.max(top + 2, r.top + r.height))
  const width = Math.min(evenCeil(right - left), evenFloor(frameWidth - left))
  const height = Math.min(evenCeil(bottom - top), evenFloor(frameHeight - top))
  if (width < 2 || height < 2 || !(r.end > r.start)) return null
  return { left, top, width, height, start: Math.max(0, r.start), end: r.end }
}

/**
 * The -filter_complex graph that hides `regions` in input 0's video:
 *  - box:      drawbox (filled) per region, enabled between its times;
 *  - blur:     the region cropped from a copy of the frame, box-blurred,
 *              overlaid back while enabled;
 *  - pixelate: the same with a down/up-scale (nearest neighbour).
 * Output label [vout]. All values are numbers this module formatted.
 */
export function buildVideoRedactFilter(regions: TimedRegion[], frame: { width: number; height: number }, style: VideoRedactStyle, color = '000000'): string {
  const clean = regions.map((r) => clampRegion(r, frame.width, frame.height)).filter((r): r is TimedRegion => r !== null)
  if (clean.length > MAX_VIDEO_REGIONS) throw new MediaLimitError(`Too many regions to redact (${clean.length}; at most ${MAX_VIDEO_REGIONS}) — increase the sample interval or shorten the video`)
  if (!clean.length) return '[0:v]null[vout]'
  const hex = /^[0-9a-f]{6}$/i.test(color) ? color : '000000'
  const enable = (r: TimedRegion) => `enable='between(t,${ts(r.start)},${ts(r.end)})'`
  if (style === 'box') {
    return `[0:v]${clean.map((r) => `drawbox=x=${r.left}:y=${r.top}:w=${r.width}:h=${r.height}:color=0x${hex}@1:t=fill:${enable(r)}`).join(',')}[vout]`
  }
  const parts: string[] = []
  const n = clean.length
  parts.push(`[0:v]split=${n + 1}[base]${clean.map((_, i) => `[c${i}]`).join('')}`)
  clean.forEach((r, i) => {
    if (style === 'pixelate') {
      const bw = Math.max(1, Math.round(r.width / 12))
      const bh = Math.max(1, Math.round(r.height / 12))
      parts.push(`[c${i}]crop=${r.width}:${r.height}:${r.left}:${r.top},scale=${bw}:${bh}:flags=neighbor,scale=${r.width}:${r.height}:flags=neighbor[p${i}]`)
    } else {
      // boxblur radius is limited by the plane size (chroma is half): keep it below min(w,h)/4.
      const radius = Math.max(1, Math.min(40, Math.floor(Math.min(r.width, r.height) / 4) - 1))
      parts.push(`[c${i}]crop=${r.width}:${r.height}:${r.left}:${r.top},boxblur=${radius}:3[p${i}]`)
    }
  })
  let prev = 'base'
  clean.forEach((r, i) => {
    const out = i === n - 1 ? 'vout' : `o${i}`
    parts.push(`[${prev}][p${i}]overlay=${r.left}:${r.top}:${enable(r)}[${out}]`)
    prev = out
  })
  return parts.join(';')
}

/** A time span of audio to hide. */
export interface AudioSpan { start: number; end: number }

/** Merge overlapping / touching spans (padding seconds added on both sides). */
export function mergeSpans(spans: AudioSpan[], padding = 0): AudioSpan[] {
  const sorted = spans
    .map((s) => ({ start: Math.max(0, s.start - padding), end: s.end + padding }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)
  const out: AudioSpan[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}

/**
 * Audio part of the graph for input 0: mute the spans, or mute them and mix
 * in a 1 kHz tone during them (bleep). Output label [aout].
 */
export function buildAudioRedactFilter(spans: AudioSpan[], mode: 'mute' | 'bleep', duration: number): string {
  const merged = mergeSpans(spans)
  if (!merged.length) return '[0:a]anull[aout]'
  const any = merged.map((s) => `between(t,${ts(s.start)},${ts(s.end)})`).join('+')
  const muted = `[0:a]volume=0:enable='${any}'`
  if (mode === 'mute') return `${muted}[aout]`
  return [
    `${muted}[am]`,
    `sine=frequency=1000:sample_rate=48000:duration=${ts(Math.max(0.1, duration))},volume=0.2,volume=0:enable='not(${any})'[beep]`,
    `[am][beep]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
  ].join(';')
}

/** Arguments for a redacted copy: the video graph and / or the audio graph. */
export function buildRedactVideoArgs(input: string, output: string, options: { videoFilter: string | null; audioFilter: string | null; hasAudio: boolean; format: 'mp4' | 'webm' | 'mov' }): string[] {
  const graphs = [options.videoFilter, options.audioFilter].filter(Boolean).join(';')
  const maps: string[] = []
  if (options.videoFilter) maps.push('-map', '[vout]')
  if (options.audioFilter) maps.push('-map', '[aout]')
  else if (options.hasAudio) maps.push('-map', '0:a?')
  const codec = videoCodecArgs(options.format)
  return [
    ...BASE, '-i', input,
    ...(graphs ? ['-filter_complex', graphs] : []),
    ...(options.videoFilter ? maps : ['-map', '0:v?', ...maps]),
    ...codec,
    output,
  ]
}

/** Audio-only redaction (a call recording): mute / bleep into the given audio format. */
export function buildRedactAudioArgs(input: string, output: string, audioFilter: string, format: AudioFormat): string[] {
  return [...BASE, '-i', input, '-filter_complex', audioFilter, '-map', '[aout]', ...AUDIO_CODEC_ARGS[format], output]
}
