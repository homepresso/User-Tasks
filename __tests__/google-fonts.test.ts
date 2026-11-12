import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_FONT_FALLBACK, findGoogleFont, findGoogleFontBySlug, googleFontHref, googleFontHrefs, googleFontStack, googleFontVariant, googleFonts, isGoogleFontVariant,
} from '@/lib/fonts/google'
import {
  FONTS_BUCKET, FontFetchError, clearFontCaches, fetchGoogle, fontStatus, googleCssUrl, resolveFontsRemote, rewriteGoogleCss, seedGoogleFont, serveFontCss, serveFontFile,
  type FontServeDeps,
} from '@/lib/fonts/serve'
import type { StorageProvider } from '@/lib/providers/storage/types'
import { describeTextStyle, fontFromCss, normalizeTextFont, normalizeTextStyle, textStyleProps } from '@/lib/forms/text-style'
import { normalizeConditionalStyle, styleAttributes } from '@/lib/forms/conditional-style'
import { formFontHrefs, formGoogleFontFamilies } from '@/lib/forms/form-fonts'
import { WorkspaceThemeSchema } from '@/lib/theme/schema'
import { FormThemeOverridesSchema } from '@/lib/forms/form-theme'
import { themeFontHrefs, themeVars } from '@/lib/theme/to-css'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'

/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

describe('Google Fonts catalogue', () => {
  it('bundles every family with a category, weights and a unique slug', () => {
    const all = googleFonts()
    expect(all.length).toBeGreaterThan(1500)
    expect(new Set(all.map((f) => f.slug)).size).toBe(all.length)
    for (const f of all) {
      expect(f.family).toMatch(/^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/)
      expect(f.weights.length).toBeGreaterThan(0)
      expect(f.weights.every((w) => w >= 100 && w <= 900 && w % 100 === 0)).toBe(true)
    }
    // Most popular first.
    expect(all.slice(0, 20).map((f) => f.family)).toContain('Roboto')
  })

  it('finds families by name (any case, extra spaces) and by slug; nothing else', () => {
    expect(findGoogleFont('  open   sans ')?.family).toBe('Open Sans')
    expect(findGoogleFont('PLAYFAIR DISPLAY')?.category).toBe('serif')
    expect(findGoogleFont('Lobster')?.category).toBe('display')
    expect(findGoogleFont('Caveat')?.category).toBe('handwriting')
    expect(findGoogleFont('Fira Code')?.category).toBe('mono')
    expect(findGoogleFontBySlug('source-sans-3')?.family).toBe('Source Sans 3')
    for (const bad of ['Comic Sans MS', 'Calibri', '', 'Lato; } body { display:none', "Lato'", 'Lato\nx', '../roboto', 42, null]) {
      expect(findGoogleFont(bad)).toBeUndefined()
    }
    expect(findGoogleFontBySlug('Roboto')).toBeUndefined()
    expect(findGoogleFontBySlug('roboto/../x')).toBeUndefined()
  })

  it('one canonical stylesheet URL per family; bundled families need none', () => {
    const roboto = findGoogleFont('Roboto')!
    expect(googleFontVariant(roboto)).toBe('w1ff-i1ff')
    expect(googleFontHref('roboto')).toBe('/fonts/g/roboto/w1ff-i1ff.css')
    expect(googleFontHref('Abel')).toBe('/fonts/g/abel/w8.css') // 400 only, no italics
    expect(isGoogleFontVariant(roboto, 'w1ff-i1ff')).toBe(true)
    for (const v of ['w1ff', 'w0ff-i1ff', '400-700', 'W1FF-I1FF', 'w1ff-i1ff.css']) expect(isGoogleFontVariant(roboto, v)).toBe(false)
    expect(googleFontHref('Inter')).toBeNull()
    expect(googleFontHrefs(['Lato', 'lato', 'Inter', 'Nope', null, 'Lobster'])).toEqual([googleFontHref('Lato'), googleFontHref('Lobster')])
  })

  it('falls back by category, or to the bundled next/font variable', () => {
    expect(googleFontStack(findGoogleFont('Lora')!)).toBe(`'Lora', ${GOOGLE_FONT_FALLBACK.serif}`)
    expect(googleFontStack(findGoogleFont('Caveat')!)).toContain('cursive')
    expect(googleFontStack(findGoogleFont('Inter')!)).toBe(`var(--font-sans), ${GOOGLE_FONT_FALLBACK.sans}`)
  })
})

describe('form text styles with Google fonts', () => {
  it('stores google:<Family> in the catalogue spelling; curated stacks win for their names', () => {
    expect(normalizeTextFont('google:lato')).toBe('google:Lato')
    expect(normalizeTextFont('Lobster')).toBe('google:Lobster')
    expect(normalizeTextFont('georgia')).toBe('georgia')
    expect(normalizeTextFont('Calibri')).toBe('calibri')
    expect(normalizeTextFont('google:Nope Sans')).toBeUndefined()
    expect(normalizeTextFont("google:Lato'); } body { background:url(//x)")).toBeUndefined()
    expect(normalizeTextFont('google:')).toBeUndefined()
  })

  it('draws the family quoted with its fallback stack; describes it by name', () => {
    const style = normalizeTextStyle({ font: 'google:Playfair Display', bold: true })!
    expect(style).toEqual({ font: 'google:Playfair Display', bold: true })
    const props = textStyleProps(style)
    expect((props.style as Record<string, string>)['--ts-font']).toBe(`'Playfair Display', ${GOOGLE_FONT_FALLBACK.serif}`)
    expect(describeTextStyle(style)).toBe('Playfair Display, bold')
    // Conditional styles (set_style, row styles) take the same values.
    const cs = normalizeConditionalStyle({ tone: 'info', text: true, font: 'google:caveat' })!
    expect(cs.font).toBe('google:Caveat')
    expect((styleAttributes(cs).style as Record<string, string>)['--cs-font']).toContain("'Caveat'")
  })

  it('collects the Google fonts a form uses (fields, List columns, nested rows, rules) for its links', () => {
    const fields = [
      { key: 'a', type: 'text', text_style: { label: { font: 'google:Lato' }, value: { font: 'georgia' } } },
      { key: 'l', type: 'list', list: { columns: [{ key: 'c', type: 'text', text_style: { value: { font: 'google:Fira Code' } } }], row_styles: [{ if: {}, style: { font: 'google:Lato' } }] } },
      { key: 'r', type: 'repeating_section', repeating_section: { fields: [{ key: 'x', type: 'text', text_style: { label: { font: 'google:Caveat' } } }] } },
    ]
    const layout = { rules: [{ then: [{ type: 'set_style', targets: ['field:a'], style: { font: 'google:Lobster' } }] }] }
    expect(formGoogleFontFamilies(fields, layout)).toEqual(['Lato', 'Fira Code', 'Caveat', 'Lobster'])
    expect(formFontHrefs(fields, layout)).toEqual(['Lato', 'Fira Code', 'Caveat', 'Lobster'].map((f) => googleFontHref(f)))
    // Only normalised google: values count (a raw CSS string never becomes a link).
    expect(formGoogleFontFamilies([{ text_style: { label: { font: "google:x'); }" } } }])).toEqual([])
  })
})

describe('themes and form themes with Google fonts', () => {
  it('a workspace theme takes any catalogue family for body, display and mono; anything else is refused', () => {
    const theme: any = defaultWorkspaceTheme()
    theme.typography.sans = { source: 'google', family: 'Lato' }
    theme.typography.display = { source: 'google', family: 'Playfair Display' }
    theme.typography.mono = { source: 'google', family: 'Fira Code' }
    expect(WorkspaceThemeSchema.safeParse(theme).success).toBe(true)
    expect(themeFontHrefs(theme)).toEqual(['/fonts/g/lato/w14d-i14d.css', googleFontHref('Playfair Display'), googleFontHref('Fira Code')])
    expect(themeVars(theme, 'light')['--theme-font-sans']).toBe("'Lato', var(--font-sans), ui-sans-serif, system-ui, sans-serif")
    for (const family of ['Comic Sans MS', "Lato'; }", 'Lato\\', '']) {
      theme.typography.sans = { source: 'google', family }
      const r = WorkspaceThemeSchema.safeParse(theme)
      expect(r.success).toBe(false)
      expect(r.error!.issues[0].path.join('.')).toBe('typography.sans.family')
    }
    // The built-in default keeps its bundled fonts (no stylesheet to load).
    expect(themeFontHrefs(defaultWorkspaceTheme())).toEqual([])
  })

  it('a form mini theme takes any catalogue family for the body and heading fonts', () => {
    expect(FormThemeOverridesSchema.safeParse({ font: { source: 'google', family: 'Lobster' }, heading_font: { source: 'google', family: 'Caveat' } }).success).toBe(true)
    expect(FormThemeOverridesSchema.safeParse({ font: { source: 'google', family: 'Wingdings' } }).success).toBe(false)
  })
})

describe('InfoPath fonts', () => {
  it('maps a font Google Fonts has to that family; web-safe names keep their stacks; others are dropped', () => {
    expect(fontFromCss("'Open Sans', sans-serif")).toBe('google:Open Sans')
    expect(fontFromCss('FONT-FAMILY: x, Lato'.replace('FONT-FAMILY: ', ''))).toBe('google:Lato')
    expect(fontFromCss('Calibri')).toBe('calibri')
    expect(fontFromCss("'Segoe UI', sans-serif")).toBe('segoe_ui')
    expect(fontFromCss('Wingdings')).toBeUndefined()
    expect(fontFromCss('serif; } body { display:none')).toBeUndefined()
  })
})

/* ── The font routes ─────────────────────────────────────────────────── */

const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...new Array(60).fill(1)])
const LATO = findGoogleFont('Lato')!
const LATO_CSS = `/* latin-ext */
@font-face {
  font-family: 'Lato';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHjxAwXjeu.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Lato';
  font-style: italic;
  font-weight: 700;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/lato/v24/S6u_w4BMUTPHjxsI5wq_Gwft.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face { font-family: 'Lato'; font-weight: 400; src: url(https://evil.example/x.woff2) format('woff2'); }
@font-face { font-family: 'Lato'; font-weight: 400; src: url(https://fonts.gstatic.com/s/lato/v24/abc.ttf) format('truetype'); }
@font-face { font-family: 'Other'; font-weight: 400; src: url(https://fonts.gstatic.com/s/other/v1/abc.woff2) format('woff2'); }
@font-face { font-family: 'Lato'; font-weight: 400; unicode-range: U+0000-00FF; } body { background: red }
@font-face { font-family: 'Lato'; font-weight: expression(alert(1)); src: url(https://fonts.gstatic.com/s/lato/v24/zzz.woff2) format('woff2'); }
@import url(https://evil.example/x.css);
`

function memoryStorage() {
  const objects = new Map<string, Uint8Array>()
  const storage = {
    objects,
    put: vi.fn(async (bucket: string, key: string, body: Uint8Array) => { objects.set(`${bucket}/${key}`, body) }),
    get: vi.fn(async (bucket: string, key: string) => {
      const v = objects.get(`${bucket}/${key}`)
      return v ? { key, size: v.byteLength, contentType: null, etag: null, lastModified: null, cacheControl: null, body: new ReadableStream({ start(c) { c.enqueue(v); c.close() } }) } : null
    }),
    head: vi.fn(async (bucket: string, key: string) => (objects.has(`${bucket}/${key}`) ? { key, size: 1 } : null)),
    list: vi.fn(async (bucket: string, prefix: string) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => ({ key: k.slice(bucket.length + 1), size: 1 })), cursor: null })),
  }
  return storage
}

function upstream(overrides: Partial<Record<string, () => Response>> = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    expect(init?.redirect).toBe('error')
    if (overrides[u]) return overrides[u]!()
    if (u.startsWith('https://fonts.googleapis.com/css2?')) return new Response(LATO_CSS, { headers: { 'content-type': 'text/css; charset=utf-8' } })
    if (u.startsWith('https://fonts.gstatic.com/s/')) return new Response(WOFF2, { headers: { 'content-type': 'font/woff2' } })
    return new Response('no', { status: 404 })
  })
}

function setup(opts: { remote?: boolean; fetchImpl?: ReturnType<typeof upstream>; allow?: boolean } = {}) {
  const storage = memoryStorage()
  const fetchImpl = opts.fetchImpl ?? upstream()
  const deps: FontServeDeps = {
    storage: async () => storage as unknown as StorageProvider,
    remoteEnabled: async () => opts.remote ?? true,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    checkHost: async () => {},
    allowFetch: async () => opts.allow ?? true,
  }
  return { storage, fetchImpl, deps }
}

const cssReq = (href: string) => new Request(`https://app.example${href}`)
const variantOf = (href: string) => href.split('/')[4]

describe('font routes', () => {
  beforeEach(() => clearFontCaches())

  it('rewrites Google CSS to our own URLs from a strict grammar (other hosts, formats, families and CSS dropped)', () => {
    const { css, files } = rewriteGoogleCss(LATO_CSS, LATO)
    const v = googleFontVariant(LATO)
    expect([...files.keys()]).toEqual([
      `/fonts/g/lato/${v}/lato/v24/S6uyw4BMUTPHjxAwXjeu.woff2`,
      `/fonts/g/lato/${v}/lato/v24/S6u_w4BMUTPHjxsI5wq_Gwft.woff2`,
    ])
    expect(css).not.toMatch(/evil|gstatic|googleapis|@import|body|background|expression|truetype|Other/)
    expect(css).toContain('font-display: swap;')
    expect(css).not.toContain('font-display: block')
    expect(css).toContain('unicode-range: U+0100-02BA, U+02BD-02C5;')
    expect(css.match(/@font-face/g)).toHaveLength(2)
    expect(googleCssUrl(LATO)).toBe('https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&display=swap')
  })

  it('serves a catalogue family once fetched, from storage after that, with immutable caching', async () => {
    const { storage, fetchImpl, deps } = setup()
    const href = googleFontHref('Lato')!
    const res = await serveFontCss(cssReq(href), 'lato', `${variantOf(href)}`, deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toContain(`url(/fonts/g/lato/${googleFontVariant(LATO)}/lato/v24/`)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toBe(googleCssUrl(LATO))
    expect([...storage.objects.keys()]).toEqual([`${FONTS_BUCKET}/google-fonts/css/lato/${googleFontVariant(LATO)}.css`])
    // Memory cache, then storage (another process): no second upstream call.
    await serveFontCss(cssReq(href), 'lato', variantOf(href), deps)
    clearFontCaches()
    const again = await serveFontCss(cssReq(href), 'lato', variantOf(href), deps)
    expect(again.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // ETag revalidation.
    const etag = again.headers.get('etag')!
    const notModified = await serveFontCss(new Request(`https://app.example${href}`, { headers: { 'if-none-match': etag } }), 'lato', variantOf(href), deps)
    expect(notModified.status).toBe(304)
  })

  it('404s unknown families, bundled ones and any variant but the family\'s own — without contacting Google', async () => {
    const { fetchImpl, deps } = setup()
    for (const [slug, file] of [['comic-sans', 'w8.css'], ['inter', 'w1ff-i1ff.css'], ['lato', 'w8.css'], ['lato', '400-700.css'], ['lato', `${googleFontVariant(LATO)}.js`], ['..', 'x.css']]) {
      expect((await serveFontCss(cssReq('/x'), slug, file, deps)).status).toBe(404)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('serves only font files the stylesheet names, checked and stored', async () => {
    const { storage, fetchImpl, deps } = setup()
    const v = googleFontVariant(LATO)
    const ok = await serveFontFile(cssReq('/x'), 'lato', v, ['lato', 'v24', 'S6uyw4BMUTPHjxAwXjeu.woff2'], deps)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('font/woff2')
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(WOFF2)
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toEqual([googleCssUrl(LATO), 'https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHjxAwXjeu.woff2'])
    expect(storage.objects.has(`${FONTS_BUCKET}/google-fonts/files/lato/v24/S6uyw4BMUTPHjxAwXjeu.woff2`)).toBe(true)
    // Not in the stylesheet (another gstatic path, another family's dir, traversal): 404, nothing fetched.
    for (const seg of [['lato', 'v24', 'other.woff2'], ['roboto', 'v24', 'S6uyw4BMUTPHjxAwXjeu.woff2'], ['..', 'v24', 'x.woff2'], ['lato', 'v24', 'x.ttf'], ['lato', 'v24']]) {
      expect((await serveFontFile(cssReq('/x'), 'lato', v, seg, deps)).status).toBe(404)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // A response that isn't woff2 is refused.
    clearFontCaches()
    const bad = setup({ fetchImpl: upstream({ 'https://fonts.gstatic.com/s/lato/v24/S6u_w4BMUTPHjxsI5wq_Gwft.woff2': () => new Response('<html>', { headers: { 'content-type': 'font/woff2' } }) }) })
    expect((await serveFontFile(cssReq('/x'), 'lato', v, ['lato', 'v24', 'S6u_w4BMUTPHjxsI5wq_Gwft.woff2'], bad.deps)).status).toBe(502)
  })

  it('with remote fetching off serves only what is stored', async () => {
    const online = setup()
    const v = googleFontVariant(LATO)
    await serveFontFile(cssReq('/x'), 'lato', v, ['lato', 'v24', 'S6uyw4BMUTPHjxAwXjeu.woff2'], online.deps)
    clearFontCaches()
    const fetchImpl = upstream()
    const offline: FontServeDeps = { ...online.deps, remoteEnabled: async () => false, fetchImpl: fetchImpl as unknown as typeof fetch }
    expect((await serveFontCss(cssReq('/x'), 'lato', `${v}.css`, offline)).status).toBe(200)
    expect((await serveFontFile(cssReq('/x'), 'lato', v, ['lato', 'v24', 'S6uyw4BMUTPHjxAwXjeu.woff2'], offline)).status).toBe(200)
    // Named by the stylesheet but never stored: 404 offline (the page falls back).
    expect((await serveFontFile(cssReq('/x'), 'lato', v, ['lato', 'v24', 'S6u_w4BMUTPHjxsI5wq_Gwft.woff2'], offline)).status).toBe(404)
    const lobster = findGoogleFont('Lobster')!
    expect((await serveFontCss(cssReq('/x'), 'lobster', `${googleFontVariant(lobster)}.css`, offline)).status).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await fontStatus(offline)).toEqual({ remote: false, stored: ['Lato'] })
  })

  it('upstream guard: only the two Google hosts over https, expected types, size caps, rate limit', async () => {
    const { deps } = setup()
    await expect(fetchGoogle('http://fonts.googleapis.com/css2?family=Lato', 'css', deps)).rejects.toThrow(FontFetchError)
    await expect(fetchGoogle('https://evil.example/css2', 'css', deps)).rejects.toThrow(/only fetched from/)
    await expect(fetchGoogle('https://fonts.googleapis.com:8443/css2', 'css', deps)).rejects.toThrow(FontFetchError)
    await expect(fetchGoogle('https://user@fonts.gstatic.com/s/a/v1/b.woff2', 'font', deps)).rejects.toThrow(FontFetchError)
    await expect(fetchGoogle('https://fonts.gstatic.com/css2', 'css', deps)).rejects.toThrow(/Wrong host/)
    const html = setup({ fetchImpl: upstream({ 'https://fonts.googleapis.com/css2?x': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }) })
    await expect(fetchGoogle('https://fonts.googleapis.com/css2?x', 'css', html.deps)).rejects.toThrow(/content type/)
    const big = setup({ fetchImpl: upstream({ 'https://fonts.googleapis.com/css2?x': () => new Response('a', { headers: { 'content-type': 'text/css', 'content-length': String(5 * 1024 * 1024) } }) }) })
    await expect(fetchGoogle('https://fonts.googleapis.com/css2?x', 'css', big.deps)).rejects.toThrow(/too large/)
    const limited = setup({ allow: false })
    const res = await serveFontCss(cssReq('/x'), 'lato', `${googleFontVariant(LATO)}.css`, limited.deps)
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(limited.fetchImpl).not.toHaveBeenCalled()
    // A private address behind the Google host names is refused by the DNS check.
    const dns = setup()
    dns.deps.checkHost = async () => { throw new Error('resolves to a private address') }
    await expect(fetchGoogle('https://fonts.gstatic.com/s/a/v1/b.woff2', 'font', dns.deps)).rejects.toThrow(/private/)
    expect(dns.fetchImpl).not.toHaveBeenCalled()
  })

  it('remote switch: FONTS_REMOTE wins, then instance.fonts_remote, default on', () => {
    expect(resolveFontsRemote(undefined, undefined)).toBe(true)
    expect(resolveFontsRemote('off', true)).toBe(false)
    expect(resolveFontsRemote('true', false)).toBe(true)
    expect(resolveFontsRemote(undefined, false)).toBe(false)
    expect(resolveFontsRemote('', 'off')).toBe(false)
    expect(resolveFontsRemote(undefined, 'yes')).toBe(true)
  })

  it('seeding stores the stylesheet and every font file it names', async () => {
    const { storage, deps } = setup({ remote: false })
    const r = await seedGoogleFont('lato', deps)
    expect(r).toMatchObject({ family: 'Lato', files: 2, fetched: 2, href: googleFontHref('Lato') })
    expect([...storage.objects.keys()].filter((k) => k.endsWith('.woff2'))).toHaveLength(2)
    expect((await seedGoogleFont('Lato', deps)).fetched).toBe(0)
    await expect(seedGoogleFont('Wingdings', deps)).rejects.toThrow(/not a Google Fonts family/)
  })
})

describe('font routes under load', () => {
  beforeEach(() => clearFontCaches())
  it('concurrent first requests for a family share one upstream fetch', async () => {
    const { fetchImpl, deps } = setup()
    const v = `${googleFontVariant(LATO)}.css`
    const all = await Promise.all(Array.from({ length: 5 }, () => serveFontCss(cssReq('/x'), 'lato', v, deps)))
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
