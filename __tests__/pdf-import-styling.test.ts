import { describe, expect, it, vi } from 'vitest'
import { analyzePdf, STYLING_IMAGE_CAPS } from '@/lib/importers/pdf/analyze'
import { buildForms, type BuildOptions } from '@/lib/importers/pdf/build'
import { pdfReport } from '@/lib/importers/pdf/report'
import { pdfOptions, styleOptionsOf } from '@/lib/importers/pdf/importer'
import { publicPdfSummary } from '@/lib/importers/pdf/public-summary'
import { DEFAULT_STYLE_OPTIONS, headingSize, imageAlign, imageWidth, planStyling, plainText, type StyleOptions } from '@/lib/importers/pdf/style-plan'
import { deriveTheme, mapPdfFont, pdfFontFamily } from '@/lib/importers/pdf/theme'
import { colorArg, boxThrough, pixelsOf } from '@/lib/importers/pdf/graphics'
import { STYLING_LIMITS } from '@/lib/importers/pdf/styling'
import { blockingFormThemeIssues, parseFormThemeOverrides } from '@/lib/forms/form-theme'
import { contrastRatio } from '@/lib/theme/colors'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { fieldDefinitionProblems, normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { validateFormContent } from '@/lib/services/forms'
import { makeStyledFixture } from './fixtures/pdf-styling'
import { makeAcroFormFixture } from './fixtures/pdf-forms'

const opts = { fileName: 'membership.pdf', hash: 'a'.repeat(64) }
const rowsOf = (layout: { rows: Array<{ cells: Array<{ field_key: string }>; section?: string }>; pages?: Array<{ rows: Array<{ cells: Array<{ field_key: string }>; section?: string }> }> }) => layout.pages ? layout.pages.flatMap((p) => p.rows) : layout.rows
const order = (layout: Parameters<typeof rowsOf>[0]) => rowsOf(layout).flatMap((r) => r.cells.map((c) => c.field_key))
const byType = (fields: TaskFieldDef[], type: string) => fields.filter((f) => f.type === type)
const build = (analysis: Awaited<ReturnType<typeof analyzePdf>>, style: StyleOptions | null = DEFAULT_STYLE_OPTIONS, extra: Partial<BuildOptions> = {}) =>
  buildForms(analysis.model, { ...opts, ...(style && analysis.styling ? { styling: analysis.styling, style } : {}), ...extra })

describe('PDF importer: styling and images', async () => {
  const bytes = await makeStyledFixture()
  const styled = await analyzePdf(bytes, 'membership.pdf', undefined, { styling: { images: 'full' } })
  const plainRead = await analyzePdf(bytes, 'membership.pdf')
  const s = styled.styling!

  it('reads styling only when asked: the plain analysis is unchanged', () => {
    expect(plainRead.styling).toBeUndefined()
    expect(s).toBeDefined()
    expect(styled.model.items.map((i) => i.id)).toEqual(plainRead.model.items.map((i) => i.id))
  })

  it('extracts the images, dedupes the repeated logo and classifies logo / figure / background', () => {
    expect(s.images).toHaveLength(3)
    const logo = s.images.find((i) => i.role === 'logo')!
    expect(logo).toMatchObject({ page: 1, pages: [1, 2] })
    expect(logo.why).toMatch(/top of page 1, repeated on 2 pages/)
    expect(logo.src).toMatch(/^data:image\/png;base64,/)
    expect(s.images.find((i) => i.role === 'figure')).toMatchObject({ page: 1 })
    expect(s.images.find((i) => i.role === 'background')).toMatchObject({ page: 2 })
    expect(s.images.find((i) => i.role === 'background')!.why).toMatch(/page background/)
    // Re-encoded PNGs: a PNG signature, and no ancillary chunks (tEXt / eXIf / iTXt) survive.
    const png = Buffer.from(logo.src!.split(',')[1], 'base64')
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(png.includes(Buffer.from('tEXt'))).toBe(false)
    expect(png.includes(Buffer.from('eXIf'))).toBe(false)
  })

  it('finds the header band, the title, headings, the instruction paragraph, the divider and the repeated footer', () => {
    expect(s.header).toMatchObject({ title: 'Membership Application', logo: s.images.find((i) => i.role === 'logo')!.id, banner: '#1f408f' })
    const kinds = s.texts.map((t) => [t.kind, t.text])
    expect(kinds).toContainEqual(['heading', 'About you'])
    expect(kinds).toContainEqual(['heading', 'Your membership'])
    expect(kinds).toContainEqual(['heading', 'Payment'])
    expect(kinds).toContainEqual(['paragraph', 'Please complete every question in black ink. Your answers are kept private and are used only to process your application.'])
    // Field labels never become static text.
    expect(s.texts.some((t) => /^(Full name|Email|Membership type|Start date|Amount \(USD\))$/.test(t.text))).toBe(false)
    const footer = s.texts.filter((t) => t.kind === 'page_footer')
    expect(footer).toHaveLength(2)
    expect(footer[0].pages).toEqual([1, 2])
    // The title repeated in page 2's band is a page header, not text.
    expect(s.texts.find((t) => t.page === 2 && t.text === 'Membership Application')?.kind).toBe('page_header')
    expect(s.rules).toEqual([expect.objectContaining({ page: 1, y: 680 })])
    const heading = s.texts.find((t) => t.text === 'About you')!
    expect(heading).toMatchObject({ bold: true, color: '#1f408f', level: 1 })
  })

  it('derives a theme: the band colour as accent and banner, Helvetica → Arimo, AA contrast, accepted by the forms service', () => {
    const theme = s.theme!
    expect(theme.overrides.colors?.light?.accent).toBe('#1f408f')
    expect(theme.overrides.header).toEqual({ enabled: false, banner_color: '#1f408f' })
    expect(theme.overrides.font).toEqual({ source: 'google', family: 'Arimo' })
    expect(contrastRatio('#ffffff', theme.overrides.colors!.light!.accent!)).toBeGreaterThanOrEqual(4.5)
    expect(blockingFormThemeIssues(theme.overrides)).toEqual([])
    expect(parseFormThemeOverrides(theme.overrides)).toEqual(theme.overrides)
  })

  it('builds the form: sections from headings, text / divider / image elements in the PDF order, the header and the theme', () => {
    const result = build(styled)
    expect(result.forms).toHaveLength(1)
    const form = result.forms[0]
    // Inputs are counted without the display elements.
    expect(form.counts.fields).toBe(6)
    expect(form.display).toEqual({ headings: 0, texts: 2, dividers: 1, images: 1 })
    expect(form.layout.sections?.map((x) => [x.title, x.style])).toEqual([['About you', 'plain'], ['Your membership', 'plain'], ['Payment', 'plain']])
    const keys = order(form.layout)
    const note = byType(form.fields, 'label').find((f) => String(f.default).startsWith('Please complete'))!
    const image = byType(form.fields, 'display_image')[0]
    const divider = byType(form.fields, 'divider')[0]
    expect(note.label_config).toMatchObject({ hide_caption: true })
    // Divider and instructions above the first field, the figure between Start date and the legal text, the signature last on page 1.
    expect(keys.indexOf(divider.key)).toBeLessThan(keys.indexOf(note.key))
    expect(keys.indexOf(note.key)).toBeLessThan(keys.indexOf('full_name'))
    expect(keys.indexOf('start_date')).toBeLessThan(keys.indexOf(image.key))
    expect(keys.indexOf(image.key)).toBeLessThan(keys.indexOf('signature'))
    expect(image.display_image).toMatchObject({ alt: 'Image from page 1 of the PDF', align: 'center' })
    expect(image.display_image!.src).toMatch(/^data:image\/png;base64,/)
    // Elements join the section around them.
    const sectionOf = (key: string) => rowsOf(form.layout).find((r) => r.cells.some((c) => c.field_key === key))?.section
    expect(sectionOf(note.key)).toBe(sectionOf('full_name'))
    expect(sectionOf(image.key)).toBe(sectionOf('start_date'))
    // Steps keep the section titles.
    expect(form.layout.pages?.map((p) => p.title)).toEqual(['Page 1', 'Payment'])
    expect(form.header).toMatchObject({ enabled: true, image: 'upload', title: 'Membership Application', banner: true, image_alt: 'Membership Application logo' })
    expect(form.header!.image_url).toMatch(/^data:image\/png;base64,/)
    expect(form.theme).toEqual(s.theme!.overrides)
    // The small legal text keeps a smaller size.
    expect(byType(form.fields, 'label').find((f) => String(f.default).startsWith('By signing'))?.text_style).toEqual({ value: { size: 'sm' } })
  })

  it('is a valid form definition (fields, layout, validation) once images are stored', () => {
    const form = build(styled).forms[0]
    expect(fieldDefinitionProblems(form.fields)).toEqual({})
    const keys = form.fields.map((f) => f.key)
    expect(normalizeFormLayout(form.layout, keys)).not.toBeNull()
    expect(new Set(order(form.layout))).toEqual(new Set(keys))
    // As the import stores it: data: images replaced by stored references.
    const stored = form.fields.map((f) => (f.type === 'display_image' ? { ...f, display_image: { ...f.display_image!, src: 'storage://task-files/form-images/t/x.png' } } : f))
    expect(() => validateFormContent({ fields: stored, layout: form.layout, theme: { source: 'custom', overrides: form.theme } })).not.toThrow()
    expect(normalizeTaskFields(stored).find((f) => f.type === 'display_image')?.display_image?.src).toBe('storage://task-files/form-images/t/x.png')
  })

  it('keeps the footer once when asked, and leaves the backgrounds out unless asked', () => {
    const plain = build(styled).forms[0]
    expect(plain.fields.some((f) => /Form MA-1/.test(String(f.default ?? '')))).toBe(false)
    const withFooter = build(styled, { ...DEFAULT_STYLE_OPTIONS, footer: true }).forms[0]
    const footer = withFooter.fields.filter((f) => /Form MA-1/.test(String(f.default ?? '')))
    expect(footer).toHaveLength(1)
    expect(order(withFooter.layout).at(-1)).toBe(footer[0].key)
    expect(byType(plain.fields, 'display_image')).toHaveLength(1)
    const withBackground = build(styled, { ...DEFAULT_STYLE_OPTIONS, backgrounds: true }).forms[0]
    const images = byType(withBackground.fields, 'display_image')
    expect(images).toHaveLength(2)
    // A background is full width at the top of its page.
    const bg = images.find((f) => f.display_image!.width === 'full')!
    expect(withBackground.layout.pages![1].rows[0].cells[0].field_key).toBe(bg.key)
  })

  it('options off → the plain import as before', () => {
    const before = buildForms(plainRead.model, opts)
    const off = build(styled, { images: false, theme: false, text: false, backgrounds: false, footer: false })
    const strip = (r: typeof before) => r.forms.map((f) => ({ ...f, layout: { ...f.layout, source: undefined } }))
    expect(strip(off)).toEqual(strip(before))
    expect(off.styling).toBeUndefined()
    expect(styleOptionsOf({ styling: false })).toBeNull()
    expect(styleOptionsOf({ styling: 'false' })).toBeNull()
    expect(styleOptionsOf({})).toEqual(DEFAULT_STYLE_OPTIONS)
    expect(pdfOptions({ styling_theme: 'workspace', styling_backgrounds: 'true' }).style).toEqual({ ...DEFAULT_STYLE_OPTIONS, theme: false, backgrounds: true })
  })

  it('each part on its own: images off, theme off (the workspace theme), text off', () => {
    const noImages = build(styled, { ...DEFAULT_STYLE_OPTIONS, images: false }).forms[0]
    expect(byType(noImages.fields, 'display_image')).toHaveLength(0)
    expect(noImages.header).toMatchObject({ image: 'none', title: 'Membership Application' })
    const noTheme = build(styled, { ...DEFAULT_STYLE_OPTIONS, theme: false }).forms[0]
    expect(noTheme.theme).toBeUndefined()
    expect(noTheme.header?.banner).toBeUndefined()
    const noText = build(styled, { ...DEFAULT_STYLE_OPTIONS, text: false }).forms[0]
    expect(byType(noText.fields, 'label')).toHaveLength(0)
    expect(byType(noText.fields, 'divider')).toHaveLength(0)
    expect(noText.layout.sections ?? []).toEqual([])
  })

  it('reports the theme, fonts, header, every image (placed / skipped and why), headings, text and skipped footers', () => {
    const built = build(styled)
    const report = pdfReport(styled.model, built, { fileName: 'membership.pdf', warnings: [] })
    const items = report.items
    const theme = items.find((i) => i.kind === 'theme')!
    expect(theme.detail).toMatch(/accent #1f408f \(from the header band\)/)
    expect(theme.detail).toMatch(/WCAG AA/)
    expect(items.find((i) => i.kind === 'font')).toMatchObject({ name: 'Helvetica', mappedTo: 'Helvetica → Arimo' })
    const images = items.filter((i) => i.kind === 'image')
    expect(images).toHaveLength(3)
    expect(images.find((i) => i.mappedTo === "The form header's image")).toBeTruthy()
    expect(images.find((i) => /Display image/.test(i.mappedTo ?? ''))).toBeTruthy()
    expect(images.find((i) => /Not brought in: covers 100% of page 2/.test(i.detail ?? ''))).toBeTruthy()
    expect(items.filter((i) => i.kind === 'heading').map((i) => i.mappedTo)).toEqual(['Section "About you" (plain)', 'Section "Your membership" (plain)', 'Section "Payment" (plain)'])
    expect(items.find((i) => i.kind === 'text' && /Repeated page footer on pages 1, 2/.test(i.detail ?? ''))).toBeTruthy()
    expect(items.find((i) => i.kind === 'header')?.detail).toMatch(/the logo, the title "Membership Application", on the header band colour #1f408f/)
    // Styling entries are information: they never lower the coverage.
    const plain = pdfReport(plainRead.model, buildForms(plainRead.model, opts), { fileName: 'membership.pdf', warnings: [] })
    expect(report.coverage.percent).toBe(plain.coverage.percent)
    expect(report.summary).toMatch(/Styling brought in: a theme from its colours and fonts, 2 images, 3 sections from its headings, 2 text blocks, 1 divider\./)
  })

  it('caps the images an import brings in and the bytes each mode carries', async () => {
    const many = await analyzePdf(await makeStyledFixture({ extraFigures: 26 }), 'many.pdf', undefined, { styling: { images: 'preview' } })
    const st = many.styling!
    const placed = st.images.filter((i) => !i.skip && i.role !== 'decoration')
    expect(placed.length).toBeLessThanOrEqual(STYLING_LIMITS.images)
    expect(st.images.some((i) => /over the 20 images/.test(i.skip ?? '') ) || st.stats.imagesSkipped > 0).toBe(true)
    const total = st.images.filter((i) => i.src).reduce((n, i) => n + i.bytes, 0)
    expect(total).toBeLessThanOrEqual(STYLING_IMAGE_CAPS.preview.totalBytes)
    for (const i of st.images) expect(i.bytes).toBeLessThanOrEqual(STYLING_IMAGE_CAPS.preview.maxBytes)
  })

  it('the public preview carries the styling with small inline images, nothing stored', async () => {
    const pub = await analyzePdf(bytes, 'membership.pdf', { maxInputBytes: 4 * 1024 * 1024, maxPages: 20, timeoutMs: 12_000 }, { styling: { images: 'public' } })
    const summary = publicPdfSummary(pub)
    expect(summary.preview?.theme?.colors?.light?.accent).toBe('#1f408f')
    expect(summary.preview?.header).toMatchObject({ title: 'Membership Application', image: 'upload' })
    expect(summary.preview!.header!.image_url).toMatch(/^data:image\/png;base64,/)
    expect(summary.styling).toMatchObject({ images: 2, sections: 3, texts: 2, dividers: 1, theme: true })
    const imgs = JSON.stringify(summary).match(/data:image\/png;base64,[A-Za-z0-9+/=]+/g) ?? []
    for (const u of imgs) expect(u.length * 0.75).toBeLessThanOrEqual(STYLING_IMAGE_CAPS.public.maxBytes + 64)
    // Counts stay field counts.
    expect(summary.counts.fields).toBe(6)
  })

  it('a black-on-white PDF in Helvetica gets no theme (the workspace theme suits it)', async () => {
    const plain = await analyzePdf(await makeStyledFixture({ plain: true }), 'plain.pdf', undefined, { styling: { images: 'preview' } })
    expect(plain.styling!.theme).toBeNull()
    expect(plain.styling!.images).toEqual([])
    const built = build(plain)
    expect(built.forms[0].theme).toBeUndefined()
    expect(built.styling!.log.find((i) => i.kind === 'theme')?.detail).toMatch(/No distinctive colours or fonts/)
  })

  it('leaves the existing fixture\'s fields, rules and labels alone with styling on', async () => {
    const pdfBytes = await makeAcroFormFixture()
    const a = await analyzePdf(pdfBytes, 'survey.pdf', undefined, { styling: { images: 'preview' } })
    const b = await analyzePdf(pdfBytes, 'survey.pdf')
    const on = build(a).forms[0]
    const offForm = buildForms(b.model, opts).forms[0]
    const inputs = (f: TaskFieldDef[]) => f.filter((x) => !['heading', 'divider', 'display_image'].includes(x.type) && !(x.type === 'label' && x.label_config?.hide_caption)).map((x) => ({ ...x, text_style: undefined }))
    expect(inputs(on.fields)).toEqual(inputs(offForm.fields))
    const rules = (r: typeof on.layout.rules) => (r ?? []).map((x) => ({ ...x, id: "" }))
    expect(rules(on.layout.rules)).toEqual(rules(offForm.layout.rules))
    // No question label became static text.
    for (const t of a.styling!.texts.filter((x) => x.kind === 'paragraph')) expect(/^\d+\./.test(t.text)).toBe(false)
  })
})

describe('PDF importer styling: the pure helpers', () => {
  it('maps PDF fonts to the closest theme font and never embeds them', () => {
    expect(pdfFontFamily('ABCDEF+Calibri-Bold')).toBe('Calibri')
    expect(pdfFontFamily('TimesNewRomanPSMT')).toBe('TimesNewRoman')
    expect(mapPdfFont('ArialMT')).toMatchObject({ theme: { source: 'google', family: 'Arimo' }, text: 'arial' })
    expect(mapPdfFont('Calibri-Bold')).toMatchObject({ theme: { source: 'google', family: 'Carlito' }, text: 'calibri' })
    expect(mapPdfFont('TimesNewRomanPSMT')).toMatchObject({ theme: { source: 'google', family: 'Tinos' } })
    expect(mapPdfFont('Courier')).toMatchObject({ theme: { source: 'google', family: 'Cousine' } })
    expect(mapPdfFont('OpenSans-SemiBold')).toMatchObject({ theme: { source: 'google', family: 'Open Sans' }, exact: true })
    expect(mapPdfFont('ZapfDingbats')).toBeNull()
    expect(mapPdfFont('FSMe-Light')).toBeNull()
  })

  it('derives a contrast-checked theme (light brand colours are darkened for white button text)', () => {
    const t = deriveTheme({ votes: [{ color: '#9cc3ff', weight: 3, source: 'the heading colour' }], banner: null, pageTint: '#fdf6e3', bodyText: '#555555', bodyFont: null, headingFont: null, baseSize: 10 })!
    const light = t.overrides.colors!.light!
    expect(light.background).toBe('#fdf6e3')
    expect(contrastRatio('#ffffff', light.accent!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.accent!, light.background!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.text!, light.background!)).toBeGreaterThanOrEqual(4.5)
    expect(t.adjusted.join(' ')).toMatch(/accent #9cc3ff → #/)
    expect(blockingFormThemeIssues(t.overrides)).toEqual([])
    expect(deriveTheme({ votes: [], banner: null, pageTint: null, bodyText: '#000000', bodyFont: mapPdfFont('Helvetica'), headingFont: null, baseSize: 10 })).toBeNull()
  })

  it('sizes and places elements relative to the PDF', () => {
    expect(headingSize(20, 10)).toBe('2xl')
    expect(headingSize(14, 10)).toBe('xl')
    expect(headingSize(12, 10)).toBe('lg')
    expect(headingSize(10, 10)).toBe('base')
    expect(imageWidth({ rect: [0, 0, 100, 10], pageWidth: 612 })).toBe('sm')
    expect(imageWidth({ rect: [0, 0, 600, 10], pageWidth: 612 })).toBe('full')
    expect(imageAlign({ rect: [256, 0, 356, 10], pageWidth: 612 })).toBe('center')
    expect(imageAlign({ rect: [500, 0, 600, 10], pageWidth: 612 })).toBe('right')
  })

  it('keeps text plain: no placeholders, no markup', () => {
    expect(plainText('Total {{form.secret}} <script>x</script>')).toBe('Total { {form.secret} } ‹script›x‹/script›')
  })

  it('reads pdf.js colours, matrices and 1-bit images', () => {
    expect(colorArg(['#1A4099'], 'rgb')).toBe('#1a4099')
    expect(colorArg([0.5], 'gray')).toBe('#808080')
    expect(colorArg([0, 0, 0, 1], 'cmyk')).toBe('#000000')
    expect(colorArg([1, 0, 0], 'rgb')).toBe('#ff0000')
    expect(boxThrough([120, 0, 0, 40, 30, 740], 0, 0, 1, 1)).toEqual([30, 740, 150, 780])
    const px = pixelsOf({ width: 8, height: 1, data: new Uint8Array([0b10100000]), kind: 1 })!
    expect(px.channels).toBe(1)
    expect([...px.data.subarray(0, 3)]).toEqual([255, 0, 255])
  })

  it('plans nothing for a flat PDF\'s text (its printed text is the questions)', () => {
    const styling = { images: [], texts: [{ id: 't1', page: 1, top: 700, bottom: 690, x0: 30, x1: 300, text: 'Your name', kind: 'paragraph' as const, size: 10, bold: false, italic: false }], rules: [], boxes: [], header: { title: null, subtitle: null, logo: null, banner: null, align: 'left' as const }, theme: null, fonts: [], labelStyles: {}, baseSize: 10, notes: [], stats: { images: 0, imagesSkipped: 0, texts: 1, skippedText: 0 } }
    const plan = planStyling({ title: 'x', kind: 'flat', pages: 1, sections: [], items: [], rules: [], notes: [] }, styling, DEFAULT_STYLE_OPTIONS)
    expect(plan.elements).toEqual([])
    expect(plan.log.find((i) => i.kind === 'text')?.detail).toMatch(/flat PDF/)
  })
})

describe('PDF importer styling: the import stores images and the theme', () => {
  it('stores display images and the logo through the form asset uploads, creates one theme, cleans up on failure', async () => {
    vi.resetModules()
    const uploads: Array<{ kind: string; type: string; size: number }> = []
    const deleted: string[][] = []
    vi.doMock('@/lib/services/uploads', () => ({
      uploadFormImage: async (_ctx: unknown, f: { type: string; bytes: Uint8Array }) => { uploads.push({ kind: 'image', type: f.type, size: f.bytes.length }); return { name: 'x.png', url: `/files/task-files/form-images/t1/${uploads.length}.png`, path: `form-images/t1/${uploads.length}.png`, size: f.bytes.length, mime_type: 'image/png', ref: `storage://task-files/form-images/t1/${uploads.length}.png` } },
      uploadFormHeaderImage: async (_ctx: unknown, f: { type: string; bytes: Uint8Array }) => { uploads.push({ kind: 'header', type: f.type, size: f.bytes.length }); return { name: 'h.png', url: '/files/task-files/form-headers/00000000-0000-0000-0000-000000000001/logo.png', path: 'form-headers/00000000-0000-0000-0000-000000000001/logo.png', size: f.bytes.length, ref: 'storage://task-files/form-headers/00000000-0000-0000-0000-000000000001/logo.png' } },
    }))
    vi.doMock('@/lib/providers/storage', () => ({ getStorageProvider: async () => ({ delete: async (_b: string, keys: string[]) => { deleted.push(keys) } }) }))
    const { pdfAssetStore } = await import('@/lib/importers/pdf/assets')
    const themes = { created: [] as string[], deletedThemes: [] as string[] }
    const store = pdfAssetStore({ tenantId: 't1' } as never, {
      createFormTheme: async (_c, input) => { themes.created.push(input.name); return { id: 'theme-1', name: input.name } as never },
      deleteFormTheme: async (_c, id) => { themes.deletedThemes.push(id) },
    })
    const a = await analyzePdf(await makeStyledFixture(), 'membership.pdf', undefined, { styling: { images: 'full' } })
    const form = buildForms(a.model, { ...opts, styling: a.styling, style: DEFAULT_STYLE_OPTIONS }).forms[0]
    // The same picture twice is stored once.
    const twice = [...form.fields, { ...byType(form.fields, 'display_image')[0], key: 'copy' }]
    const fields = await store.fields(twice)
    expect(JSON.stringify(fields)).not.toMatch(/data:image/)
    expect(fields.filter((f) => f.type === 'display_image').map((f) => f.display_image!.src)).toEqual(['storage://task-files/form-images/t1/1.png', 'storage://task-files/form-images/t1/1.png'])
    const header = await store.header(form.header!)
    expect(header.image_url).toBe('storage://task-files/form-headers/00000000-0000-0000-0000-000000000001/logo.png')
    expect(uploads.map((u) => [u.kind, u.type])).toEqual([['image', 'image/png'], ['header', 'image/png']])
    expect(await store.theme('Membership Application (PDF)', form.theme!, 'From the PDF')).toBe('theme-1')
    expect(await store.theme('again', form.theme!, '')).toBe('theme-1')
    expect(themes.created).toEqual(['Membership Application (PDF)'])
    expect(store.stored).toBe(2)
    await store.cleanup()
    expect(themes.deletedThemes).toEqual(['theme-1'])
    expect(deleted).toEqual([['form-images/t1/1.png', 'form-headers/00000000-0000-0000-0000-000000000001/logo.png']])
    vi.doUnmock('@/lib/services/uploads')
    vi.doUnmock('@/lib/providers/storage')
  })
})
