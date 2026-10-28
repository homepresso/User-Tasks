// Rasterise the brand SVGs (run scripts/brand/build-svgs.py first).
//
//   public/brand/mark-512.png, mark-192.png   rounded tile, transparent corners
//   public/brand/mark-maskable-512.png        full bleed, glyph in the safe zone
//   app/apple-icon.png                        180×180 full bleed (iOS rounds it)
//   public/favicon.ico                        16/32/48 from the pixel-grid cut
//
// favicon.ico lives in public/, not app/: Next always lists app/favicon.ico
// first, even on pages whose metadata sets other icons, which would compete
// with a workspace theme's custom favicon on dashboard pages.
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import sharp from "sharp"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const brand = (name) => path.join(root, "public/brand", name)

async function png(svgFile, size) {
  const svg = await readFile(brand(svgFile))
  return sharp(svg, { density: Math.max(72, (72 * size) / 16) })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: size <= 48 ? false : true, quality: 95 })
    .toBuffer()
}

/** Multi-image ICO with PNG-encoded entries (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...images.map((image) => image.data)])
}

await writeFile(brand("mark-512.png"), await png("mark.svg", 512))
await writeFile(brand("mark-192.png"), await png("mark.svg", 192))
await writeFile(brand("mark-maskable-512.png"), await png("mark-full-bleed.svg", 512))
await writeFile(path.join(root, "app/apple-icon.png"), await png("mark-full-bleed.svg", 180))
const sizes = [16, 32, 48]
const entries = await Promise.all(sizes.map(async (size) => ({ size, data: await png("mark-16.svg", size) })))
await writeFile(path.join(root, "public/favicon.ico"), ico(entries))
console.log("wrote mark-512/192, mark-maskable-512, app/apple-icon.png, public/favicon.ico")
