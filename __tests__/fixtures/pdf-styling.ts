/**
 * A synthetic styled PDF form for "Bring in styling and images" (made at
 * test time with @cantoo/pdf-lib; pictures are PNGs drawn here pixel by
 * pixel — no third-party PDFs or images):
 *
 *   page 1  a navy header band with an orange logo and the white title, a
 *           bold navy heading, a divider, a two-line instruction paragraph,
 *           Full name / Email fields, a second heading with a dropdown and a
 *           date, a figure (a chart-like picture), small legal text, a
 *           signature box, a footer "Form MA-1 (Rev. 2026) · Page 1 of 2"
 *   page 2  the same band, logo and title (repeated), a faint full-page
 *           background picture, a "Payment" heading with an amount field, the
 *           footer again
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from '@cantoo/pdf-lib'
import { encodePng } from '@/lib/documents/pdf'

const NAVY = rgb(0.12, 0.25, 0.56)

/** A w×h RGB PNG painted by `paint(x, y) → [r, g, b]`. */
export async function pixelPng(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Promise<Uint8Array> {
  const data = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); data.set([r, g, b], (y * w + x) * 3) }
  return new Uint8Array(await encodePng(data, w, h, 3))
}

export interface StyledFixtureOptions {
  /** Leave out the header band, colours and pictures (a plain black-on-white form). */
  plain?: boolean
  /** Extra copies of the figure (distinct pictures) — the images cap. */
  extraFigures?: number
}

export async function makeStyledFixture(opts: StyledFixtureOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Membership Application')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const form = pdf.getForm()
  // An orange logo with a white bar (brand colour #e0701c).
  const logo = await pdf.embedPng(await pixelPng(120, 60, (x, y) => (y > 26 && y < 34 && x > 10 && x < 110 ? [255, 255, 255] : [224, 112, 28])))
  // A chart-like figure: green bars on white.
  const figure = await pdf.embedPng(await pixelPng(200, 120, (x, y) => (x % 40 < 24 && y > 120 - ((x / 40 | 0) + 1) * 22 ? [40, 140, 70] : [255, 255, 255])))
  // A faint grey background with a soft pattern.
  const background = await pdf.embedPng(await pixelPng(153, 198, (x, y) => { const v = 236 + ((x + y) % 12); return [v, v, v] }))
  const extras: PDFImage[] = []
  for (let i = 0; i < (opts.extraFigures ?? 0); i++) extras.push(await pdf.embedPng(await pixelPng(64, 48, (x, y) => [(i * 37) % 255, (x * 3) % 255, (y * 5 + i) % 255])))

  const band = (page: PDFPage) => {
    if (opts.plain) { page.drawText('Membership Application', { x: 150, y: 752, size: 20, font: bold }); return }
    page.drawRectangle({ x: 0, y: 722, width: 612, height: 70, color: NAVY })
    page.drawImage(logo, { x: 30, y: 735, width: 96, height: 48 })
    page.drawText('Membership Application', { x: 150, y: 752, size: 20, font: bold, color: rgb(1, 1, 1) })
  }
  const footer = (page: PDFPage, n: number) => page.drawText(`Form MA-1 (Rev. 2026) · Page ${n} of 2`, { x: 30, y: 30, size: 8, font })
  const t = (page: PDFPage, s: string, x: number, y: number, size = 10, f: PDFFont = font, color = rgb(0, 0, 0)) => page.drawText(s, { x, y, size, font: f, color: opts.plain ? rgb(0, 0, 0) : color })

  const p1 = pdf.addPage([612, 792])
  band(p1)
  t(p1, 'About you', 30, 690, 14, bold, NAVY)
  p1.drawLine({ start: { x: 30, y: 680 }, end: { x: 582, y: 680 }, thickness: 1, color: rgb(0.5, 0.5, 0.5) })
  t(p1, 'Please complete every question in black ink. Your answers are kept private', 30, 660)
  t(p1, 'and are used only to process your application.', 30, 647)
  t(p1, 'Full name', 30, 620)
  form.createTextField('fullName').addToPage(p1, { x: 140, y: 614, width: 300, height: 18 })
  t(p1, 'Email', 30, 590)
  form.createTextField('email').addToPage(p1, { x: 140, y: 584, width: 300, height: 18 })
  t(p1, 'Your membership', 30, 550, 14, bold, NAVY)
  t(p1, 'Membership type', 30, 520)
  const type = form.createDropdown('membershipType'); type.addOptions(['Standard', 'Family', 'Student']); type.addToPage(p1, { x: 140, y: 514, width: 160, height: 18 })
  t(p1, 'Start date', 30, 490)
  form.createTextField('startDate').addToPage(p1, { x: 140, y: 484, width: 120, height: 18 })
  if (!opts.plain) p1.drawImage(figure, { x: 200, y: 300, width: 200, height: 120 })
  extras.forEach((img, i) => p1.drawImage(img, { x: 30 + (i % 8) * 70, y: 240 - Math.floor(i / 8) * 50, width: 60, height: 40 }))
  t(p1, 'By signing you agree to the terms of membership and the club rules.', 30, 200, 8)
  t(p1, 'Signature', 30, 160)
  form.createTextField('signature').addToPage(p1, { x: 140, y: 154, width: 200, height: 18 })
  footer(p1, 1)

  const p2 = pdf.addPage([612, 792])
  if (!opts.plain) p2.drawImage(background, { x: 0, y: 0, width: 612, height: 792 })
  band(p2)
  t(p2, 'Payment', 30, 690, 14, bold, NAVY)
  t(p2, 'Amount (USD)', 30, 650)
  form.createTextField('amount').addToPage(p2, { x: 140, y: 644, width: 120, height: 18 })
  footer(p2, 2)
  return pdf.save()
}
