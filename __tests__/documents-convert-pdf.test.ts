import { describe, expect, it } from 'vitest'
import { convertDocument } from '@/lib/documents/convert'
import { readDocument } from '@/lib/documents/read'
import { extractPages, fillForm, mergePdfs, pageCount, parsePageRanges, readFormFields, renderPdf, rotatePages, splitPdf, watermarkPdf } from '@/lib/documents/pdf-tools'
import { MARKDOWN, invoicePdf, ordersXlsx, richDocx } from './helpers/document-fixtures'

/** Convert document round trips and the PDF tools. */

const text = (u: Uint8Array) => new TextDecoder().decode(u)

describe('convert', () => {
  it('DOCX → Markdown / HTML / text / PDF / DOCX', async () => {
    const md = await convertDocument(richDocx(), 'a.docx', 'markdown')
    expect(md).toMatchObject({ extension: 'md', mime_type: 'text/markdown', engine: 'builtin' })
    expect(text(md.bytes)).toContain('# Supply Agreement')
    const html = text((await convertDocument(richDocx(), 'a.docx', 'html')).bytes)
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<h1>Supply Agreement</h1>')
    expect(text((await convertDocument(richDocx(), 'a.docx', 'text')).bytes)).toContain('Northwind Traders')
    const pdf = await convertDocument(richDocx(), 'a.docx', 'pdf')
    expect(pdf.warnings.join(' ')).toMatch(/DOCUMENT_CONVERTER_URL/)
    const back = await readDocument(pdf.bytes, 'a.pdf', null)
    expect(back.text).toContain('Supply Agreement')
    expect(back.text).toContain('The term is 24 months.')
    const docx = await convertDocument(richDocx(), 'a.docx', 'docx')
    expect((await readDocument(docx.bytes, 'b.docx', null)).structure.headings[0].text).toBe('Supply Agreement')
  })

  it('Markdown → HTML (sanitised) / DOCX / PDF and HTML → Markdown', async () => {
    const html = text((await convertDocument(Buffer.from(MARKDOWN), 'n.md', 'html')).bytes)
    expect(html).toContain('<strong>bold</strong>')
    expect(html).not.toMatch(/<script|onerror/i)
    const docx = await convertDocument(Buffer.from(MARKDOWN), 'n.md', 'docx')
    const r = await readDocument(docx.bytes, 'n.docx', null)
    expect(r.structure.headings.map((h) => h.text)).toEqual(['Release notes', 'Prices'])
    expect(r.rows).toEqual([{ Product: 'Chai', Price: '18.00' }, { Product: 'Chang', Price: '19.00' }])
    const pdf = await convertDocument(Buffer.from(MARKDOWN), 'n.md', 'pdf')
    expect((await readDocument(pdf.bytes, 'n.pdf', null)).text).toContain('Release notes')
    const md = text((await convertDocument(Buffer.from('<h2>Hi</h2><p>A <em>b</em> <a href="https://x.example">c</a></p><ul><li>one</li></ul>'), 'p.html', 'markdown')).bytes)
    expect(md).toBe('## Hi\n\nA *b* [c](https://x.example)\n\n- one\n')
  })

  it('XLSX ↔ CSV / JSON; CSV → XLSX; JSON rows → CSV', async () => {
    const csv = text((await convertDocument(await ordersXlsx(), 'o.xlsx', 'csv', { sheet: 'Customers' })).bytes)
    expect(csv).toBe('CustomerID,CompanyName\r\nVINET,Vins et alcools Chevalier')
    const json = JSON.parse(text((await convertDocument(await ordersXlsx(), 'o.xlsx', 'json', { sheet: 'Orders' })).bytes))
    expect(json[0]).toMatchObject({ OrderID: 10248, Total: 168 })
    const xlsx = await convertDocument(Buffer.from('sku,qty\nA1,2\nB2,5\n'), 'i.csv', 'xlsx')
    expect((await readDocument(xlsx.bytes, 'i.xlsx', null)).rows).toEqual([{ sku: 'A1', qty: 2 }, { sku: 'B2', qty: 5 }])
    const fromJson = text((await convertDocument(Buffer.from('[{"a":1,"b":"=SUM(1)"},{"a":2,"c":true}]'), 'r.json', 'csv')).bytes)
    expect(fromJson).toBe("a,b,c\r\n1,'=SUM(1),\r\n2,,true") // formula injection neutralised
  })

  it('refuses what it cannot do', async () => {
    await expect(convertDocument(Buffer.from('just text'), 't.txt', 'csv')).rejects.toThrow(/no table/)
    await expect(convertDocument(richDocx(), 'a.docx', 'pdf', { engine: 'external' })).rejects.toThrow(/DOCUMENT_CONVERTER_URL/)
  })
})

describe('PDF tools', () => {
  it('page ranges', () => {
    expect(parsePageRanges('1-3, 5, 8-', 9)).toEqual([0, 1, 2, 4, 7, 8])
    expect(parsePageRanges('', 3)).toEqual([0, 1, 2])
    expect(parsePageRanges('3-1', 3)).toEqual([2, 1, 0])
    expect(parsePageRanges('last', 4)).toEqual([3])
    expect(() => parsePageRanges('a-b', 3)).toThrow(/Invalid page range/)
  })

  it('merge, extract, split, count, rotate', async () => {
    const inv = await invoicePdf()
    const one = await renderPdf([{ type: 'paragraph', inlines: [{ text: 'Cover page' }] }])
    const merged = await mergePdfs([{ name: 'cover.pdf', bytes: one.bytes }, { name: 'invoice.pdf', bytes: inv }])
    expect(merged.pages).toBe(3)
    const read = await readDocument(merged.bytes, 'm.pdf', null)
    expect((read.structure.pages as Array<{ text: string }>).map((p) => p.text.split('\n')[0])).toEqual(['Cover page', 'Invoice INV-2026-0042', 'Page two: terms and conditions apply.'])
    const ex = await extractPages(merged.bytes, '3')
    expect(await pageCount(ex.bytes)).toBe(1)
    const parts = await splitPdf(merged.bytes, { everyN: 2 })
    expect(parts.map((p) => [p.range, p.pages])).toEqual([['1-2', 2], ['3-3', 1]])
    const byRanges = await splitPdf(merged.bytes, { ranges: '1; 2-3' })
    expect(byRanges.map((p) => p.pages)).toEqual([1, 2])
    const rotated = await rotatePages(one.bytes, 90)
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    expect((await PDFDocument.load(rotated)).getPage(0).getRotation().angle).toBe(90)
  })

  it('watermark / stamp text shows up in the page text', async () => {
    const r = await watermarkPdf(await invoicePdf(), { text: 'CONFIDENTIAL', pages: '1' })
    expect(r.pages).toBe(1)
    const pages = (await readDocument(r.bytes, 'w.pdf', null)).structure.pages as Array<{ text: string }>
    expect(pages[0].text).toContain('CONFIDENTIAL')
    expect(pages[1].text).not.toContain('CONFIDENTIAL')
    const stamp = await watermarkPdf(await invoicePdf(), { text: 'Approved — Nancy ✓', position: 'top-right' })
    expect(stamp.warnings).toEqual([])
    expect(((await readDocument(stamp.bytes, 's.pdf', null)).structure.pages as Array<{ text: string }>)[1].text).toContain('Approved — Nancy v')
  })

  it('fill and read AcroForm fields; flatten; strict', async () => {
    const before = await readFormFields(await invoicePdf())
    expect(before).toEqual([
      { name: 'approver', type: 'text', value: 'Nancy Davolio', read_only: false, required: false },
      { name: 'approved', type: 'checkbox', value: false, read_only: false, required: false },
    ])
    const filled = await fillForm(await invoicePdf(), { approver: 'Andrew Fuller', approved: 'yes', nope: 1 })
    expect(filled.filled).toEqual(['approver', 'approved'])
    expect(filled.missing).toEqual(['nope'])
    expect(await readFormFields(filled.bytes)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'approver', value: 'Andrew Fuller' }),
      expect.objectContaining({ name: 'approved', value: true }),
    ]))
    const flat = await fillForm(await invoicePdf(), { approver: 'Margaret' }, { flatten: true })
    expect(await readFormFields(flat.bytes)).toEqual([])
    await expect(fillForm(await invoicePdf(), { nope: 1 }, { strict: true })).rejects.toThrow(/no field named "nope"/)
  })

  it('non-Latin text is replaced, with a warning', async () => {
    const r = await renderPdf([{ type: 'paragraph', inlines: [{ text: 'Tokyo 東京' }] }])
    expect(r.warnings.join(' ')).toMatch(/Latin only/)
  })
})
