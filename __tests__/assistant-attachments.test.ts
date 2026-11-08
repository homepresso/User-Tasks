/**
 * The Agent's attachments: type sniffed from the bytes (not the name), size
 * limits, text from PDF / Word / CSV / Excel, images as image parts for a
 * vision model (OCR or a clear note otherwise), BPMN / draw.io parsed into a
 * process outline, and the upload endpoint (signed-in, Agent available,
 * nothing stored).
 */
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentError, convertAttachment, parseBpmn, parseDrawio, outlineText } from '@/lib/assistants/attachments'
import { ATTACHMENT_LIMITS } from '@/lib/assistants/attachments-core'

/* eslint-disable @typescript-eslint/no-explicit-any */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6590000000049454e44ae426082', 'hex')

function pdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF`, 'latin1')
}

async function docx(paragraphs: string[]): Promise<Buffer> {
  const PizZip = (await import('pizzip')).default
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}

const BPMN = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d">
  <bpmn:process id="leave" name="Leave request">
    <bpmn:laneSet><bpmn:lane id="l1" name="Employee"><bpmn:flowNodeRef>start</bpmn:flowNodeRef><bpmn:flowNodeRef>submit</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="l2" name="Manager"><bpmn:flowNodeRef>approve</bpmn:flowNodeRef><bpmn:flowNodeRef>gw</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="start" name="Need leave"/>
    <bpmn:userTask id="submit" name="Submit request"/>
    <bpmn:userTask id="approve" name="Approve request"/>
    <bpmn:exclusiveGateway id="gw" name="Approved?"/>
    <bpmn:serviceTask id="record" name="HR records leave"/>
    <bpmn:endEvent id="end"/>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="submit"/>
    <bpmn:sequenceFlow id="f2" sourceRef="submit" targetRef="approve"/>
    <bpmn:sequenceFlow id="f3" sourceRef="approve" targetRef="gw"/>
    <bpmn:sequenceFlow id="f4" sourceRef="gw" targetRef="record" name="Yes"/>
    <bpmn:sequenceFlow id="f5" sourceRef="gw" targetRef="end" name="No"/>
  </bpmn:process>
</bpmn:definitions>`

const DRAWIO_MODEL = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Fill in form" style="rounded=1" vertex="1" parent="1"/><mxCell id="b" value="Approve?" style="rhombus" vertex="1" parent="1"/><mxCell id="e" value="yes" edge="1" source="a" target="b" parent="1"/></root></mxGraphModel>'

describe('type sniffing and limits', () => {
  it('trusts the bytes, not the name: a PNG named .pdf is an image; a text file named .png is text', async () => {
    const a = await convertAttachment(PNG, 'form.pdf', { vision: true })
    expect(a).toMatchObject({ kind: 'image', mime_type: 'image/png' })
    expect(a.data_url).toMatch(/^data:image\/png;base64,/)
    const t = await convertAttachment(Buffer.from('Name,Email\nA,a@x.test'), 'fake.png', { vision: true })
    expect(t.kind).toBe('text')
  })
  it('refuses unsupported types, empty files and files over the limit, with a clear message', async () => {
    await expect(convertAttachment(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'x.zip', { vision: true })).rejects.toBeInstanceOf(AttachmentError)
    await expect(convertAttachment(Buffer.alloc(0), 'e.txt', { vision: true })).rejects.toThrow(/empty/)
    await expect(convertAttachment(Buffer.alloc(ATTACHMENT_LIMITS.maxFileBytes + 1, 0x41), 'big.txt', { vision: true })).rejects.toThrow(/Larger than 10 MB/)
  })
  it('long text is truncated with a note', async () => {
    const a = await convertAttachment(Buffer.from('word '.repeat(20_000)), 'long.txt', { vision: true })
    expect(a.text!.length).toBeLessThanOrEqual(ATTACHMENT_LIMITS.maxTextChars + 20)
    expect(a.note).toMatch(/truncated/)
  })
})

describe('extraction', () => {
  it('PDF text', async () => {
    const a = await convertAttachment(pdf('Employee name required'), 'leave.pdf', { vision: true })
    expect(a).toMatchObject({ kind: 'text', mime_type: 'application/pdf' })
    expect(a.text).toContain('Employee name required')
  })
  it('Word text', async () => {
    const a = await convertAttachment(await docx(['Leave request form', 'Start date *']), 'form.docx', { vision: true })
    expect(a.text).toContain('Leave request form')
    expect(a.text).toContain('Start date *')
  })
  it('CSV and Excel (sheets as CSV)', async () => {
    const csv = await convertAttachment(Buffer.from('Field,Type\nName,text\nStart,date'), 'fields.csv', { vision: true })
    expect(csv.text).toContain('Start,date')
    const { csvToXlsx } = await import('@/lib/documents/convert')
    const xlsx = await convertAttachment(Buffer.from(await csvToXlsx('Field,Type\nName,text')), 'fields.xlsx', { vision: true })
    expect(xlsx.note).toMatch(/Excel/)
    expect(xlsx.text).toContain('Name,text')
  })
})

describe('images without a vision model', () => {
  it('OCR text when the instance has OCR', async () => {
    const ocr = vi.fn(async () => 'Full name ____  Date ____')
    const a = await convertAttachment(PNG, 'scan.png', { vision: false, ocr })
    expect(a).toMatchObject({ kind: 'text' })
    expect(a.note).toMatch(/OCR/)
  })
  it('otherwise the image is kept and the model is told it cannot read it', async () => {
    const a = await convertAttachment(PNG, 'scan.png', { vision: false, ocr: null })
    expect(a.kind).toBe('image')
    expect(a.note).toMatch(/can't read images/)
  })
})

describe('process diagrams', () => {
  it('BPMN → tasks with lanes, gateways and labelled flows', () => {
    const o = parseBpmn(BPMN)!
    expect(o.name).toBe('Leave request')
    expect(o.lanes).toEqual(['Employee', 'Manager'])
    expect(o.nodes.map((n) => `${n.kind}:${n.label}`)).toEqual(expect.arrayContaining(['userTask:Submit request', 'userTask:Approve request', 'exclusiveGateway:Approved?', 'serviceTask:HR records leave']))
    expect(o.nodes.find((n) => n.id === 'approve')!.lane).toBe('Manager')
    expect(o.flows).toContainEqual({ from: 'gw', to: 'record', label: 'Yes' })
    expect(outlineText(o)).toContain('Approve request [approve] → Approved? [gw]')
  })
  it('draw.io, plain and compressed', () => {
    const plain = parseDrawio(`<mxfile><diagram>${DRAWIO_MODEL}</diagram></mxfile>`)!
    expect(plain.nodes.map((n) => n.kind)).toEqual(['task', 'gateway'])
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(DRAWIO_MODEL))).toString('base64')
    const compressed = parseDrawio(`<mxfile><diagram id="x">${packed}</diagram></mxfile>`)!
    expect(compressed.flows).toEqual([{ from: 'a', to: 'b', label: 'yes' }])
  })
  it('a .bpmn upload becomes a process outline attachment', async () => {
    const a = await convertAttachment(Buffer.from(BPMN), 'leave.bpmn', { vision: true })
    expect(a).toMatchObject({ kind: 'text', mime_type: 'application/bpmn+xml' })
    expect(a.note).toMatch(/BPMN process: 6 steps, 5 flows/)
  })
  it('other XML is refused (and XML bombs are refused by the parser)', async () => {
    await expect(convertAttachment(Buffer.from('<?xml version="1.0"?><note><to>x</to></note>'), 'n.xml', { vision: true })).rejects.toThrow(/BPMN/)
    expect(parseBpmn('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')).toBeNull()
  })
})

describe('the upload endpoint', () => {
  it('signed-out → 401; nothing is stored (no storage client is touched)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({ getCachedUser: async () => null }))
    const { POST } = await import('@/app/api/assistants/attachments/route')
    const res = await POST(new Request('http://x/api/assistants/attachments', { method: 'POST' }) as any)
    expect(res.status).toBe(401)
    vi.doUnmock('@/lib/supabase/server')
  })

  it('a person the Agent is not available to → 403; another person\'s files are never reachable (the response carries only this request\'s files)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({ getCachedUser: async () => ({ id: 'u1' }) }))
    vi.doMock('@/lib/services/context', async (orig) => ({ ...(await orig() as any), fromSession: async () => ({ tenantId: 't1', actorId: 'u1', permissions: new Set() }) }))
    const allow = { value: null as any }
    vi.doMock('@/lib/services/assistants', () => ({ attachmentUploadOptions: async () => allow.value }))
    vi.doMock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
    const { POST } = await import('@/app/api/assistants/attachments/route')
    const body = () => { const f = new FormData(); f.append('files', new File(['Name,Email'], 'a.csv', { type: 'text/csv' })); return f }
    expect((await POST(new Request('http://x', { method: 'POST', body: body() }) as any)).status).toBe(403)
    allow.value = { vision: true, ocr: null }
    const res = await POST(new Request('http://x', { method: 'POST', body: body() }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.attachments).toHaveLength(1)
    expect(json.attachments[0]).toMatchObject({ name: 'a.csv', kind: 'text' })
    expect(json).not.toHaveProperty('id')
    expect(json.attachments[0]).not.toHaveProperty('path')
    vi.doUnmock('@/lib/supabase/server'); vi.doUnmock('@/lib/services/context'); vi.doUnmock('@/lib/services/assistants'); vi.doUnmock('@/lib/rate-limit')
  })
})
