import { describe, expect, it } from 'vitest'
import { readDocument } from '@/lib/documents/read'
import { detectType } from '@/lib/documents/detect'
import { writeDocx } from '@/lib/documents/docx'
import { HTML, MARKDOWN, deckPptx, invoicePdf, noteOdt, ordersXlsx, richDocx } from './helpers/document-fixtures'

/**
 * Read document: every supported format → text, markdown, sanitised HTML,
 * metadata and structure (fixtures are generated in memory).
 */

describe('Read document — Word', () => {
  it('headings, list, table, link, comments, tracked changes and properties', async () => {
    const r = await readDocument(richDocx(), 'agreement.docx', null)
    expect(r.type.format).toBe('docx')
    expect(r.metadata).toMatchObject({ title: 'Supply Agreement', author: 'Andrew Fuller', last_modified_by: 'Nancy Davolio', created: '2026-09-01T10:00:00Z', pages: 2 })
    expect(r.structure.headings).toEqual([{ level: 1, text: 'Supply Agreement' }, { level: 2, text: 'Term' }])
    expect(r.markdown).toContain('# Supply Agreement')
    expect(r.markdown).toContain('**Northwind Traders**')
    expect(r.markdown).toContain('[the terms](https://northwind.example/terms)')
    expect(r.markdown).toContain('1. The term is 24 months.') // accepted view: deletion dropped
    expect(r.text).not.toContain('12 months')
    expect(r.structure.links).toEqual([{ text: 'the terms', href: 'https://northwind.example/terms' }])
    expect(r.structure.tables[0]).toMatchObject({ header: ['Product', 'Price'], records: [{ Product: 'Chai', Price: '18.00' }, { Product: 'Chang', Price: '19.00' }] })
    expect(r.rows).toEqual([{ Product: 'Chai', Price: '18.00' }, { Product: 'Chang', Price: '19.00' }])
    expect(r.structure.comments).toEqual([{ id: '0', author: 'Nancy Davolio', date: '2026-10-01T09:00:00Z', text: 'Check the term length' }])
    expect(r.structure.tracked_changes).toMatchObject({ insertions: 1, deletions: 1 })
    expect(r.metadata.words).toBeGreaterThan(20)
    expect(r.metadata.reading_time_minutes).toBe(1)
    expect(r.html).toContain('<h1>Supply Agreement</h1>')
    expect(r.html).toContain('<table>')
  })

  it('shows tracked changes when asked', async () => {
    const r = await readDocument(richDocx(), 'agreement.docx', null, { trackedChanges: 'show' })
    expect(r.text).toContain('The term is 1224 months.')
    expect(r.html).toMatch(/<s>12<\/s><u>24<\/u>/)
  })

  it('reads what the writer produces (round trip)', async () => {
    const bytes = await writeDocx([
      { type: 'heading', level: 2, inlines: [{ text: 'Delivery' }] },
      { type: 'list_item', ordered: false, level: 0, inlines: [{ text: 'Pallet' }] },
      { type: 'list_item', ordered: false, level: 1, inlines: [{ text: 'Shrink wrap' }] },
      { type: 'code', text: 'SKU-1\nSKU-2' },
    ], { title: 'Round trip' })
    const r = await readDocument(bytes, 'x.docx', null)
    expect(r.metadata.title).toBe('Round trip')
    expect(r.markdown).toBe('## Delivery\n\n- Pallet\n  - Shrink wrap\n\n```\nSKU-1\n```\n\n```\nSKU-2\n```\n')
  })
})

describe('Read document — spreadsheets', () => {
  it('Excel: header detection below a title row, typed values, computed formulas, dates, all sheets', async () => {
    const r = await readDocument(await ordersXlsx(), 'orders.xlsx', null)
    expect(r.metadata.sheets).toBe(2)
    expect(r.structure.sheet_names).toEqual(['Orders', 'Customers'])
    const orders = r.structure.sheets![0]
    expect(orders.header_row).toBe(3)
    expect(orders.headers).toEqual(['OrderID', 'Customer', 'Qty', 'UnitPrice', 'Total', 'OrderDate'])
    expect(orders.formulas).toBe(3)
    expect(r.rows[1]).toEqual({ OrderID: 10249, Customer: 'TOMSP', Qty: 9, UnitPrice: 18.6, Total: 167.4, OrderDate: '2026-10-02' })
    expect(r.rows).toHaveLength(3)
    expect(r.structure.sheets![1].rows).toEqual([{ CustomerID: 'VINET', CompanyName: 'Vins et alcools Chevalier' }])
  })

  it('Excel: a named sheet, a range and a fixed header row', async () => {
    const r = await readDocument(await ordersXlsx(), 'orders.xlsx', null, { sheet: 'Orders', range: 'B3:C5', headerRow: 'first' })
    expect(r.structure.sheets).toHaveLength(1)
    expect(r.structure.sheets![0].range).toBe('B3:C5')
    expect(r.rows).toEqual([{ Customer: 'VINET', Qty: 12 }, { Customer: 'TOMSP', Qty: 9 }])
  })

  it('CSV: quoted fields with commas, quotes and newlines; typed numbers; semicolons sniffed', async () => {
    const csv = 'id,name,notes,amount\n1,"Chai, organic","He said ""hi""",18.5\n2,Chang,"two\nlines",19\n'
    const r = await readDocument(Buffer.from(csv), 'p.csv', null)
    expect(r.rows).toEqual([{ id: 1, name: 'Chai, organic', notes: 'He said "hi"', amount: 18.5 }, { id: 2, name: 'Chang', notes: 'two\nlines', amount: 19 }])
    const semi = await readDocument(Buffer.from('a;b\n1;2\n3;4'), 'x.csv', null)
    expect(semi.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }])
  })

  it('leading zeros stay text', async () => {
    const r = await readDocument(Buffer.from('zip,code\n0123,007\n'), 'z.csv', null)
    expect(r.rows).toEqual([{ zip: '0123', code: '007' }])
  })
})

describe('Read document — PowerPoint, OpenDocument, PDF', () => {
  it('PowerPoint: slides with titles, bullets and notes; slide range', async () => {
    const r = await readDocument(deckPptx(), 'deck.pptx', null)
    expect(r.metadata.slides).toBe(2)
    expect(r.structure.slides).toMatchObject([
      { number: 1, title: 'Q3 Sales Review', notes: 'Mention the Chai promotion', text: 'Q3 Sales Review\nRevenue up 12%\nBeverages lead' },
      { number: 2, title: 'Next Steps' },
    ])
    const one = await readDocument(deckPptx(), 'deck.pptx', null, { pages: '2' })
    expect(one.structure.slides).toHaveLength(1)
    expect(one.text).toContain('Expand to Oceania')
  })

  it('OpenDocument text', async () => {
    const r = await readDocument(noteOdt(), 'note.odt', null)
    expect(r.type.format).toBe('odt')
    expect(r.markdown).toContain('# Shipping note')
    expect(r.markdown).toContain('- Pallet A')
  })

  it('PDF: text per page in reading order, metadata, form values, a table from text, page range', async () => {
    const r = await readDocument(await invoicePdf(), 'invoice.pdf', null)
    expect(r.metadata).toMatchObject({ title: 'Invoice INV-2026-0042', author: 'Northwind Traders', pages: 2, format: 'pdf' })
    const pages = r.structure.pages as Array<{ number: number; text: string; has_text_layer: boolean }>
    expect(pages).toHaveLength(2)
    expect(pages[0].has_text_layer).toBe(true)
    const lines = pages[0].text.split('\n')
    expect(lines[0]).toBe('Invoice INV-2026-0042')
    expect(lines).toContain('Chai 10 $180.00')
    expect(pages[0].text.indexOf('Date: 15 October 2026')).toBeLessThan(pages[0].text.indexOf('Total due'))
    expect(r.structure.form_fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'approver', type: 'text', value: 'Nancy Davolio' })]))
    expect(r.structure.tables[0].rows).toEqual([['Chai', '10', '$180.00'], ['Chang', '5', '$95.00']])
    expect(r.structure.tables[0].header).toEqual(['Product', 'Qty', 'Amount'])
    const second = await readDocument(await invoicePdf(), 'invoice.pdf', null, { pages: '2' })
    expect(second.text).toBe('Page two: terms and conditions apply.')
  })
})

describe('Read document — Markdown, HTML, data and text', () => {
  it('Markdown: front matter, headings, links, tables, sanitised rendered HTML', async () => {
    const r = await readDocument(Buffer.from(MARKDOWN), 'notes.md', null)
    expect(r.structure.front_matter).toEqual({ title: 'Release notes', author: 'Andrew Fuller', tags: ['beverages', 'q3'] })
    expect(r.metadata.title).toBe('Release notes')
    expect(r.metadata.author).toBe('Andrew Fuller')
    expect(r.structure.headings).toEqual([{ level: 1, text: 'Release notes' }, { level: 2, text: 'Prices' }])
    expect(r.structure.links).toEqual([{ text: 'link', href: 'https://northwind.example/docs' }])
    expect(r.rows).toEqual([{ Product: 'Chai', Price: '18.00' }, { Product: 'Chang', Price: '19.00' }])
    expect(r.html).toContain('<strong>bold</strong>')
    expect(r.html).not.toMatch(/<script|onerror|alert\(1\)/i)
  })

  it('HTML: title and meta, text, links, tables; scripts, handlers and javascript: links never survive', async () => {
    const r = await readDocument(Buffer.from(HTML), 'supplier.html', null)
    expect(r.metadata.title).toBe('Supplier page')
    expect(r.metadata.author).toBe('Margaret Peacock')
    expect(r.text).toContain('Exotic Liquids')
    expect(r.text).toContain('Line one\nLine two')
    expect(r.text).not.toContain('steal')
    expect(r.rows).toEqual([{ Product: 'Chai', Units: '39' }])
    expect(r.structure.links.map((l) => l.href)).toEqual(['mailto:sales@exotic.example', 'javascript:alert(1)'])
    expect(r.html).toContain('href="mailto:sales@exotic.example"')
    expect(r.html).not.toMatch(/javascript:|onclick|<iframe|<script|<style/i)
    expect(r.markdown).toContain('- Two\n  - Two point one')
  })

  it('JSON, YAML and XML are parsed; arrays of objects become rows', async () => {
    const json = await readDocument(Buffer.from('[{"sku":"A1","qty":2},{"sku":"B2","qty":5}]'), 'items.json', null)
    expect(json.structure.data).toEqual([{ sku: 'A1', qty: 2 }, { sku: 'B2', qty: 5 }])
    expect(json.rows).toHaveLength(2)
    const yaml = await readDocument(Buffer.from('supplier: Exotic Liquids\nproducts:\n  - Chai\n  - Chang\n'), 'cfg.yaml', null)
    expect(yaml.structure.data).toEqual({ supplier: 'Exotic Liquids', products: ['Chai', 'Chang'] })
    const xml = await readDocument(Buffer.from('<?xml version="1.0"?><order id="7"><line sku="A1">2</line><line sku="B2">5</line></order>'), 'o.xml', null)
    expect(xml.structure.data).toEqual({ order: { '@id': '7', line: [{ '@sku': 'A1', '#text': '2' }, { '@sku': 'B2', '#text': '5' }] } })
  })

  it('plain text: counts and reading time; a cap on the characters kept', async () => {
    const text = `${'word '.repeat(500)}\n\nSecond paragraph.`
    const r = await readDocument(Buffer.from(text), 'notes.txt', null, { maxChars: 1000 })
    expect(r.metadata.words).toBe(502)
    expect(r.metadata.paragraphs).toBe(2)
    expect(r.metadata.reading_time_minutes).toBe(3)
    expect(r.text).toHaveLength(1000)
    expect(r.truncated).toBe(true)
  })

  it('legacy binary Office formats fail with a clear message', async () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)])
    await expect(readDocument(ole, 'old.xls', null)).rejects.toThrow(/before 2007.*\.xlsx/)
  })
})

describe('Detect type', () => {
  it('from content, not the name', async () => {
    expect(detectType(richDocx(), 'renamed.pdf')).toMatchObject({ format: 'docx', extension_mismatch: true })
    expect(detectType(await ordersXlsx(), 'x.bin').format).toBe('xlsx')
    expect(detectType(deckPptx(), 'x').format).toBe('pptx')
    expect(detectType(await invoicePdf(), 'scan.docx')).toMatchObject({ format: 'pdf', mime_type: 'application/pdf', extension_mismatch: true })
    expect(detectType(Buffer.from('{"a":1}'), 'a.txt').format).toBe('json')
    expect(detectType(Buffer.from('a,b,c\n1,2,3\n4,5,6'), 'data').format).toBe('csv')
    expect(detectType(Buffer.from('# Title\n\n- item\n'), 'readme').format).toBe('markdown')
    expect(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), 'x').format).toBe('png')
  })
})
