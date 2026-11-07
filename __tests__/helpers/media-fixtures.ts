/**
 * Generated media fixtures for the media tests (no files in the repo):
 * small PNG / JPEG images drawn in code, and a fake "ID card" layout whose
 * face and ID-number positions are known.
 */
import { encodeImage, type RgbaImage } from '@/lib/media/image'

/** A w×h image filled with a colour. */
export function solid(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

/** A checkerboard (high detail, so blurring visibly changes it). */
export function checker(width: number, height: number, cell = 4): RgbaImage {
  const img = solid(width, height, [255, 255, 255])
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (((Math.floor(x / cell) + Math.floor(y / cell)) % 2) === 0) {
      const i = (y * width + x) * 4
      img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0
    }
  }
  return img
}

export function pixel(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

/** Mean absolute difference of a rectangle between two same-size images (0–255). */
export function regionDiff(a: RgbaImage, b: RgbaImage, r: { left: number; top: number; width: number; height: number }): number {
  let sum = 0
  let n = 0
  for (let y = r.top; y < r.top + r.height; y++) for (let x = r.left; x < r.left + r.width; x++) {
    const i = (y * a.width + x) * 4
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    n += 3
  }
  return n ? sum / n : 0
}

export function pngBytes(img: RgbaImage): Uint8Array {
  return encodeImage(img, 'png')
}

export function jpegBytes(img: RgbaImage, quality = 90): Uint8Array {
  return encodeImage(img, 'jpeg', quality)
}

/** Insert an EXIF APP1 segment with an Orientation tag right after SOI. */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  // TIFF header (little endian) + IFD0 with one entry: 0x0112 SHORT 1 = orientation.
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  const len = payload.length + 2
  const app1 = [0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload]
  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, 2), 0)
  out.set(app1, 2)
  out.set(jpeg.subarray(2), 2 + app1.length)
  return out
}

/**
 * A 640×400 "ID card": a textured face area at x 40–200 / y 80–300 and a
 * textured ID-number line at x 256–576 / y 220–252. Box fractions match
 * what the mock providers return.
 */
export const ID_CARD = {
  width: 640,
  height: 400,
  face: { x: 40 / 640, y: 80 / 400, width: 160 / 640, height: 220 / 400 },
  idLine: { x: 256 / 640, y: 220 / 400, width: 320 / 640, height: 32 / 400 },
}

export function idCardImage(): RgbaImage {
  const img = solid(ID_CARD.width, ID_CARD.height, [235, 240, 250])
  const tex = checker(ID_CARD.width, ID_CARD.height, 3)
  const paint = (b: { x: number; y: number; width: number; height: number }) => {
    const l = Math.round(b.x * ID_CARD.width), t = Math.round(b.y * ID_CARD.height)
    const w = Math.round(b.width * ID_CARD.width), h = Math.round(b.height * ID_CARD.height)
    for (let y = t; y < t + h; y++) for (let x = l; x < l + w; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = tex.data[i]; img.data[i + 1] = tex.data[i + 1]; img.data[i + 2] = tex.data[i + 2]
    }
  }
  paint(ID_CARD.face)
  paint(ID_CARD.idLine)
  return img
}
