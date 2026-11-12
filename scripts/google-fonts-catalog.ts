/**
 * Regenerate lib/fonts/google-fonts.json: the bundled catalogue of Google
 * Fonts families (name, category, weights, italics) the font pickers list and
 * the server validates against (lib/fonts/google.ts).
 *
 * Source: fonts.google.com's public family metadata (no API key). The app
 * never calls it at runtime; run this by hand to pick up new families and
 * commit the result.
 *
 * Usage:
 *   npx tsx scripts/google-fonts-catalog.ts                 # fetch and write
 *   npx tsx scripts/google-fonts-catalog.ts --from meta.json # from a saved copy
 *
 * Kept out: families not flagged open source, names outside [A-Za-z0-9 -],
 * and families with no weight in 100–900. Everything kept is under the SIL
 * Open Font License, the Apache License 2.0 or the Ubuntu Font Licence.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = 'https://fonts.google.com/metadata/fonts'
const OUT = resolve(__dirname, '..', 'lib', 'fonts', 'google-fonts.json')
const CATEGORY: Record<string, string> = { 'Sans Serif': 's', Serif: 'r', Display: 'd', Handwriting: 'h', Monospace: 'm' }
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/

interface Meta {
  family: string
  category: string
  popularity: number
  fonts: Record<string, unknown>
  isOpenSource?: boolean
}

async function load(): Promise<{ familyMetadataList: Meta[] }> {
  const from = process.argv.indexOf('--from')
  const text = from > 0
    ? readFileSync(process.argv[from + 1], 'utf8')
    : await (await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) })).text()
  return JSON.parse(text.replace(/^\)\]\}'\s*/, ''))
}

async function main() {
  const meta = await load()
  const out: Array<[string, string, number, number]> = []
  const slugs = new Set<string>()
  const list = [...meta.familyMetadataList].sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9) || a.family.localeCompare(b.family))
  for (const f of list) {
    if (f.isOpenSource === false) continue
    if (!FAMILY_RE.test(f.family)) continue
    const category = CATEGORY[f.category]
    if (!category) continue
    let mask = 0
    let italic = 0 // italic weights, same bitmask
    for (const key of Object.keys(f.fonts ?? {})) {
      const m = /^(\d+)(i?)$/.exec(key)
      if (!m) continue
      const w = Number(m[1])
      if (w < 100 || w > 900 || w % 100) continue
      if (m[2]) italic |= 1 << (w / 100 - 1)
      else mask |= 1 << (w / 100 - 1)
    }
    if (!mask) continue
    const slug = f.family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (slugs.has(slug)) throw new Error(`Duplicate slug ${slug} (${f.family})`)
    slugs.add(slug)
    out.push([f.family, category, mask, italic])
  }
  // One family per line: small diffs when Google adds or changes families.
  const body = out.map((row) => JSON.stringify(row)).join(',\n')
  const json = `{"source":"${SOURCE}","generated":"${new Date().toISOString().slice(0, 10)}","format":["family","category s|r|d|h|m","upright weights bitmask (bit n = (n+1)*100)","italic weights bitmask"],"fonts":[\n${body}\n]}\n`
  writeFileSync(OUT, json)
  console.log(`Wrote ${out.length} families to ${OUT} (${json.length} bytes)`)
}

main().catch((error) => { console.error(error); process.exit(1) })
