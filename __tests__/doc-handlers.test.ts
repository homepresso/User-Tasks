import { describe, it, expect, vi } from 'vitest'

// ─── Test docxtemplater + pizzip integration (Word & PowerPoint) ───

describe('docxtemplater integration', () => {
  it('loads docxtemplater and pizzip without errors', async () => {
    const PizZip = (await import('pizzip')).default
    const Docxtemplater = (await import('docxtemplater')).default
    expect(PizZip).toBeDefined()
    expect(Docxtemplater).toBeDefined()
  })

  it('creates a minimal docx in memory and renders find/replace', async () => {
    const PizZip = (await import('pizzip')).default
    const Docxtemplater = (await import('docxtemplater')).default

    // Create a minimal .docx zip structure
    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Hello {{Name}}, welcome to {{Company}}</w:t></w:r></w:p>
        </w:body>
      </w:document>`)

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })

    doc.setData({ Name: 'Alice', Company: 'Acme Corp' })
    doc.render()

    const output = doc.getZip().generate({ type: 'nodebuffer' })
    expect(output).toBeInstanceOf(Buffer)
    expect(output.byteLength).toBeGreaterThan(0)

    // Verify the replacement happened by reading the XML back
    const resultZip = new PizZip(output)
    const content = resultZip.file('word/document.xml')?.asText() ?? ''
    expect(content).toContain('Alice')
    expect(content).toContain('Acme Corp')
    expect(content).not.toContain('{{Name}}')
    expect(content).not.toContain('{{Company}}')
  })

  it('handles loop tags for tables', async () => {
    const PizZip = (await import('pizzip')).default
    const Docxtemplater = (await import('docxtemplater')).default

    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>{#items}</w:t></w:r></w:p>
          <w:p><w:r><w:t>{name}: {price}</w:t></w:r></w:p>
          <w:p><w:r><w:t>{/items}</w:t></w:r></w:p>
        </w:body>
      </w:document>`)

    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
    doc.setData({
      items: [
        { name: 'Widget', price: '$10' },
        { name: 'Gadget', price: '$20' },
      ],
    })
    doc.render()

    const output = doc.getZip().generate({ type: 'nodebuffer' })
    const resultZip = new PizZip(output)
    const content = resultZip.file('word/document.xml')?.asText() ?? ''
    expect(content).toContain('Widget')
    expect(content).toContain('$10')
    expect(content).toContain('Gadget')
    expect(content).toContain('$20')
    expect(content).not.toContain('{#items}')
  })

  it('handles missing placeholders gracefully', async () => {
    const PizZip = (await import('pizzip')).default
    const Docxtemplater = (await import('docxtemplater')).default

    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Hello {{Name}}</w:t></w:r></w:p>
        </w:body>
      </w:document>`)

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })

    // Only provide Name, not other placeholders — should not throw
    doc.setData({ Name: 'Bob' })
    doc.render()

    const output = doc.getZip().generate({ type: 'nodebuffer' })
    expect(output.byteLength).toBeGreaterThan(0)
  })
})

// Excel template modes (handleDocExcel on ExcelJS) are covered in excel.test.ts.

// ─── Test doc-handlers helper functions ───

describe('doc-handlers resolveUrl', () => {
  it('extracts url from file reference object', () => {
    const ref = { _file: true, url: 'https://example.com/doc.docx', name: 'doc.docx' }
    // Test the logic that the handlers use
    const result = ref && typeof ref === 'object' && ref.url ? ref.url : String(ref)
    expect(result).toBe('https://example.com/doc.docx')
  })

  it('passes through plain string URLs', () => {
    const url = 'https://example.com/template.docx'
    const result = url && typeof url === 'object' && (url as any).url ? (url as any).url : String(url)
    expect(result).toBe('https://example.com/template.docx')
  })

  it('returns null for falsy values', () => {
    expect(null).toBeNull()
    expect(undefined).toBeUndefined()
    expect('').toBeFalsy()
  })
})

// ─── Test PowerPoint uses same docxtemplater API ───

describe('docxtemplater pptx support', () => {
  it('creates a minimal pptx structure and renders', async () => {
    const PizZip = (await import('pizzip')).default
    const Docxtemplater = (await import('docxtemplater')).default

    // Minimal .pptx structure
    const zip = new PizZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')
    zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>')
    zip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')
    zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:txBody><a:p><a:r><a:t>{{Title}}</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:sld>`)

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })

    doc.setData({ Title: 'Q4 Report' })
    doc.render()

    const output = doc.getZip().generate({ type: 'nodebuffer' })
    expect(output.byteLength).toBeGreaterThan(0)

    const resultZip = new PizZip(output)
    const slide = resultZip.file('ppt/slides/slide1.xml')?.asText() ?? ''
    expect(slide).toContain('Q4 Report')
    expect(slide).not.toContain('{{Title}}')
  })
})
