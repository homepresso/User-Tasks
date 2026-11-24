/**
 * Synthetic PDF forms with tables of boxes for the PDF importer's table
 * detection (made at test time with @cantoo/pdf-lib; no third-party PDFs).
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib'

type Ctx = { pdf: PDFDocument; page: PDFPage; font: PDFFont }

const text = (c: Ctx, s: string, x: number, y: number, size = 9) => c.page.drawText(s, { x, y, size, font: c.font })
const js = (c: Ctx, code: string) => c.pdf.context.obj({ S: 'JavaScript', JS: PDFString.of(code) })
const tooltip = (field: { acroField: { dict: { set(k: unknown, v: unknown): void } } }, tip: string) => field.acroField.dict.set(PDFName.of('TU'), PDFString.of(tip))

async function start(size: [number, number] = [612, 792], title = 'Table form'): Promise<Ctx> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  const page = pdf.addPage(size)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  return { pdf, page, font }
}

/**
 * A hotel rooming list (landscape): Group Name / Contact Name / Arrival Date
 * (Group Name carries the PDF's Required flag), then 16 rows "Room #1" … with
 * Name 1–4, a Bed Type combo box and Special Requests/Notes — the field names
 * and tooltips of the real template (Name 1.<row>.<col>, Bed Type.<row>,
 * "Special Requests/Notes_1" on every notes box).
 */
export async function makeRoomingListFixture(opts: { rows?: number; hideScript?: 'column' | 'cell' } = {}): Promise<Uint8Array> {
  const rows = opts.rows ?? 16
  const c = await start([1008, 612], 'Hotel Rooming List Form')
  const form = c.pdf.getForm()
  text(c, 'HOTEL ROOMING LIST FORM', 372, 570, 16)
  text(c, 'Group Name:', 30, 540)
  const group = form.createTextField('Group Name'); group.addToPage(c.page, { x: 121, y: 536, width: 266, height: 17 }); group.enableRequired()
  text(c, 'Arrival Date:', 419, 540)
  const arrival = form.createTextField('Arrival Date'); arrival.addToPage(c.page, { x: 520, y: 536, width: 133, height: 17 })
  arrival.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ F: js(c, 'AFDate_FormatEx("mm/dd/yyyy");'), K: js(c, 'AFDate_KeystrokeEx("mm/dd/yyyy");') }))
  text(c, 'Contact Name:', 22, 520)
  const contact = form.createTextField('Contact Name'); contact.addToPage(c.page, { x: 121, y: 516, width: 266, height: 17 })
  text(c, 'Enter each name for each room, If room is blank it will be dropped and released from block', 254, 482)
  const cols = [{ x: 121, w: 131 }, { x: 254, w: 132 }, { x: 387, w: 132 }, { x: 520, w: 132 }]
  ;['Name 1', 'Name 2', 'Name 3', 'Name 4'].forEach((h, i) => text(c, h, cols[i].x + 43, 446))
  text(c, 'Bed Type', 662, 446)
  text(c, 'Special Requests/Notes', 787, 446)
  for (let r = 0; r < rows; r++) {
    const y = 420 - r * 22
    text(c, `Room #${r + 1}`, 50, y + 6)
    cols.forEach((col, i) => form.createTextField(`Name 1.${r}.${i}`).addToPage(c.page, { x: col.x, y, width: col.w, height: 20 }))
    const bed = form.createDropdown(`Bed Type.${r}`); bed.addOptions(['Two Queens', 'Single King']); bed.addToPage(c.page, { x: 657, y: y - 2, width: 72, height: 21 })
    const notes = form.createTextField(`Special RequestsNotes1.${r}`); notes.addToPage(c.page, { x: 734, y: y - 3, width: 255, height: 21 }); tooltip(notes, 'Special Requests/Notes_1')
  }
  if (opts.hideScript) {
    // A checkbox that hides Bed Type boxes: all of them (the whole column) or one box.
    text(c, 'No beds needed', 50, 40)
    const cb = form.createCheckBox('noBeds'); cb.addToPage(c.page, { x: 130, y: 38, width: 10, height: 10 })
    const targets = opts.hideScript === 'column' ? Array.from({ length: rows }, (_, r) => `Bed Type.${r}`) : ['Bed Type.0']
    const code = `if (event.target.value == "Yes") { ${targets.map((t) => `this.getField("${t}").display = display.hidden;`).join(' ')} } else { ${targets.map((t) => `this.getField("${t}").display = display.visible;`).join(' ')} }`
    cb.acroField.getWidgets()[0].dict.set(PDFName.of('AA'), c.pdf.context.obj({ U: js(c, code) }))
  }
  return c.pdf.save()
}

/** A table without row labels, its field names in one of the common patterns. */
export async function makeNamedGridFixture(pattern: 'rowcol' | 'sequential' | 'suffix' | 'brackets'): Promise<Uint8Array> {
  const c = await start()
  const form = c.pdf.getForm()
  text(c, 'Order form', 50, 750, 16)
  const heads = ['Item', 'Quantity', 'Colour']
  const xs = [60, 260, 360]
  const ws = [196, 96, 120]
  heads.forEach((h, i) => text(c, h, xs[i] + 2, 662))
  let n = 1
  for (let r = 0; r < 5; r++) {
    const y = 640 - r * 20
    heads.forEach((h, i) => {
      const name = pattern === 'rowcol' ? `Row${r + 1}.Col${i + 1}` : pattern === 'sequential' ? `Text${n++}` : pattern === 'suffix' ? `${h.toLowerCase()}_${r + 1}` : `Table1[0].Row[${r}].${h}[0]`
      form.createTextField(name).addToPage(c.page, { x: xs[i], y, width: ws[i], height: 18 })
    })
  }
  return c.pdf.save()
}

/** Expenses: Description | Amount × 5 rows, a Total field that adds up the Amount column (AFSimple_Calculate SUM). */
export async function makeExpensesFixture(): Promise<Uint8Array> {
  const c = await start([612, 792], 'Expense claim')
  const form = c.pdf.getForm()
  text(c, 'Expense claim', 50, 750, 16)
  text(c, 'Your name', 50, 712)
  form.createTextField('claimant').addToPage(c.page, { x: 150, y: 708, width: 200, height: 16 })
  text(c, 'Description', 62, 662)
  text(c, 'Amount', 362, 662)
  const amounts: string[] = []
  for (let r = 0; r < 5; r++) {
    const y = 640 - r * 20
    form.createTextField(`desc${r + 1}`).addToPage(c.page, { x: 60, y, width: 296, height: 18 })
    const amt = form.createTextField(`amount${r + 1}`); amt.addToPage(c.page, { x: 360, y, width: 100, height: 18 })
    amt.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ F: js(c, 'AFNumber_Format(2, 0, 0, 0, "$", true);') }))
    amounts.push(`amount${r + 1}`)
  }
  text(c, 'Total', 300, 526)
  const total = form.createTextField('total'); total.addToPage(c.page, { x: 360, y: 520, width: 100, height: 18 })
  total.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ C: js(c, `AFSimple_Calculate("SUM", new Array (${amounts.map((a) => `"${a}"`).join(', ')}));`), F: js(c, 'AFNumber_Format(2, 0, 0, 0, "$", true);') }))
  return c.pdf.save()
}

/** A numbered list of one field ("1." … "6." left of each box) under a header. */
export async function makeSingleColumnFixture(): Promise<Uint8Array> {
  const c = await start([612, 792], 'Meeting sign-up')
  const form = c.pdf.getForm()
  text(c, 'Attendee name', 82, 662)
  for (let r = 0; r < 6; r++) {
    const y = 640 - r * 20
    text(c, `${r + 1}.`, 62, y + 5)
    form.createTextField(`attendee${r + 1}`).addToPage(c.page, { x: 80, y, width: 250, height: 18 })
  }
  return c.pdf.save()
}

/** One table over two pages: the same columns (and header) at the top of page 2. */
export async function makeTwoPageTableFixture(): Promise<Uint8Array> {
  const c = await start([612, 792], 'Inventory')
  const form = c.pdf.getForm()
  let row = 0
  const pageRows = [10, 8]
  for (const [p, count] of pageRows.entries()) {
    const page = p === 0 ? c.page : c.pdf.addPage([612, 792])
    const ctx = { ...c, page }
    text(ctx, 'Item', 62, 702)
    text(ctx, 'Serial number', 262, 702)
    text(ctx, 'Purchased', 412, 702)
    for (let r = 0; r < count; r++) {
      const y = 680 - r * 20
      row++
      form.createTextField(`item${row}`).addToPage(page, { x: 60, y, width: 196, height: 18 })
      form.createTextField(`serial${row}`).addToPage(page, { x: 260, y, width: 146, height: 18 })
      const d = form.createTextField(`bought${row}`); d.addToPage(page, { x: 410, y, width: 100, height: 18 })
      d.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ F: js(c, 'AFDate_FormatEx("mm/dd/yyyy");'), K: js(c, 'AFDate_KeystrokeEx("mm/dd/yyyy");') }))
    }
  }
  return c.pdf.save()
}

/** A normal two-column form (labels above each box): no table. */
export async function makeTwoColumnFormFixture(): Promise<Uint8Array> {
  const c = await start([612, 792], 'Contact details')
  const form = c.pdf.getForm()
  const pairs = [['First name', 'Last name'], ['Email', 'Phone'], ['City', 'State'], ['Zip code', 'Country']]
  pairs.forEach(([a, b], r) => {
    const y = 680 - r * 44
    text(c, a, 60, y + 22)
    text(c, b, 320, y + 22)
    form.createTextField(a.toLowerCase().replace(/\s+/g, '_')).addToPage(c.page, { x: 60, y, width: 240, height: 18 })
    form.createTextField(b.toLowerCase().replace(/\s+/g, '_')).addToPage(c.page, { x: 320, y, width: 240, height: 18 })
  })
  // Stacked boxes labelled at their left (no gap between rows): still separate questions.
  const left = ['Employer', 'Job title', 'Department', 'Manager']
  left.forEach((l, r) => {
    const y = 460 - r * 20
    text(c, l, 60, y + 5)
    form.createTextField(`job_${l.toLowerCase().replace(/\s+/g, '_')}`).addToPage(c.page, { x: 160, y, width: 200, height: 18 })
  })
  return c.pdf.save()
}

/** The 1040 dependents layout: each COLUMN is one dependent, rows are First name / Last name / SSN / Relationship. */
export async function makeTransposedFixture(): Promise<Uint8Array> {
  const c = await start([612, 792], 'Tax return')
  const form = c.pdf.getForm()
  const xs = [145, 253, 361, 469]
  xs.forEach((x, i) => text(c, `Dependent ${i + 1}`, x + 20, 690))
  ;['(1) First name', '(2) Last name', '(3) SSN', '(4) Relationship'].forEach((label, r) => {
    const y = 670 - r * 14
    text(c, label, 50, y + 3, 8)
    xs.forEach((x, i) => form.createTextField(`Table_Dependents.Row${r + 1}.f1_${31 + r * 4 + i}`).addToPage(c.page, { x, y, width: 106, height: 12 }))
  })
  return c.pdf.save()
}
