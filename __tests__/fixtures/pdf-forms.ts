/**
 * Small synthetic PDF forms for the PDF importer tests, made at test time
 * with @cantoo/pdf-lib (no downloaded government PDFs are committed).
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFPage, type PDFFont } from '@cantoo/pdf-lib'

type Ctx = { pdf: PDFDocument; page: PDFPage; font: PDFFont }

const text = (c: Ctx, s: string, x: number, y: number, size = 10) => c.page.drawText(s, { x, y, size, font: c.font })
const js = (c: Ctx, code: string) => c.pdf.context.obj({ S: 'JavaScript', JS: PDFString.of(code) })
const tooltip = (field: { acroField: { dict: { set(k: unknown, v: unknown): void } } }, tip: string) => field.acroField.dict.set(PDFName.of('TU'), PDFString.of(tip))

async function start(): Promise<Ctx> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Vehicle and household survey')
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  return { pdf, page, font }
}

/**
 * The main fixture: labels from tooltips / nearby text / names, a date and a currency
 * format, a radio with show / hide scripts and printed routing, a checkbox with an
 * if / else script, a required asterisk, a split date (DD / MM / YYYY), a Yes / No grid
 * (two boxes, one tooltip), a calculation and an untranslatable script.
 */
export async function makeAcroFormFixture(opts: { evilScript?: string } = {}): Promise<Uint8Array> {
  const c = await start()
  const form = c.pdf.getForm()
  text(c, 'Vehicle and household survey', 50, 760, 16)
  text(c, '1. Full name *', 50, 720)
  const name = form.createTextField('fullName'); name.addToPage(c.page, { x: 200, y: 715, width: 250, height: 16 })
  text(c, '2. Date of birth', 50, 690)
  const dob = form.createTextField('dob'); dob.addToPage(c.page, { x: 200, y: 685, width: 100, height: 16 })
  dob.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ F: js(c, 'AFDate_FormatEx("mm/dd/yyyy");'), K: js(c, 'AFDate_KeystrokeEx("mm/dd/yyyy");') }))
  text(c, '3. Do you own a vehicle?', 50, 660)
  const own = form.createRadioGroup('ownVehicle')
  own.addOptionToPage('Yes', c.page, { x: 200, y: 656, width: 10, height: 10 }); text(c, 'Yes', 214, 657)
  own.addOptionToPage('No', c.page, { x: 250, y: 656, width: 10, height: 10 }); text(c, 'No (If no, go to question 5)', 264, 657)
  const kids = own.acroField.getWidgets()
  kids[0].dict.set(PDFName.of('AA'), c.pdf.context.obj({ U: js(c, 'this.getField("vehicleValue").display = display.visible;\nthis.getField("vehicleType").display = display.visible;') }))
  kids[1].dict.set(PDFName.of('AA'), c.pdf.context.obj({ U: js(c, 'this.getField("vehicleValue").display = display.hidden;\nthis.getField("vehicleType").display = display.hidden;') }))
  text(c, '4. Vehicle type', 50, 630)
  const vt = form.createDropdown('vehicleType'); vt.addOptions(['Car', 'Van', 'Motorbike']); vt.addToPage(c.page, { x: 200, y: 625, width: 120, height: 16 })
  text(c, '   Estimated value', 50, 605)
  const vv = form.createTextField('vehicleValue'); vv.addToPage(c.page, { x: 200, y: 600, width: 100, height: 16 })
  vv.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ F: js(c, 'AFNumber_Format(2, 0, 0, 0, "$", true);'), V: js(c, 'AFRange_Validate(true, 0, true, 1000000);') }))
  text(c, '5. Comments', 50, 575)
  const comments = form.createTextField('comments'); comments.enableMultiline(); comments.addToPage(c.page, { x: 200, y: 520, width: 300, height: 60 })
  tooltip(comments, 'Anything else you want to tell us')
  text(c, '6. Has a pet', 50, 495)
  const pet = form.createCheckBox('hasPet'); pet.addToPage(c.page, { x: 200, y: 492, width: 10, height: 10 })
  pet.acroField.getWidgets()[0].dict.set(PDFName.of('AA'), c.pdf.context.obj({ U: js(c, 'if (event.target.value == "Yes") { this.getField("petName").display = display.visible; } else { this.getField("petName").display = display.hidden; }') }))
  text(c, '   Pet name', 50, 470)
  const pn = form.createTextField('petName'); pn.addToPage(c.page, { x: 200, y: 465, width: 150, height: 16 })
  text(c, '7. Start date', 50, 440)
  const dd = form.createTextField('start_day'); dd.setMaxLength(2); dd.addToPage(c.page, { x: 200, y: 435, width: 24, height: 16 }); tooltip(dd, 'DD')
  const mm = form.createTextField('start_month'); mm.setMaxLength(2); mm.addToPage(c.page, { x: 232, y: 435, width: 24, height: 16 }); tooltip(mm, 'MM')
  const yy = form.createTextField('start_year'); yy.setMaxLength(4); yy.addToPage(c.page, { x: 264, y: 435, width: 40, height: 16 }); tooltip(yy, 'YYYY')
  text(c, '8. Do you rent your home?', 50, 410)
  const y8 = form.createCheckBox('rent_yes'); y8.addToPage(c.page, { x: 200, y: 407, width: 10, height: 10 }); tooltip(y8, 'Do you rent your home?'); text(c, 'Yes', 214, 408)
  const n8 = form.createCheckBox('rent_no'); n8.addToPage(c.page, { x: 250, y: 407, width: 10, height: 10 }); tooltip(n8, 'Do you rent your home?'); text(c, 'No', 264, 408)
  text(c, '9. Total', 50, 380)
  const tot = form.createTextField('total'); tot.addToPage(c.page, { x: 200, y: 375, width: 100, height: 16 })
  tot.acroField.dict.set(PDFName.of('AA'), c.pdf.context.obj({ C: js(c, 'AFSimple_Calculate("SUM", new Array ("vehicleValue", "other"));'), F: js(c, opts.evilScript ?? 'event.value = util.printx("999", event.value); app.alert("custom");') }))
  const anon = form.createTextField('Text12'); anon.addToPage(c.page, { x: 450, y: 300, width: 100, height: 16 })
  const btn = form.createButton('PrintButton'); btn.addToPage('Print', c.page, { x: 450, y: 50, width: 80, height: 20 })
  return c.pdf.save()
}

/** A hybrid PDF: AcroForm fields without tooltips + an XFA template with captions, a required flag and a group. */
export async function makeHybridFixture(): Promise<Uint8Array> {
  const c = await start()
  const form = c.pdf.getForm()
  const a = form.createTextField('topmostSubform[0].Page1[0].f1_01[0]'); a.addToPage(c.page, { x: 100, y: 700, width: 200, height: 16 })
  const b = form.createTextField('topmostSubform[0].Page1[0].f1_02[0]'); b.addToPage(c.page, { x: 100, y: 660, width: 200, height: 16 })
  const boxes = ['1', '2', '3'].map((v, i) => {
    const cb = form.createCheckBox(`topmostSubform[0].Page1[0].c1_1[${i}]`)
    cb.addToPage(c.page, { x: 100 + i * 120, y: 620, width: 10, height: 10 })
    return { cb, v }
  })
  for (const { cb, v } of boxes) {
    // The "on" value of each box: 1, 2, 3 (as IRS forms do) — the on-state appearance renamed from "Yes".
    const w = cb.acroField.getWidgets()[0]
    const apDict = w.dict.lookup(PDFName.of('AP')) as unknown as { lookup(n: unknown): { get(n: unknown): unknown; set(n: unknown, v: unknown): void; delete(n: unknown): void } } | undefined
    const normal = apDict?.lookup(PDFName.of('N'))
    if (normal) { const on = normal.get(PDFName.of('Yes')); if (on) { normal.set(PDFName.of(v), on); normal.delete(PDFName.of('Yes')) } }
    const down = apDict?.lookup(PDFName.of('D'))
    if (down) { const on = down.get(PDFName.of('Yes')); if (on) { down.set(PDFName.of(v), on); down.delete(PDFName.of('Yes')) } }
  }
  text(c, 'Individual', 114, 621); text(c, 'Company', 234, 621); text(c, 'Trust', 354, 621)
  const template = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE template [ <!ENTITY boom "boom"> ]>
<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
  <subform name="topmostSubform">
    <subform name="Page1">
      <field name="f1_01"><caption><value><text>1 Name of entity/individual. An entry is required.</text></value></caption><validate nullTest="error"/></field>
      <field name="f1_02"><ui><textEdit multiLine="0"/></ui><caption><value><exData contentType="text/html"><body xmlns="http://www.w3.org/1999/xhtml"><p>2 Business <b>name</b></p></body></exData></value></caption></field>
      <draw name="q3"><value><text>3 Check the appropriate box for tax classification</text></value></draw>
      <field name="c1_1"><ui><checkButton/></ui><caption><value><text>Individual</text></value></caption><items><integer>1</integer><integer>0</integer></items></field>
      <field name="c1_1"><ui><checkButton/></ui><caption><value><text>Company</text></value></caption><items><integer>2</integer><integer>0</integer></items></field>
      <field name="c1_1"><ui><checkButton/></ui><caption><value><text>Trust</text></value></caption><items><integer>3</integer><integer>0</integer></items></field>
    </subform>
  </subform>
</template>`
  // pdf-lib drops XFA while saving a form it edits: add the packet to the saved file.
  const doc = await PDFDocument.load(await c.pdf.save(), { preserveXFA: true } as never)
  const stream = doc.context.register(doc.context.stream(template))
  const acro = doc.catalog.lookup(PDFName.of('AcroForm')) as unknown as { set(k: unknown, v: unknown): void }
  acro.set(PDFName.of('XFA'), doc.context.obj([PDFString.of('template'), stream]))
  return doc.save({ updateFieldAppearances: false })
}

/** A flat (print-only) PDF: text, no fields. */
export async function makeFlatFixture(): Promise<Uint8Array> {
  const c = await start()
  text(c, 'Household questionnaire', 50, 750, 16)
  const lines = ['1. What is your name?', '2. Do you own a car?   [ ] Yes   [ ] No  - If No, go to question 4', '3. What make is it?', '4. How many people live here?', 'Thank you for completing this questionnaire. Please return it by post to the address below.']
  lines.forEach((l, i) => text(c, l, 50, 700 - i * 30))
  return c.pdf.save()
}

/** An empty-text PDF (looks scanned). */
export async function makeBlankFixture(pages = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pages; i++) pdf.addPage([612, 792])
  return pdf.save()
}

/** N text fields with tooltips spread over pages (limits / splitting). */
export async function makeManyFieldsFixture(count: number, perPage = 40): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const form = pdf.getForm()
  let page = pdf.addPage([612, 792])
  for (let i = 0; i < count; i++) {
    if (i && i % perPage === 0) page = pdf.addPage([612, 792])
    const row = i % perPage
    const y = 760 - row * 18
    page.drawText(`Question ${i + 1}`, { x: 40, y: y + 3, size: 8, font })
    const f = form.createTextField(`q${i + 1}`)
    f.addToPage(page, { x: 200, y, width: 200, height: 14 })
    tooltip(f, `Answer ${i + 1}`)
  }
  return pdf.save()
}

/** A dynamic XFA template (no AcroForm widgets). */
export const DYNAMIC_XFA_TEMPLATE = `<?xml version="1.0"?>
<?xfa generator="AdobeLiveCycleDesigner"?>
<template xmlns="http://www.xfa.org/schema/xfa-template/3.0/">
  <subform name="form1">
    <subform name="Part1">
      <subform name="Applicant">
        <draw name="title"><value><text>Section A - About you</text></value></draw>
        <subform name="q1">
          <draw name="t"><value><text>1. Do you have a co-signer?</text></value></draw>
          <exclGroup name="CoSignerInd">
            <validate nullTest="error"/>
            <field name="Yes"><ui><checkButton shape="round"/></ui><caption><value><text>Yes</text></value></caption><items><text>Y</text></items>
              <event activity="click"><script contentType="application/x-javascript">if (!this.isNull) { form1.Part1.CoSigner.presence = "visible"; }</script></event></field>
            <field name="No"><ui><checkButton shape="round"/></ui><caption><value><text>No</text></value></caption><items><text>N</text></items>
              <event activity="click"><script contentType="application/x-javascript">form1.Part1.CoSigner.presence = "hidden";</script></event></field>
          </exclGroup>
        </subform>
        <field name="FamilyName"><ui><textEdit/></ui><caption><value><text>*Family name</text></value></caption><value><text maxChars="40"/></value></field>
        <field name="Lang"><ui><choiceList/></ui><caption><value><text>Language</text></value></caption><items><text>English</text><text>French</text></items><items save="1" presence="hidden"><text>EN</text><text>FR</text></items></field>
        <subform name="DOB">
          <field name="DOBDay"><ui><textEdit/></ui><caption><value><text>DD</text></value></caption></field>
          <field name="DOBMonth"><ui><textEdit/></ui><caption><value><text>MM</text></value></caption></field>
          <field name="DOBYear"><ui><textEdit/></ui><caption><value><text>YYYY</text></value></caption></field>
        </subform>
        <field name="Agree"><ui><checkButton/></ui><caption><value><text>I agree</text></value></caption><items><integer>1</integer><integer>0</integer></items>
          <event activity="change"><script contentType="application/x-formcalc">if ($.rawValue == 1) then Reason.presence = "hidden" else Reason.presence = "visible" endif</script></event></field>
        <field name="Reason"><ui><textEdit multiLine="1"/></ui><caption><value><text>Why not?</text></value></caption></field>
        <field name="Validate"><ui><button/></ui><caption><value><text>Validate</text></value></caption></field>
      </subform>
      <subform name="CoSigner" presence="hidden">
        <draw name="t2"><value><text>Section B - Co-signer</text></value></draw>
        <field name="CoName"><ui><textEdit/></ui><caption><value><text>Co-signer name</text></value></caption></field>
        <field name="Amount"><ui><numericEdit/></ui><caption><value><text>Amount</text></value></caption><format><picture>num{$z,zz9.99}</picture></format></field>
      </subform>
    </subform>
  </subform>
</template>`
