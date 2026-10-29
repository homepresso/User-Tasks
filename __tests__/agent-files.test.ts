/**
 * Files for AI agent steps (lib/agent-files.ts, lib/agent-executor.ts):
 * payload shaping per provider (images, PDF documents, extracted text),
 * limits, text extraction (PDF, Word, Excel, PowerPoint, text), the
 * read_attached_file tool, and no file contents in what the executor
 * returns.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- payloads are free-form JSON */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import PizZip from 'pizzip'
import { agentFileProvider, AGENT_FILE_LIMITS, buildAgentFileParts, extractFileText } from '@/lib/agent-files'
import { executeAgent, type AgentConfig } from '@/lib/agent-executor'
import type { StepFile } from '@/lib/workflow-files'

afterEach(() => { vi.unstubAllGlobals() })

function pdfWith(text: string, pages = 1): Uint8Array {
  const stream = deflateSync(Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`))
  const pageObjs = Array.from({ length: pages }, () => '<< /Type /Page >>').join('\n')
  return new Uint8Array(Buffer.concat([
    Buffer.from(`%PDF-1.7\n${pageObjs}\n1 0 obj << /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
    stream,
    Buffer.from('\nendstream\nendobj\n%%EOF\n'),
  ]))
}
const file = (name: string, mime: string, bytes: Uint8Array): StepFile => ({ name, mime_type: mime, size: bytes.byteLength, bytes })
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('extractFileText', () => {
  it('reads PDF, Word, PowerPoint, Excel and text', async () => {
    expect(await extractFileText(file('a.pdf', 'application/pdf', pdfWith('Invoice total 42.50')))).toContain('Invoice total 42.50')
    const docx = new PizZip(); docx.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; co</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>')
    expect(await extractFileText(file('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx.generate({ type: 'uint8array' })))).toBe('Hello world & co\nSecond')
    const pptx = new PizZip(); pptx.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>'); pptx.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>One</a:t></a:r></a:p></p:sld>')
    expect(await extractFileText(file('d.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptx.generate({ type: 'uint8array' })))).toBe('Slide 1:\nOne\n\nSlide 2:\nTwo')
    const { buildWorkbook, workbookToBuffer } = await import('@/lib/excel')
    const xlsx = await workbookToBuffer(buildWorkbook([{ name: 'Costs', arrays: [['item', 'amount'], ['Taxi', 42.5]] }]))
    expect(await extractFileText(file('c.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Uint8Array(xlsx)))).toBe('Sheet Costs:\nitem,amount\nTaxi,42.5')
    expect(await extractFileText(file('n.csv', 'text/csv', new TextEncoder().encode('a,b\n1,2')))).toBe('a,b\n1,2')
    await expect(extractFileText(file('z.zip', 'application/zip', new Uint8Array([0x50, 0x4b, 3, 4])))).rejects.toThrow(/can't be read/)
  })
})

describe('buildAgentFileParts', () => {
  it('knows the providers by their API host', () => {
    expect(agentFileProvider('https://api.openai.com/v1')).toBe('openai')
    expect(agentFileProvider('https://acme.openai.azure.com/openai/deployments/gpt4o')).toBe('azure_openai')
    expect(agentFileProvider('https://api.anthropic.com/v1/')).toBe('anthropic')
    expect(agentFileProvider('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe('gemini')
    expect(agentFileProvider('https://api.groq.com/openai/v1')).toBe('other')
  })

  it('OpenAI: images as image_url, PDFs as file parts, other documents as text', async () => {
    const pdf = pdfWith('Scan text')
    const { parts, summary } = await buildAgentFileParts([file('p.png', 'image/png', PNG), file('s.pdf', 'application/pdf', pdf), file('n.txt', 'text/plain', new TextEncoder().encode('notes'))], 'https://api.openai.com/v1')
    expect(parts[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` } })
    expect(parts[1]).toEqual({ type: 'file', file: { filename: 's.pdf', file_data: `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}` } })
    expect(parts[2]).toEqual({ type: 'text', text: 'File "n.txt" (text/plain):\nnotes' })
    expect(summary.map((s) => s.sent_as)).toEqual(['image', 'document', 'text'])
  })

  it('Claude / Gemini / Azure: images as images, PDFs as extracted text; text-only APIs refuse images', async () => {
    for (const base of ['https://api.anthropic.com/v1/', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'https://x.openai.azure.com/openai']) {
      const { parts } = await buildAgentFileParts([file('p.png', 'image/png', PNG), file('s.pdf', 'application/pdf', pdfWith('Scan text'))], base)
      expect(parts[0].type).toBe('image_url')
      expect(parts[1]).toMatchObject({ type: 'text', text: expect.stringContaining('Scan text') })
    }
    await expect(buildAgentFileParts([file('p.png', 'image/png', PNG)], 'https://api.groq.com/openai/v1')).rejects.toThrow(/doesn't take images/)
    await expect(buildAgentFileParts([file('s.pdf', 'application/pdf', pdfWith('ok'))], 'https://api.groq.com/openai/v1')).resolves.toMatchObject({ summary: [{ sent_as: 'text' }] })
  })

  it('limits: files, image size, PDF pages, text length', async () => {
    const many = Array.from({ length: AGENT_FILE_LIMITS.maxFiles + 1 }, (_, i) => file(`${i}.txt`, 'text/plain', new TextEncoder().encode('x')))
    await expect(buildAgentFileParts(many, 'https://api.openai.com/v1')).rejects.toThrow(/at most 10 files/)
    const big = new Uint8Array(AGENT_FILE_LIMITS.maxImageBytes + 1); big.set(PNG)
    await expect(buildAgentFileParts([file('big.png', 'image/png', big)], 'https://api.openai.com/v1')).rejects.toThrow(/larger than 5 MB/)
    await expect(buildAgentFileParts([file('long.pdf', 'application/pdf', pdfWith('x', 101))], 'https://api.openai.com/v1')).rejects.toThrow(/101 pages/)
    const long = await buildAgentFileParts([file('l.txt', 'text/plain', new TextEncoder().encode('y'.repeat(AGENT_FILE_LIMITS.maxTextChars + 10)))], 'https://api.openai.com/v1')
    expect((long.parts[0] as any).text).toMatch(/truncated at 100000 characters/)
    await expect(buildAgentFileParts([file('e.txt', 'text/plain', new Uint8Array())], 'https://api.openai.com/v1')).rejects.toThrow(/no text/)
  })
})

describe('executeAgent with files', () => {
  const config: AgentConfig = { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-4o', systemPrompt: 'S', temperature: 0, maxTokens: 100, maxIterations: 3, tools: [] }
  const reply = (message: any) => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', ...message } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) })

  it('sends the parts in the user message, lets tools read the files by id, returns no contents', async () => {
    const bodies: any[] = []
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body))
      call++
      return call === 1
        ? reply({ content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_attached_file', arguments: JSON.stringify({ file_id: 'F-1' }) } }] })
        : reply({ content: 'The total is 42.50' })
    }))
    const { BUILTIN_TOOL_DEFS } = await import('@/lib/agent-executor')
    const parts = (await buildAgentFileParts([file('p.png', 'image/png', PNG)], config.baseUrl)).parts
    const result = await executeAgent({ ...config, tools: BUILTIN_TOOL_DEFS.filter((t) => t.name === 'read_attached_file') }, 'Read the receipt', {
      attachments: { parts, files: [{ id: 'f-1', name: 'receipt.pdf', mime_type: 'application/pdf', bytes: pdfWith('Total 42.50') }] },
    })
    expect(result.status).toBe('completed')
    const user = bodies[0].messages.find((m: any) => m.role === 'user')
    expect(user.content).toEqual([{ type: 'text', text: 'Read the receipt' }, parts[0]])
    expect(bodies[0].tools.map((t: any) => t.function.name)).toEqual(['read_attached_file'])
    const toolResult = JSON.parse(bodies[1].messages.find((m: any) => m.role === 'tool').content)
    expect(toolResult).toMatchObject({ name: 'receipt.pdf', text: expect.stringContaining('Total 42.50') })
    // What comes back holds names, never base64.
    expect(JSON.stringify(result.messages)).not.toContain(Buffer.from(PNG).toString('base64'))
    expect(JSON.stringify(result.messages)).toContain('[image]')
  })
})
