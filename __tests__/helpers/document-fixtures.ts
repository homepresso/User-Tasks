/**
 * Small Office / PDF / text fixtures for the document-action tests, built in
 * memory (no binaries in the repository).
 */
import PizZip from 'pizzip'
import ExcelJS from 'exceljs'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** A Word document with headings (styles), a numbered list, a table, a link, a comment and tracked changes. */
export function richDocx(): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://northwind.example/terms" TargetMode="External"/></Relationships>')
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Kop2"><w:name w:val="heading 2"/></w:style></w:styles>`)
  zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num></w:numbering>`)
  zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="Nancy Davolio" w:date="2026-10-01T09:00:00Z"><w:p><w:r><w:t>Check the term length</w:t></w:r></w:p></w:comment></w:comments>`)
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Supply Agreement</dc:title><dc:creator>Andrew Fuller</dc:creator><cp:lastModifiedBy>Nancy Davolio</cp:lastModifiedBy><dcterms:created>2026-09-01T10:00:00Z</dcterms:created><dcterms:modified>2026-10-02T11:00:00Z</dcterms:modified></cp:coreProperties>')
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>2</Pages><Application>Microsoft Office Word</Application></Properties>')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Supply Agreement</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Between </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Northwind Traders</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Exotic Liquids</w:t></w:r><w:r><w:t>. See </w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>the terms</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Kop2"/></w:pPr><w:r><w:t>Term</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">The term is </w:t></w:r><w:del w:id="1" w:author="Nancy Davolio" w:date="2026-10-02T10:00:00Z"><w:r><w:delText>12</w:delText></w:r></w:del><w:ins w:id="2" w:author="Nancy Davolio" w:date="2026-10-02T10:00:00Z"><w:r><w:t>24</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> months.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Contact: orders@northwind.example, +64 9 555 0100</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Product</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Chai</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>18.00</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Chang</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>19.00</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** An Excel workbook: a title row above the header, a formula with its computed value, a date, two sheets. */
export async function ordersXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Northwind'
  const ws = wb.addWorksheet('Orders')
  ws.getCell('A1').value = 'Northwind orders — October'
  ws.addRow([])
  ws.getRow(3).values = ['OrderID', 'Customer', 'Qty', 'UnitPrice', 'Total', 'OrderDate']
  const rows: Array<[number, string, number, number, string]> = [[10248, 'VINET', 12, 14, '2026-10-01'], [10249, 'TOMSP', 9, 18.6, '2026-10-02'], [10250, 'HANAR', 10, 7.7, '2026-10-03']]
  rows.forEach(([id, cust, qty, price, date], k) => {
    const r = 4 + k
    ws.getRow(r).values = [id, cust, qty, price, { formula: `C${r}*D${r}`, result: Math.round(qty * price * 100) / 100 } as never, new Date(`${date}T00:00:00Z`)]
  })
  const second = wb.addWorksheet('Customers')
  second.addRow(['CustomerID', 'CompanyName'])
  second.addRow(['VINET', 'Vins et alcools Chevalier'])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

function slideXml(title: string, bullets: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${bullets.map((b, k) => `<a:p><a:pPr lvl="${k % 2}"/><a:r><a:t>${b}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`
}

/** A two-slide PowerPoint deck with speaker notes on the first slide. */
export function deckPptx(): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>')
  zip.file('ppt/slides/slide1.xml', slideXml('Q3 Sales Review', ['Revenue up 12%', 'Beverages lead']))
  zip.file('ppt/slides/slide2.xml', slideXml('Next Steps', ['Expand to Oceania']))
  zip.file('ppt/slides/_rels/slide1.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>')
  zip.file('ppt/notesSlides/notesSlide1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Mention the Chai promotion</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`)
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>2</Slides></Properties>')
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** An OpenDocument text file. */
export function noteOdt(): Buffer {
  const zip = new PizZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' } as never)
  zip.file('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body><office:text><text:h text:outline-level="1">Shipping note</text:h><text:p>Ship via Speedy Express.</text:p><text:list><text:list-item><text:p>Pallet A</text:p></text:list-item></text:list></office:text></office:body></office:document-content>')
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}

/** A text PDF: a heading, paragraphs and a table, plus an AcroForm with two fields. */
export async function invoicePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle('Invoice INV-2026-0042')
  doc.setAuthor('Northwind Traders')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  const line = (text: string, x: number, y: number, size = 11) => page.drawText(text, { x, y, size, font })
  line('Invoice INV-2026-0042', 50, 780, 20)
  line('Date: 15 October 2026', 50, 740)
  line('Bill to: Exotic Liquids, accounts@exotic.example', 50, 722)
  line('Product', 50, 680); line('Qty', 250, 680); line('Amount', 400, 680)
  line('Chai', 50, 662); line('10', 250, 662); line('$180.00', 400, 662)
  line('Chang', 50, 644); line('5', 250, 644); line('$95.00', 400, 644)
  line('Total due: NZ$275.00 by 2026-11-14', 50, 600)
  const form = doc.getForm()
  const name = form.createTextField('approver')
  name.setText('Nancy Davolio')
  name.addToPage(page, { x: 50, y: 500, width: 200, height: 20 })
  const ok = form.createCheckBox('approved')
  ok.addToPage(page, { x: 300, y: 500, width: 15, height: 15 })
  const p2 = doc.addPage([595, 842])
  p2.drawText('Page two: terms and conditions apply.', { x: 50, y: 780, size: 11, font })
  return doc.save()
}

/** A one-page PDF with only an image (a "scan") of dark text on white. */
export async function scannedPdf(text = 'HELLO 42'): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const { encodePng } = await import('@/lib/documents/pdf')
  const png = await encodePng(...rasterize(text))
  const doc = await PDFDocument.create()
  const img = await doc.embedPng(png)
  const page = doc.addPage([img.width, img.height])
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
  return doc.save()
}

/** 5×7 bitmap glyphs, scaled up, as greyscale pixels (dark on white) — enough for OCR. */
export function rasterize(text: string, scale = 10): [Uint8Array, number, number, number] {
  const GLYPHS: Record<string, string[]> = {
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  }
  const chars = [...text.toUpperCase()].map((c) => GLYPHS[c] ?? GLYPHS[' '])
  const pad = 4 * scale
  const width = chars.length * 6 * scale + pad * 2
  const height = 7 * scale + pad * 2
  const px = new Uint8Array(width * height).fill(255)
  chars.forEach((g, ci) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = pad + ci * 6 * scale + c * scale + dx
        const y = pad + r * scale + dy
        px[y * width + x] = 0
      }
    }
  })
  return [px, width, height, 1]
}

export const MARKDOWN = `---
title: Release notes
author: Andrew Fuller
tags: [beverages, q3]
---
# Release notes

Some **bold** text and a [link](https://northwind.example/docs).

## Prices

| Product | Price |
|---|---|
| Chai | 18.00 |
| Chang | 19.00 |

- Item one
  - Nested item
1. First

\`\`\`js
console.log('hi')
\`\`\`

<script>alert('x')</script>
<img src="x" onerror="alert(1)">
`

export const HTML = `<!doctype html><html><head><title>Supplier page</title><meta name="author" content="Margaret Peacock"><style>p{color:red}</style><script>steal()</script></head>
<body><h1>Exotic Liquids</h1><p>Contact <a href="mailto:sales@exotic.example">sales</a> or <a href="javascript:alert(1)">click</a>.</p>
<p onclick="evil()">Line one<br>Line two</p><table><tr><th>Product</th><th>Units</th></tr><tr><td>Chai</td><td>39</td></tr></table>
<iframe src="https://evil.example"></iframe><ul><li>One</li><li>Two<ul><li>Two point one</li></ul></li></ul></body></html>`
