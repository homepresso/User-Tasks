/**
 * The Agent's PDF attachments: which models read PDFs themselves (the
 * capability map), the PDF sent whole (Claude `document` blocks with a cache
 * breakpoint, OpenAI `file` parts), the fallbacks for other models (text,
 * scanned pages as images, OCR, a clear "can't read scans" message), failures
 * that reach the model, size limits, and history that keeps no PDF bytes.
 * All HTTP is mocked.
 */
import { describe, expect, it, vi } from 'vitest'
import { pdfInputSupport, supportsPdfInput, NATIVE_PDF_MAX_BYTES } from '@/lib/agents/pdf-input'
import { documentBlock, toMessagesBody } from '@/lib/agents/anthropic-messages'
import { AttachmentError, convertAttachment } from '@/lib/assistants/attachments'
import { ATTACHMENT_LIMITS, ATTACH_OPEN, SCANNED_PDF_UNREADABLE, attachmentForStorage, sanitizeAttachments } from '@/lib/assistants/attachments-core'
import { buildModelMessages, promptChars, runAssistantTurn } from '@/lib/assistants/engine'
import { invoicePdf, scannedPdf } from './helpers/document-fixtures'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { ChatAttachment, ChatMessage } from '@/lib/assistants/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const claude: AssistantConnection = { provider: 'anthropic', model: 'claude-sonnet-5-5', url: 'https://api.anthropic.com/v1/chat/completions', headers: { Authorization: 'Bearer sk-ant-test' }, baseUrl: 'https://api.anthropic.com' }
const gpt: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://api.openai.com/v1/chat/completions', headers: {}, baseUrl: 'https://api.openai.com' }
const gemini: AssistantConnection = { provider: 'gemini', model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', headers: {}, baseUrl: 'https://generativelanguage.googleapis.com' }

const okChat = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
const okMessages = () => new Response(JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })

function recorder(reply: (url: string, n: number) => Response) {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return reply(String(url), calls.length)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const pdfDoc = (over: Partial<ChatAttachment> = {}): ChatAttachment => ({ name: 'reqs.pdf', mime_type: 'application/pdf', size: 1000, kind: 'document', data_url: 'data:application/pdf;base64,JVBERi0xLjQK', pages: 3, ...over })

describe('the capability map', () => {
  it('Claude reads PDFs (only over the native Messages API), with the page limit of its context window', () => {
    expect(pdfInputSupport('anthropic', 'claude-sonnet-5-5')).toEqual({ maxPages: 600, nativeOnly: true })
    expect(pdfInputSupport('anthropic', 'claude-opus-4-6')).toEqual({ maxPages: 600, nativeOnly: true })
    expect(pdfInputSupport('anthropic', 'claude-haiku-4-5')).toEqual({ maxPages: 100, nativeOnly: true })
    expect(pdfInputSupport('anthropic', 'us.anthropic.claude-fable-5-1')?.maxPages).toBe(600)
    expect(supportsPdfInput('anthropic', 'claude-sonnet-5-5', { native: true })).toBe(true)
    expect(supportsPdfInput('anthropic', 'claude-sonnet-5-5', { native: false })).toBe(false)
    expect(supportsPdfInput('anthropic', 'claude-2.1', { native: true })).toBe(false)
  })

  it('OpenAI vision models read PDFs; mini reasoning, audio and older models do not', () => {
    for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5.5', 'o1', 'o3', 'o4-mini']) expect(supportsPdfInput('openai', m), m).toBe(true)
    for (const m of ['gpt-3.5-turbo', 'o1-mini', 'o3-mini', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview']) expect(supportsPdfInput('openai', m), m).toBe(false)
  })

  it('unknown models and providers without documented PDF input count as unsupported', () => {
    expect(supportsPdfInput('gemini', 'gemini-2.5-flash')).toBe(false)
    expect(supportsPdfInput('azure_openai', 'gpt-4o')).toBe(false)
    expect(supportsPdfInput('other', 'claude-sonnet-5-5')).toBe(false)
    expect(supportsPdfInput('openai', '')).toBe(false)
  })
})

describe('the Anthropic document block', () => {
  it('a file part with a PDF data URL becomes a base64 document block (before the text), others are ignored', () => {
    expect(documentBlock({ filename: 'a.pdf', file_data: 'data:application/pdf;base64,JVBERg==' })).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' }, title: 'a.pdf' })
    expect(documentBlock({ filename: 'a.exe', file_data: 'data:application/x-msdownload;base64,AAAA' })).toBeNull()
  })

  it('cache_control sits on the newest PDF as well as the system prompt and the last block (≤ 4 breakpoints)', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'review this', attachments: [pdfDoc()] },
      { role: 'assistant', content: 'Sure.' },
      { role: 'user', content: 'and section 2?' },
    ]
    const messages = buildModelMessages('INSTR', history, { screen: 'x' }, { pdf: { native: { maxPages: 600 } } })
    const body = toMessagesBody({ model: 'claude-sonnet-5-5', messages })
    const first = (body.messages as any[])[0]
    expect(first.content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' }, title: 'reqs.pdf', cache_control: { type: 'ephemeral' } })
    expect(first.content[1].type).toBe('text')
    expect(first.content[1].text).toContain('is attached to this message as a document')
    const marks = JSON.stringify(body).match(/"cache_control"/g) ?? []
    expect(marks.length).toBe(3)
    expect(marks.length).toBeLessThanOrEqual(4)
  })
})

describe('the OpenAI file part', () => {
  it('a PDF goes whole as { type: file, file: { filename, file_data } } for a model that reads PDFs', () => {
    const messages = buildModelMessages('I', [{ role: 'user', content: 'review', attachments: [pdfDoc()] }], null, { pdf: { native: { maxPages: 100 } } })
    const parts = messages[1].content as any[]
    expect(parts[0]).toEqual({ type: 'file', file: { filename: 'reqs.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjQK' } })
    expect(parts[1].text).toContain(ATTACH_OPEN)
  })

  it('a PDF over the model\'s page limit is not sent whole: its text, or a clear note', () => {
    const big = buildModelMessages('I', [{ role: 'user', content: 'x', attachments: [pdfDoc({ pages: 300, text: 'Section 1: login' })] }], null, { pdf: { native: { maxPages: 100 } } })
    expect(typeof big[1].content).toBe('string')
    expect(String(big[1].content)).toContain('Section 1: login')
    const scan = buildModelMessages('I', [{ role: 'user', content: 'x', attachments: [pdfDoc({ pages: 300 })] }], null, { pdf: { native: { maxPages: 100 } } })
    expect(String(scan[1].content)).toContain('more than the 100 this model reads at once')
  })

  it('a turn on gpt-4.1 sends the file part over Chat Completions', async () => {
    const { calls, fetchImpl } = recorder(() => okChat())
    const r = await runAssistantTurn({ connection: gpt, instructions: 'I', context: null, history: [{ role: 'user', content: 'review', attachments: [pdfDoc()] }], tools: [], onEvent: () => {}, fetchImpl })
    expect(r.status).toBe('completed')
    expect(calls[0].body.messages[1].content[0].type).toBe('file')
  })
})

describe('scanned PDFs', () => {
  it('upload for Claude: the PDF is kept whole (the model reads the scan) — no text needed', async () => {
    const a = await convertAttachment(Buffer.from(await scannedPdf()), 'SaaS_Onboarding_User_Requirements.pdf', { vision: true, pdf: { maxPages: 600 } })
    expect(a.kind).toBe('document')
    expect(a.data_url).toMatch(/^data:application\/pdf;base64,JVBER/)
    expect(a.pages).toBe(1)
    expect(a.note).toContain('the model reads it directly (including scanned pages)')
  })

  it('the native turn sends a document block to /v1/messages', async () => {
    const a = await convertAttachment(Buffer.from(await scannedPdf()), 'scan.pdf', { vision: true, pdf: { maxPages: 600 } })
    const { calls, fetchImpl } = recorder(() => okMessages())
    const r = await runAssistantTurn({ connection: claude, instructions: 'I', context: null, history: [{ role: 'user', content: 'Can you review the requirements?', attachments: [a] }], tools: [], onEvent: () => {}, fetchImpl })
    expect(r.status).toBe('completed')
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].body.messages[0].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' }, cache_control: { type: 'ephemeral' } })
  })

  it('a vision model without PDF input gets the scanned pages as images, with a note naming them', async () => {
    const a = await convertAttachment(Buffer.from(await scannedPdf()), 'scan.pdf', { vision: true, pdf: null })
    expect(a.kind).toBe('document')
    expect(a.data_url).toBeUndefined()
    expect(a.page_images).toHaveLength(1)
    expect(a.page_images![0]).toMatchObject({ page: 1 })
    expect(a.page_images![0].data_url).toMatch(/^data:image\/png;base64,/)
    const messages = buildModelMessages('I', [{ role: 'user', content: 'x', attachments: [a] }], null, { vision: true, pdf: { native: null } })
    const parts = messages[1].content as any[]
    expect(parts[0].text).toContain('Scanned page 1 of 1 follows this message as images')
    expect(parts[1].type).toBe('image_url')
  })

  it('a model that can\'t see gets OCR text when the instance has OCR', async () => {
    const ocr = vi.fn(async () => 'HELLO 42')
    const a = await convertAttachment(Buffer.from(await scannedPdf()), 'scan.pdf', { vision: false, ocr, pdf: null })
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(a).toMatchObject({ kind: 'text', text: 'HELLO 42' })
    expect(a.note).toContain('read with OCR')
  })

  it('nothing can read it: a clear message for the person and the model', async () => {
    await expect(convertAttachment(Buffer.from(await scannedPdf()), 'scan.pdf', { vision: false, ocr: null, pdf: null })).rejects.toThrow(SCANNED_PDF_UNREADABLE)
    // A PDF kept for Claude that later meets a model that can't read it (another profile): the same note.
    const messages = buildModelMessages('I', [{ role: 'user', content: 'x', attachments: [pdfDoc()] }], null, { vision: false, pdf: { native: null } })
    expect(String(messages[1].content)).toContain('was received but could not be read')
    expect(String(messages[1].content)).toContain('your current model can\'t read scanned PDFs')
    expect(String(messages[1].content)).not.toContain('JVBERi0xLjQK')
  })

  it('a provider that refuses the PDF: the turn retries without it, and the model is told why', async () => {
    const { calls, fetchImpl } = recorder((_u, n) => (n === 1 ? new Response('{"type":"error","error":{"type":"invalid_request_error","message":"The PDF specified was not valid."}}', { status: 400, headers: { 'content-type': 'application/json' } }) : okMessages()))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await runAssistantTurn({ connection: claude, instructions: 'I', context: null, history: [{ role: 'user', content: 'review', attachments: [pdfDoc()] }], tools: [], onEvent: () => {}, fetchImpl })
    warn.mockRestore()
    expect(r.status).toBe('completed')
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('https://api.anthropic.com/v1/messages')
    expect(JSON.stringify(calls[1].body)).not.toContain('"document"')
    expect(JSON.stringify(calls[1].body)).toContain('the AI provider refused the PDF')
  })

  it('Gemini (no documented PDF input over its OpenAI endpoint) never gets a file part', async () => {
    const { calls, fetchImpl } = recorder(() => okChat())
    await runAssistantTurn({ connection: gemini, instructions: 'I', context: null, history: [{ role: 'user', content: 'x', attachments: [pdfDoc({ text: 'Requirement 1' })] }], tools: [], vision: true, onEvent: () => {}, fetchImpl })
    expect(JSON.stringify(calls[0].body)).not.toContain('"file"')
    expect(JSON.stringify(calls[0].body)).toContain('Requirement 1')
  })
})

describe('text PDFs', () => {
  it('for Claude: sent whole too (better tables and layout), with the text kept as the fallback', async () => {
    const a = await convertAttachment(Buffer.from(await invoicePdf()), 'invoice.pdf', { vision: true, pdf: { maxPages: 600 } })
    expect(a.kind).toBe('document')
    expect(a.pages).toBe(2)
    expect(a.text).toContain('Invoice INV-2026-0042')
    expect(a.text).toContain('[Page 2]')
  })

  it('for other models: the extracted text, as before (pdf.js reads fonts the simple reader could not)', async () => {
    const a = await convertAttachment(Buffer.from(await invoicePdf()), 'invoice.pdf', { vision: true, pdf: null })
    expect(a.kind).toBe('text')
    expect(a.text).toContain('Total due: NZ$275.00')
    expect(a.note).toContain('Text of a PDF, 2 pages')
  })

  it('over the model\'s page limit: its text, saying why', async () => {
    const a = await convertAttachment(Buffer.from(await invoicePdf()), 'invoice.pdf', { vision: true, pdf: { maxPages: 1 } })
    expect(a.kind).toBe('text')
    expect(a.note).toContain('more than the 1 this model reads at once')
  })
})

describe('failures reach the model', () => {
  it('a failed attachment is a note in the untrusted block: received but could not be read, and why', async () => {
    const [failed] = sanitizeAttachments([{ name: 'scan.pdf', mime_type: 'application/pdf', size: 10, kind: 'failed', error: SCANNED_PDF_UNREADABLE }])
    expect(failed).toMatchObject({ kind: 'failed', error: SCANNED_PDF_UNREADABLE })
    const messages = buildModelMessages('I', [{ role: 'user', content: 'Can you review the requirements', attachments: [failed] }], null)
    const text = String(messages[1].content)
    expect(text).toContain(ATTACH_OPEN)
    expect(text).toContain('Attachment "scan.pdf" was received but could not be read: This PDF is a scan')
    expect(text).toContain('do not say that nothing was attached')
    const { assistantInstructions } = await import('@/lib/assistants/prompts')
    expect(assistantInstructions({ groups: [] })).toContain('never claim that nothing was attached')
  })

  it('the upload endpoint returns unreadable files as failed attachments (they travel with the message)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({ getCachedUser: async () => ({ id: 'u1' }) }))
    vi.doMock('@/lib/services/context', async (orig) => ({ ...(await orig() as any), fromSession: async () => ({ tenantId: 't1', actorId: 'u1', permissions: new Set() }) }))
    vi.doMock('@/lib/services/assistants', () => ({ attachmentUploadOptions: async () => ({ vision: false, ocr: null, pdf: null }) }))
    vi.doMock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
    const { POST } = await import('@/app/api/assistants/attachments/route')
    const form = new FormData()
    form.append('files', new File([Buffer.from(await scannedPdf())], 'SaaS_Onboarding_User_Requirements.pdf', { type: 'application/pdf' }))
    const res = await POST(new Request('http://x', { method: 'POST', body: form }) as any)
    const json = await res.json()
    expect(json.errors).toEqual([])
    expect(json.attachments[0]).toMatchObject({ name: 'SaaS_Onboarding_User_Requirements.pdf', kind: 'failed', error: SCANNED_PDF_UNREADABLE })
    vi.doUnmock('@/lib/supabase/server'); vi.doUnmock('@/lib/services/context'); vi.doUnmock('@/lib/services/assistants'); vi.doUnmock('@/lib/rate-limit')
  })
})

describe('size limits', () => {
  it('10 MB for PDFs a model reads as text; 20 MB when it reads PDFs itself', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 0x20)])
    await expect(convertAttachment(big, 'big.pdf', { vision: true, pdf: null })).rejects.toThrow(/Larger than 10 MB/)
    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(NATIVE_PDF_MAX_BYTES + 1, 0x20)])
    await expect(convertAttachment(huge, 'huge.pdf', { vision: true, pdf: { maxPages: 600 } })).rejects.toBeInstanceOf(AttachmentError)
    expect(ATTACHMENT_LIMITS.maxPdfBytes).toBe(20 * 1024 * 1024)
    expect(ATTACHMENT_LIMITS.maxFileBytes).toBe(10 * 1024 * 1024)
  })

  it('a forged or oversized PDF data URL from the browser is not sent; the token estimate counts PDFs by cost, not base64 length', () => {
    const [forged] = sanitizeAttachments([{ name: 'x.pdf', kind: 'document', data_url: 'data:application/pdf;base64,AAAA' }])
    expect(forged.kind).toBe('unavailable')
    const [tooBig] = sanitizeAttachments([{ name: 'x.pdf', kind: 'document', data_url: `data:application/pdf;base64,JVBER${'A'.repeat(ATTACHMENT_LIMITS.maxPdfDataUrlChars)}`, text: 'fallback' }])
    expect(tooBig).toMatchObject({ kind: 'document', text: 'fallback' })
    expect(tooBig.data_url).toBeUndefined()
    const pdf = { type: 'file', file: { filename: 'a.pdf', file_data: `data:application/pdf;base64,${'A'.repeat(4_000_000)}` } }
    expect(promptChars([{ role: 'user', content: [pdf] }])).toBeLessThan(200_000)
  })

  it('only the newest PDFs within the request cap go whole; older ones fall back', () => {
    const half = `data:application/pdf;base64,JVBER${'A'.repeat(Math.floor(ATTACHMENT_LIMITS.maxPdfDataUrlChars * 0.6))}`
    const history: ChatMessage[] = [
      { role: 'user', content: 'a', attachments: [pdfDoc({ name: 'old.pdf', data_url: half, text: 'OLD TEXT' })] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'b', attachments: [pdfDoc({ name: 'new.pdf', data_url: half })] },
    ]
    const messages = buildModelMessages('I', history, null, { pdf: { native: { maxPages: 600 } } })
    expect(String(messages[1].content)).toContain('OLD TEXT')
    expect((messages[3].content as any[])[0].type).toBe('file')
  })
})

describe('history keeps no PDF bytes', () => {
  it('stored copy: the text (re-attach to look again), or unavailable; page images dropped', () => {
    const withText = attachmentForStorage(pdfDoc({ text: 'Section 1', page_images: [{ page: 1, data_url: 'data:image/png;base64,iVBOR' }] }))
    expect(withText).toMatchObject({ kind: 'text', text: 'Section 1' })
    expect(withText.note).toContain('re-attach it to look at it again')
    expect(JSON.stringify(withText)).not.toContain('JVBER')
    expect(JSON.stringify(withText)).not.toContain('iVBOR')
    const scan = attachmentForStorage(pdfDoc())
    expect(scan).toMatchObject({ kind: 'unavailable' })
    expect(scan.note).toContain('no longer available')
    expect(JSON.stringify(scan)).not.toContain('JVBER')
  })

  it('the browser\'s saved conversation strips the bytes (the chip and the text stay)', async () => {
    const { emptyConversation, trimConversation } = await import('@/lib/assistants/history')
    const conv = { ...emptyConversation(), messages: [{ role: 'user', content: 'x', attachments: [pdfDoc(), pdfDoc({ name: 'b.pdf', text: 'Body' })] }] as ChatMessage[], items: [{ kind: 'user' as const, id: 'u1', text: 'x', attachments: [{ name: 'reqs.pdf', mime_type: 'application/pdf', size: 1000 }] }] }
    const saved = JSON.stringify(trimConversation(conv))
    expect(saved).not.toContain('base64')
    expect(saved).toContain('reqs.pdf')
    expect(saved).toContain('Body')
  })
})
