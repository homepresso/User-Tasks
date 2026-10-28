/**
 * QR codes of form page links (lib/forms/qr.ts, lib/forms/form-page-url.ts,
 * the forms.qr read):
 *  - the URL: the public app URL + /f/<id> (id encoded, trailing slashes
 *    dropped), encoded byte-for-byte in the code;
 *  - the SVG: a white card (quiet zone of 4 modules) with black modules
 *    whatever the theme, exactly the encoder's dark modules, an optional
 *    caption (escaped) under the code;
 *  - the read: only a form of the caller's workspace.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { afterEach, describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { escapeXml, QR_QUIET_ZONE, qrMatrix, qrPath, qrSvg } from '@/lib/forms/qr'
import { publicAppOrigin, publicFormPageUrl } from '@/lib/forms/form-page-url'
import { getFormQrCode } from '@/lib/services/form-qr'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

const FORM = '0f0f0000-0000-4000-8000-00000000f001'
const OTHER = '0f0f0000-0000-4000-8000-00000000f002'
const TENANT = '0f0f0000-0000-4000-8000-0000000000a1'
const TENANT_B = '0f0f0000-0000-4000-8000-0000000000b1'

/** Dark modules a path draws (runs of `Mx yhNv1h-Nz`). */
function pathModules(d: string): Set<string> {
  const out = new Set<string>()
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])]
    for (let i = 0; i < w; i++) out.add(`${y - QR_QUIET_ZONE},${x - QR_QUIET_ZONE + i}`)
  }
  return out
}

describe('form page URLs', () => {
  afterEach(() => {
    delete (globalThis as any).window
  })

  it('joins the public origin and the encoded id', () => {
    expect(publicFormPageUrl(FORM, 'https://tasks.example.com/')).toBe(`https://tasks.example.com/f/${FORM}`)
    expect(publicFormPageUrl('a b/c?d', 'https://tasks.example.com//')).toBe('https://tasks.example.com/f/a%20b%2Fc%3Fd')
  })

  it('uses the public app URL the page was given, else the browser origin', () => {
    ;(globalThis as any).window = { __USERTASKS_CONFIG__: { supabaseUrl: 'http://sb', supabaseAnonKey: 'k', appUrl: 'https://forms.example.org/', ssoMicrosoft: false }, location: { origin: 'http://localhost:3000' } }
    expect(publicAppOrigin()).toBe('https://forms.example.org')
    expect(publicFormPageUrl(FORM)).toBe(`https://forms.example.org/f/${FORM}`)
    ;(globalThis as any).window = { __USERTASKS_CONFIG__: { supabaseUrl: 'http://sb', supabaseAnonKey: 'k', appUrl: '', ssoMicrosoft: false }, location: { origin: 'http://localhost:3117' } }
    expect(publicFormPageUrl(FORM)).toBe(`http://localhost:3117/f/${FORM}`)
  })
})

describe('QR codes', () => {
  const url = `https://tasks.example.com/f/${FORM}`

  it('encodes the URL byte for byte', () => {
    const code = QRCode.create(url, { errorCorrectionLevel: 'M' }) as any
    const text = code.segments.map((s: any) => (s.data instanceof Uint8Array ? Buffer.from(s.data).toString('utf8') : String(s.data))).join('')
    expect(text).toBe(url)
    const matrix = qrMatrix(url)
    expect(matrix.size).toBe(code.modules.size)
    expect(matrix.size).toBe(17 + 4 * matrix.version)
    // Finder patterns in three corners: a dark 7×7 ring around a light ring and a dark 3×3 core.
    for (const [r0, c0] of [[0, 0], [0, matrix.size - 7], [matrix.size - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        expect(matrix.dark(r0, c0 + i) && matrix.dark(r0 + 6, c0 + i) && matrix.dark(r0 + i, c0) && matrix.dark(r0 + i, c0 + 6)).toBe(true)
      }
      expect(matrix.dark(r0 + 1, c0 + 1)).toBe(false)
      expect(matrix.dark(r0 + 3, c0 + 3)).toBe(true)
    }
  })

  it('draws exactly the dark modules, offset by the quiet zone', () => {
    const matrix = qrMatrix(url)
    const expected = new Set<string>()
    for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) if (matrix.dark(r, c)) expected.add(`${r},${c}`)
    expect(pathModules(qrPath(matrix))).toEqual(expected)
  })

  it('is a white card with black modules, sized by the quiet zone', () => {
    const svg = qrSvg(url, { scale: 10 })
    const side = (qrMatrix(url).size + 2 * QR_QUIET_ZONE) * 10
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(`width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"`)
    expect(svg).toContain(`<rect width="${side}" height="${side}" fill="#ffffff"/>`)
    expect(svg).toContain('fill="#000000"')
    expect(svg).toContain('transform="scale(10)"')
    expect(svg).not.toContain('<text')
    expect(svg).not.toMatch(/currentColor|var\(/)
  })

  it('adds an escaped caption under the code', () => {
    const svg = qrSvg(url, { caption: { title: 'Claims & <refunds>', url } })
    const side = (qrMatrix(url).size + 2 * QR_QUIET_ZONE) * 8
    const height = Number(/height="(\d+)"/.exec(svg)![1])
    expect(height).toBeGreaterThan(side)
    expect(svg).toContain('Claims &amp; &lt;refunds&gt;')
    expect(svg).not.toContain('<refunds>')
    expect(svg).toContain(`>${url}</text>`)
    expect(svg).toContain('aria-label="QR code: Claims &amp; &lt;refunds&gt;"')
    expect(escapeXml(`"'`)).toBe('&quot;&apos;')
  })

  it('refuses text too long for a QR code', () => {
    expect(() => qrMatrix('x'.repeat(5000))).toThrow()
  })
})

describe('the forms.qr read', () => {
  const ctx = (supabase: any, tenantId = TENANT): ServiceContext => ({ supabase, db: supabase, tenantId, actorId: null, permissions: new Set(), authKind: 'session', source: 'ui' } as any)
  const db = () => createMemorySupabase({ forms: [{ id: FORM, tenant_id: TENANT, name: 'Expense claim — start form' }, { id: OTHER, tenant_id: TENANT_B, name: 'Other' }] } as any)

  it('returns the link and both SVGs for a form of the workspace', async () => {
    const out = await getFormQrCode(ctx(db()), FORM)
    expect(out.url).toMatch(new RegExp(`^https?://[^/]+/f/${FORM}$`))
    expect(out.name).toBe('Expense claim — start form')
    expect(out.svg).toContain('fill="#000000"')
    expect(out.captioned_svg).toContain('Expense claim — start form')
    expect(out.captioned_svg).toContain(out.url)
  })

  it('does not draw another workspace\'s form', async () => {
    await expect(getFormQrCode(ctx(db()), OTHER)).rejects.toMatchObject({ status: 404 })
    await expect(getFormQrCode(ctx(db()), 'not-a-uuid')).rejects.toMatchObject({ status: 400 })
  })
})
