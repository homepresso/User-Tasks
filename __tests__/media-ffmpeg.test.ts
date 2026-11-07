import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAudioRedactFilter, buildBurnSubtitlesArgs, buildCompressArgs, buildConvertArgs, buildExtractAudioArgs, buildFramesArgs,
  buildRedactAudioArgs, buildRedactVideoArgs, buildSpeechAudioArgs, buildThumbnailArgs, buildTrimArgs, buildVideoRedactFilter,
  clampRegion, escapeFilterPath, lastErrorLine, MAX_VIDEO_REGIONS, mediaToolsDisabledReason, mergeSpans, parseProbe, parseTime,
  requireFfmpeg, resetFfmpegAvailability, scaleFilter, ts,
} from '@/lib/media/ffmpeg'
import { MediaLimitError, MediaToolUnavailableError } from '@/lib/media/types'

/** Every argument is a separate array element: nothing is ever joined into a shell string. */
function assertArgv(args: string[]) {
  expect(Array.isArray(args)).toBe(true)
  for (const a of args) expect(typeof a).toBe('string')
  expect(args).toContain('-nostdin')
  expect(args.slice(0, 2)).toEqual(['-hide_banner', '-nostdin'])
}

describe('time and number arguments', () => {
  it('parses seconds and hh:mm:ss, and refuses anything else (never passed through as text)', () => {
    expect(parseTime(90)).toBe(90)
    expect(parseTime('90')).toBe(90)
    expect(parseTime('1:30')).toBe(90)
    expect(parseTime('00:01:30.5')).toBe(90.5)
    expect(parseTime('1:02:03')).toBe(3723)
    for (const bad of ['1; rm -rf /', '$(touch /tmp/x)', '-1', '10 -i /etc/passwd', '1e3', 'NaN', '', '`id`']) {
      expect(() => parseTime(bad), bad).toThrow(MediaLimitError)
    }
    expect(() => parseTime(-5)).toThrow(MediaLimitError)
  })

  it('formats seconds with fixed decimals', () => {
    expect(ts(1)).toBe('1.000')
    expect(ts(0.0001)).toBe('0.000')
    expect(ts(1e-9)).toBe('0.000')
    expect(ts(-3)).toBe('0.000')
    expect(ts(12.3456)).toBe('12.346')
  })
})

describe('command builders (argument arrays only)', () => {
  it('extract audio / speech audio', () => {
    const a = buildExtractAudioArgs('/t/in.mp4', '/t/out.mp3', 'mp3')
    assertArgv(a)
    expect(a).toEqual(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', '/t/in.mp4', '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '128k', '/t/out.mp3'])
    const s = buildSpeechAudioArgs('/t/in.mov', '/t/s.mp3', { start: 600, duration: 598 })
    assertArgv(s)
    expect(s).toEqual(expect.arrayContaining(['-ss', '600.000', '-t', '598.000', '-ac', '1', '-ar', '16000', '-b:a', '32k']))
    expect(s.indexOf('-ss')).toBeLessThan(s.indexOf('-i'))
  })

  it('frames and thumbnails', () => {
    const f = buildFramesArgs('/t/in.mp4', '/t/f-%05d.jpg', { interval: 2.5, count: 12, format: 'jpeg', maxWidth: 640 })
    assertArgv(f)
    expect(f[f.indexOf('-vf') + 1]).toBe("fps=1/2.500,scale='min(640,iw)':'min(16384,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2")
    expect(f[f.indexOf('-frames:v') + 1]).toBe('12')
    // Count is capped.
    expect(buildFramesArgs('/i', '/o', { interval: 1, count: 1e9, format: 'png' })).toContain('600')
    const t = buildThumbnailArgs('/t/in.mp4', '/t/th.png', 3.2, { format: 'png' })
    expect(t).toEqual(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', '3.200', '-i', '/t/in.mp4', '-frames:v', '1', '/t/th.png'])
  })

  it('trim seeks before the input and uses a length', () => {
    const v = buildTrimArgs('/t/in.mp4', '/t/out.mp4', { start: 5, end: 30 }, 'mp4', true)
    assertArgv(v)
    expect(v.slice(5, 9)).toEqual(['-ss', '5.000', '-t', '25.000'])
    expect(v).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'aac']))
    const a = buildTrimArgs('/t/in.mp3', '/t/out.mp3', { start: 1 }, 'mp3', false)
    expect(a).not.toContain('-t')
    expect(a).toContain('-vn')
    expect(() => buildTrimArgs('/i', '/o', { start: 10, end: 5 }, 'mp4', true)).toThrow(/after the start/)
  })

  it('convert / compress use codecs from allow-lists', () => {
    expect(buildConvertArgs('/i.mov', '/o.webm', 'webm', { hasVideo: true })).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9', '-c:a', 'libopus']))
    expect(buildConvertArgs('/i.mov', '/o.wav', 'wav', { hasVideo: true })).toEqual(expect.arrayContaining(['-vn', '-c:a', 'pcm_s16le']))
    const gif = buildConvertArgs('/i.mp4', '/o.gif', 'gif', { hasVideo: true })
    expect(gif[gif.indexOf('-filter_complex') + 1]).toContain('palettegen')
    expect(() => buildConvertArgs('/i.mp3', '/o.mp4', 'mp4', { hasVideo: false })).toThrow(/no video/)
    const c = buildCompressArgs('/i.mp4', '/o.mp4', 'low', { hasVideo: true, format: 'mp4', maxWidth: 1280 })
    expect(c[c.indexOf('-crf') + 1]).toBe('32')
    expect(c[c.indexOf('-b:a') + 1]).toBe('64k')
    const ca = buildCompressArgs('/i.wav', '/o.mp3', 'medium', { hasVideo: false, format: 'wav' })
    expect(ca).toEqual(expect.arrayContaining(['-c:a', 'libmp3lame']))
  })

  it('scale filter only downsizes', () => {
    expect(scaleFilter(null, null)).toBeNull()
    expect(scaleFilter(1920, undefined)).toBe("scale='min(1920,iw)':'min(16384,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2")
  })

  it('subtitle paths are escaped for the filter graph', () => {
    expect(escapeFilterPath('subs.srt')).toBe('subs.srt')
    const nasty = escapeFilterPath("a'b:c,d;e[f]")
    expect(nasty).not.toMatch(/(^|[^\\])'/)
    expect(nasty).toContain('\\,')
    expect(nasty).toContain('\\;')
    const b = buildBurnSubtitlesArgs('in.mp4', 'subs.srt', 'out.mp4', 'mp4')
    expect(b[b.indexOf('-vf') + 1]).toBe('subtitles=filename=subs.srt:charenc=UTF-8')
  })
})

describe('ffprobe output', () => {
  it('parses streams, rotation and ignores cover art', () => {
    const info = parseProbe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.480000', size: '345678', bit_rate: '221000' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
      ],
    })
    expect(info).toEqual({
      duration: 12.48, size: 345678, format: 'mov', bit_rate: 221000, has_video: true, has_audio: true,
      video: { codec: 'h264', width: 1920, height: 1080, fps: 29.97, rotation: 270 },
      audio: { codec: 'aac', sample_rate: 48000, channels: 2 },
    })
    const mp3 = parseProbe({ format: { format_name: 'mp3', duration: '3.1' }, streams: [{ codec_type: 'audio', codec_name: 'mp3' }, { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }] })
    expect(mp3.has_video).toBe(false)
    expect(parseProbe(null)).toMatchObject({ duration: null, has_video: false, has_audio: false })
  })

  it('error lines drop temp paths', () => {
    expect(lastErrorLine('frame=1\n/tmp/ut-media-abc123/input.mp4: Invalid data found when processing input\n')).toBe('input.mp4: Invalid data found when processing input')
  })
})

describe('video redaction filter graph', () => {
  const frame = { width: 640, height: 360 }

  it('clamps regions to the frame with even sizes', () => {
    expect(clampRegion({ left: -10, top: 351, width: 51, height: 40, start: 1, end: 2 }, 640, 360)).toEqual({ left: 0, top: 350, width: 42, height: 10, start: 1, end: 2 })
    expect(clampRegion({ left: 10, top: 10, width: 5, height: 5, start: 2, end: 2 }, 640, 360)).toBeNull()
  })

  it('box: one filled drawbox per region with its time window', () => {
    const g = buildVideoRedactFilter([{ left: 100, top: 50, width: 80, height: 60, start: 0.5, end: 2.25 }], frame, 'box', '112233')
    expect(g).toBe("[0:v]drawbox=x=100:y=50:w=80:h=60:color=0x112233@1:t=fill:enable='between(t,0.500,2.250)'[vout]")
  })

  it('blur: split, crop + boxblur per region, chained overlays ending in [vout]', () => {
    const g = buildVideoRedactFilter([
      { left: 100, top: 50, width: 80, height: 60, start: 0, end: 2 },
      { left: 300, top: 100, width: 40, height: 40, start: 1, end: 3 },
    ], frame, 'blur')
    expect(g.split(';')).toEqual([
      '[0:v]split=3[base][c0][c1]',
      '[c0]crop=80:60:100:50,boxblur=14:3[p0]',
      '[c1]crop=40:40:300:100,boxblur=9:3[p1]',
      "[base][p0]overlay=100:50:enable='between(t,0.000,2.000)'[o0]",
      "[o0][p1]overlay=300:100:enable='between(t,1.000,3.000)'[vout]",
    ])
  })

  it('pixelate: nearest-neighbour down / up scale', () => {
    const g = buildVideoRedactFilter([{ left: 0, top: 0, width: 120, height: 60, start: 0, end: 1 }], frame, 'pixelate')
    expect(g).toContain('[c0]crop=120:60:0:0,scale=10:5:flags=neighbor,scale=120:60:flags=neighbor[p0]')
  })

  it('no regions → pass-through; too many → a clear error', () => {
    expect(buildVideoRedactFilter([], frame, 'blur')).toBe('[0:v]null[vout]')
    const many = Array.from({ length: MAX_VIDEO_REGIONS + 1 }, (_, i) => ({ left: 0, top: 0, width: 10, height: 10, start: i, end: i + 1 }))
    expect(() => buildVideoRedactFilter(many, frame, 'box')).toThrow(/Too many regions/)
  })

  it('audio: merged spans muted, or muted with a gated tone', () => {
    expect(mergeSpans([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 1.9, end: 3 }], 0)).toEqual([{ start: 1, end: 3 }, { start: 5, end: 6 }])
    expect(mergeSpans([{ start: 0.1, end: 0.5 }], 0.2)).toEqual([{ start: 0, end: 0.7 }])
    expect(buildAudioRedactFilter([{ start: 1, end: 2 }], 'mute', 10)).toBe("[0:a]volume=0:enable='between(t,1.000,2.000)'[aout]")
    const bleep = buildAudioRedactFilter([{ start: 1, end: 2 }, { start: 4, end: 5 }], 'bleep', 10).split(';')
    expect(bleep[0]).toBe("[0:a]volume=0:enable='between(t,1.000,2.000)+between(t,4.000,5.000)'[am]")
    expect(bleep[1]).toBe("sine=frequency=1000:sample_rate=48000:duration=10.000,volume=0.2,volume=0:enable='not(between(t,1.000,2.000)+between(t,4.000,5.000))'[beep]")
    expect(bleep[2]).toBe('[am][beep]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]')
    expect(buildAudioRedactFilter([], 'bleep', 10)).toBe('[0:a]anull[aout]')
  })

  it('maps the graphs into the output', () => {
    const both = buildRedactVideoArgs('/t/in.mp4', '/t/out.mp4', { videoFilter: '[0:v]null[vout]', audioFilter: '[0:a]anull[aout]', hasAudio: true, format: 'mp4' })
    assertArgv(both)
    expect(both[both.indexOf('-filter_complex') + 1]).toBe('[0:v]null[vout];[0:a]anull[aout]')
    expect(both).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '[aout]']))
    const videoOnly = buildRedactVideoArgs('/i', '/o', { videoFilter: '[0:v]null[vout]', audioFilter: null, hasAudio: true, format: 'mp4' })
    expect(videoOnly).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '0:a?']))
    const audioOnly = buildRedactVideoArgs('/i', '/o', { videoFilter: null, audioFilter: '[0:a]anull[aout]', hasAudio: true, format: 'mp4' })
    expect(audioOnly).toEqual(expect.arrayContaining(['-map', '0:v?', '-map', '[aout]']))
    expect(buildRedactAudioArgs('/i.mp3', '/o.mp3', '[0:a]anull[aout]', 'mp3')).toEqual(expect.arrayContaining(['-map', '[aout]', '-c:a', 'libmp3lame']))
  })
})

describe('availability', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetFfmpegAvailability()
  })

  it('Vercel without FFMPEG_PATH and MEDIA_TOOLS=off are explained', () => {
    expect(mediaToolsDisabledReason({ VERCEL: '1' })).toMatch(/Vercel/)
    expect(mediaToolsDisabledReason({ VERCEL: '1', FFMPEG_PATH: '/opt/ffmpeg' })).toBeNull()
    expect(mediaToolsDisabledReason({ MEDIA_TOOLS: 'off' })).toMatch(/MEDIA_TOOLS=off/)
    expect(mediaToolsDisabledReason({})).toBeNull()
  })

  it('requireFfmpeg names the operation and the remedy', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('FFMPEG_PATH', '')
    await expect(requireFfmpeg('Redact Video')).rejects.toThrow(MediaToolUnavailableError)
    await expect(requireFfmpeg('Redact Video')).rejects.toThrow(/Redact Video needs FFmpeg: this deployment \(Vercel\) has no FFmpeg/)
  })

  it('a missing binary is reported as not installed', async () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('MEDIA_TOOLS', '')
    vi.stubEnv('FFMPEG_PATH', '/nonexistent/dir/ffmpeg-missing')
    await expect(requireFfmpeg('Trim')).rejects.toThrow(/Trim needs FFmpeg, which is not installed/)
  })
})
