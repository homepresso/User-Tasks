import { describe, expect, it } from 'vitest'
import { applyOrientation, decodeImage, encodeImage, imageForProvider, imageSize, jpegOrientation, parseColor, redactRegions, resizeImage, sniffImage } from '@/lib/media/image'
import { clampBox, fromPixels, iou, padBox, parseCustomBoxes, polygonBounds, roundBox, toPixels, unionBoxes } from '@/lib/media/geometry'
import { checker, idCardImage, ID_CARD, jpegBytes, pixel, pngBytes, regionDiff, solid, withExifOrientation } from './helpers/media-fixtures'
import { MediaLimitError } from '@/lib/media/types'

describe('geometry', () => {
  it('normalised ↔ pixels rounds outward and stays inside the image', () => {
    expect(toPixels({ x: 0.1, y: 0.2, width: 0.25, height: 0.5 }, 640, 400)).toEqual({ left: 64, top: 80, width: 160, height: 200 })
    expect(toPixels({ x: 0.1001, y: 0.2, width: 0.1, height: 0.1 }, 100, 100)).toEqual({ left: 10, top: 20, width: 11, height: 10 })
    expect(toPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 100, 100)).toEqual({ left: 90, top: 90, width: 10, height: 10 })
    expect(fromPixels({ left: 64, top: 80, width: 160, height: 200 }, 640, 400)).toEqual({ x: 0.1, y: 0.2, width: 0.25, height: 0.5 })
  })

  it('the same normalised box hits the same content at any scale', () => {
    const b = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }
    const big = toPixels(b, 4000, 3000)
    const small = toPixels(b, 1000, 750)
    expect(big.left / 4).toBe(small.left)
    expect(big.width / 4).toBe(small.width)
  })

  it('pads, clamps, unions and compares boxes', () => {
    expect(roundBox(padBox({ x: 0.4, y: 0.4, width: 0.2, height: 0.1 }, 10))).toEqual({ x: 0.38, y: 0.39, width: 0.24, height: 0.12 })
    expect(padBox({ x: 0, y: 0, width: 0.5, height: 0.5 }, 50)).toEqual({ x: 0, y: 0, width: 0.75, height: 0.75 })
    expect(clampBox({ x: -0.1, y: 0.9, width: 0.3, height: 0.3 })).toEqual({ x: 0, y: 0.9, width: expect.closeTo(0.2, 10), height: expect.closeTo(0.1, 10) })
    expect(clampBox({ x: 1.2, y: 0, width: 0.1, height: 0.1 })).toBeNull()
    expect(unionBoxes([{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, { x: 0.5, y: 0.4, width: 0.1, height: 0.1 }])).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: expect.closeTo(0.4, 10) })
    expect(iou({ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 })).toBe(1)
    expect(iou({ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 })).toBe(0)
    expect(polygonBounds([{ x: 10, y: 5 }, { x: 30, y: 6 }, { x: 29, y: 20 }, { x: 9, y: 19 }])).toEqual({ x: 9, y: 5, width: 21, height: 15 })
    expect(roundBox({ x: 0.123456, y: 0, width: 0.5, height: 0.333333 })).toEqual({ x: 0.1235, y: 0, width: 0.5, height: 0.3333 })
  })

  it('custom boxes: fractions, pixels, Rekognition-style, findings and arrays', () => {
    const img = { width: 200, height: 100 }
    expect(parseCustomBoxes([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: 'Badge' }], img)).toEqual([{ box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, label: 'Badge' }])
    expect(parseCustomBoxes([{ left: 20, top: 10, width: 40, height: 50 }], img)[0].box).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.5 })
    expect(parseCustomBoxes([{ Left: 0.5, Top: 0.5, Width: 0.25, Height: 0.25 }], img)[0].box).toEqual({ x: 0.5, y: 0.5, width: 0.25, height: 0.25 })
    expect(parseCustomBoxes([{ x: 10, y: 10, width: 50, height: 20 }], img)[0].box).toEqual({ x: 0.05, y: 0.1, width: 0.25, height: 0.2 })
    expect(parseCustomBoxes([{ box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } }, { box_px: { left: 0, top: 0, width: 1, height: 1 } }], img).map((b) => b.box)).toEqual([
      { x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, { x: 0, y: 0, width: 0.005, height: 0.01 },
    ])
    expect(parseCustomBoxes([0.1, 0.1, 0.2, 0.2], img)[0].box).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(parseCustomBoxes('[{"x":0.1,"y":0.1,"width":0.2,"height":0.2,"start":1,"end":4}]', img)).toEqual([{ box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, start: 1, end: 4 }])
    expect(parseCustomBoxes([{ x: 0.1 }, { width: -1, height: 2, x: 0, y: 0 }, 'nope', null], img)).toEqual([])
    expect(parseCustomBoxes('not json', img)).toEqual([])
  })
})

describe('images', () => {
  it('sniffs formats and reads sizes from headers', () => {
    const png = pngBytes(solid(33, 21, [1, 2, 3]))
    const jpg = jpegBytes(solid(40, 30, [200, 100, 50]))
    expect(sniffImage(png)).toBe('png')
    expect(sniffImage(jpg)).toBe('jpeg')
    expect(sniffImage(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('webp')
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBe('gif')
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBe('unknown')
    expect(imageSize(png)).toEqual({ width: 33, height: 21 })
    expect(imageSize(jpg)).toEqual({ width: 40, height: 30 })
  })

  it('round-trips PNG exactly and JPEG closely', () => {
    const src = checker(16, 8, 2)
    const png = decodeImage(pngBytes(src))
    expect(png.kind).toBe('png')
    expect(Array.from(png.data)).toEqual(Array.from(src.data))
    const jpg = decodeImage(jpegBytes(solid(16, 16, [200, 100, 50]), 95))
    expect(jpg.kind).toBe('jpeg')
    const p = pixel(jpg, 8, 8)
    expect(Math.abs(p[0] - 200) + Math.abs(p[1] - 100) + Math.abs(p[2] - 50)).toBeLessThan(12)
  })

  it('applies the JPEG EXIF orientation (phone photos come out upright)', () => {
    // 4×2 image: left half red, right half blue; orientation 6 = rotate 90° clockwise.
    const img = solid(4, 2, [255, 0, 0])
    for (const y of [0, 1]) for (const x of [2, 3]) { const i = (y * 4 + x) * 4; img.data[i] = 0; img.data[i + 2] = 255 }
    const jpg = withExifOrientation(jpegBytes(img, 100), 6)
    expect(jpegOrientation(jpg)).toBe(6)
    const up = decodeImage(jpg)
    expect([up.width, up.height]).toEqual([2, 4])
    // After a clockwise turn the left (red) half is at the top.
    expect(pixel(up, 0, 0)[0]).toBeGreaterThan(150)
    expect(pixel(up, 0, 3)[2]).toBeGreaterThan(150)
    // Every orientation keeps the pixel count; 5–8 swap width / height.
    for (let o = 1; o <= 8; o++) {
      const r = applyOrientation(img, o)
      expect(r.width * r.height).toBe(8)
      expect(r.width).toBe(o >= 5 ? 2 : 4)
    }
    expect(jpegOrientation(jpegBytes(img))).toBe(1)
  })

  it('refuses images over the pixel limit and unknown formats', () => {
    const big = pngBytes(solid(20, 20, [0, 0, 0]))
    expect(() => decodeImage(big, 100)).toThrow(MediaLimitError)
    expect(() => decodeImage(new TextEncoder().encode('GIF89a......'))).toThrow(/PNG or JPEG/)
  })

  it('fits provider size limits by downscaling', () => {
    const img = checker(800, 600, 1)
    const out = imageForProvider(img, { maxBytes: 60_000 })
    expect(out.bytes.byteLength).toBeLessThanOrEqual(60_000)
    expect(out.scale).toBeLessThan(1)
    expect(out.mime_type).toBe('image/jpeg')
    expect(resizeImage(solid(10, 10, [9, 9, 9]), 5, 5).data[0]).toBe(9)
  })

  it('parses colours', () => {
    expect(parseColor('#ff0000')).toEqual([255, 0, 0])
    expect(parseColor('0f0')).toEqual([0, 255, 0])
    expect(parseColor('white')).toEqual([255, 255, 255])
    expect(parseColor('url(javascript:1)')).toEqual([0, 0, 0])
  })
})

describe('redaction (boxes → pixels)', () => {
  const face = toPixels(ID_CARD.face, ID_CARD.width, ID_CARD.height)
  const outside = { left: 260, top: 40, width: 100, height: 60 }

  it('box fills exactly the region and leaves the rest untouched', () => {
    const img = idCardImage()
    const before = { ...img, data: img.data.slice() }
    const done = redactRegions(img, [ID_CARD.face], 'box', [0, 0, 0])
    expect(done).toEqual([face])
    for (const [x, y] of [[face.left, face.top], [face.left + face.width - 1, face.top + face.height - 1], [120, 200]]) expect(pixel(img, x, y)).toEqual([0, 0, 0, 255])
    expect(pixel(img, face.left - 1, face.top)).toEqual(pixel(before, face.left - 1, face.top))
    expect(regionDiff(img, before, outside)).toBe(0)
  })

  it('blur and pixelate destroy detail inside, nothing outside', () => {
    for (const style of ['blur', 'pixelate'] as const) {
      const img = idCardImage()
      const before = { ...img, data: img.data.slice() }
      redactRegions(img, [ID_CARD.face, ID_CARD.idLine], style)
      expect(regionDiff(img, before, face), style).toBeGreaterThan(40)
      expect(regionDiff(img, before, toPixels(ID_CARD.idLine, 640, 400)), style).toBeGreaterThan(40)
      expect(regionDiff(img, before, outside), style).toBe(0)
      // The checkerboard is gone: neighbouring pixels inside a blurred face are close.
      if (style === 'blur') {
        const a = pixel(img, 100, 150)
        const b = pixel(img, 103, 150)
        expect(Math.abs(a[0] - b[0])).toBeLessThan(40)
      }
    }
  })

  it('re-encoding drops metadata (EXIF)', () => {
    const jpg = withExifOrientation(jpegBytes(solid(8, 8, [1, 1, 1])), 3)
    const img = decodeImage(jpg)
    const out = encodeImage(img, 'jpeg')
    expect(jpegOrientation(out)).toBe(1)
    expect(Buffer.from(out).includes(Buffer.from('Exif'))).toBe(false)
  })
})
