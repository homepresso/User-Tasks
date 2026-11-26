/**
 * FFmpeg must only read inputs from local files / pipes: a crafted playlist
 * must not make it fetch network URLs itself (outside the egress guard).
 */
import { describe, expect, it } from 'vitest'
import { INPUT_PROTOCOLS, withInputProtocolWhitelist } from '@/lib/media/ffmpeg'

describe('FFmpeg input protocol whitelist', () => {
  it('puts the whitelist before every input, once', () => {
    const args = withInputProtocolWhitelist(['-y', '-ss', '1', '-i', 'a.mp4', '-i', 'b.wav', 'out.mp4'])
    expect(args).toEqual(['-y', '-ss', '1', ...INPUT_PROTOCOLS, '-i', 'a.mp4', ...INPUT_PROTOCOLS, '-i', 'b.wav', 'out.mp4'])
    expect(withInputProtocolWhitelist(args)).toEqual(args)
    expect(INPUT_PROTOCOLS).toEqual(['-protocol_whitelist', 'file,pipe'])
  })
})
