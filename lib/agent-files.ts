/**
 * Files for AI agent steps (server only). A Run Agent step's "Files"
 * (a file object or a list — `{{form.receipts}}`, `{{item}}` in a Loop) are
 * read for the run's tenant (lib/workflow-files.ts) and handed to the model
 * in the OpenAI-compatible chat format every agent connector speaks:
 *
 *  - images (PNG / JPEG / GIF / WebP) as `image_url` parts (base64 data
 *    URLs) for providers with vision on that API (OpenAI, Azure OpenAI,
 *    Anthropic's OpenAI-compatible endpoint, Gemini's OpenAI-compatible
 *    endpoint);
 *  - PDFs as `file` parts where the API takes documents (OpenAI);
 *  - everything else — and PDFs / images where the provider can't take
 *    them — as text extracted by extractFileText() (PDF, Word, Excel,
 *    PowerPoint, text, CSV, JSON, Markdown), in a text part with the file's
 *    name.
 *
 * Limits fail the step with a clear message (files, size per kind, PDF
 * pages, extracted characters). Contents never reach logs or agent_runs:
 * only names, sizes and how each file was sent.
 */

import { inflateSync } from 'node:zlib'
import type { StepFile } from './workflow-files'

export type AgentContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export type AgentFileProvider = 'openai' | 'azure_openai' | 'anthropic' | 'gemini' | 'other'

export const AGENT_FILE_LIMITS = {
  maxFiles: 10,
  maxImageBytes: 5 * 1024 * 1024,
  maxPdfBytes: 20 * 1024 * 1024,
  maxPdfPages: 100,
  maxTotalBytes: 50 * 1024 * 1024,
  /** Extracted text per file / for all files (characters). */
  maxTextChars: 100_000,
  maxTotalTextChars: 300_000,
} as const

/** Which API an agent's base URL is (what it accepts in a message). */
export function agentFileProvider(baseUrl: string): AgentFileProvider {
  let host = ''
  try { host = new URL(baseUrl).hostname.toLowerCase() } catch { return 'other' }
  if (host === 'api.openai.com') return 'openai'
  if (host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')) return 'azure_openai'
  if (host === 'api.anthropic.com') return 'anthropic'
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  return 'other'
}

export function providerAccepts(provider: AgentFileProvider): { images: boolean; pdf: boolean } {
  switch (provider) {
    case 'openai': return { images: true, pdf: true }
    case 'azure_openai': case 'anthropic': case 'gemini': return { images: true, pdf: false }
    default: return { images: false, pdf: false }
  }
}

const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/i

function pdfPageCount(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1')
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
}

/* ── Text extraction (isolated: a fuller document library can replace it) ── */

function decodePdfString(raw: string): string {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' } as Record<string, string>)[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
}

/** Text of a PDF's content streams (Tj / TJ operators; Flate-compressed streams inflated). Best effort. */
function pdfText(bytes: Uint8Array): string {
  const source = Buffer.from(bytes)
  const latin = source.toString('latin1')
  const chunks: string[] = []
  const streamRe = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = streamRe.exec(latin))) {
    const start = match.index + match[0].length
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    const dict = latin.slice(Math.max(0, match.index - 300), match.index)
    let data = source.subarray(start, end)
    if (/\/FlateDecode/.test(dict)) {
      try { data = inflateSync(data) } catch { streamRe.lastIndex = end; continue }
    }
    const content = data.toString('latin1')
    const lines: string[] = []
    for (const op of content.matchAll(/\[((?:\([^)]*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj|(T\*|ET)/g)) {
      if (op[1] !== undefined) lines.push([...op[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((m) => decodePdfString(m[1])).join(''))
      else if (op[2] !== undefined) lines.push(decodePdfString(op[2]))
      else lines.push('\n')
    }
    if (lines.length) chunks.push(lines.join(''))
    streamRe.lastIndex = end
  }
  return chunks.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function xmlText(xml: string, tag: string): string {
  const marked = xml.replace(/<\/(?:w|a):p>/g, '\u0000')
  const out: string[] = []
  for (const m of marked.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>|\u0000`, 'g'))) out.push(m[0] === '\u0000' ? '\n' : m[1])
  return out.join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Plain text of a document for a model that can't read the file itself:
 * PDF, Word (.docx), Excel (.xlsx, as CSV per sheet), PowerPoint (.pptx),
 * and UTF-8 text formats. Throws for anything else.
 */
export async function extractFileText(file: Pick<StepFile, 'name' | 'mime_type' | 'bytes'>): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const mime = file.mime_type.toLowerCase()
  if (mime === 'application/pdf' || ext === 'pdf') return pdfText(file.bytes)
  if (ext === 'docx' || ext === 'pptx') {
    const PizZip = (await import('pizzip')).default
    const zip = new PizZip(file.bytes)
    if (ext === 'docx') return xmlText(zip.file('word/document.xml')?.asText() ?? '', 'w:t')
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    return slides.map((n, i) => `Slide ${i + 1}:\n${xmlText(zip.file(n)!.asText(), 'a:t')}`).join('\n\n')
  }
  if (ext === 'xlsx') {
    const { loadWorkbook, sheetNames, getSheet, sheetToArrays } = await import('./excel')
    const wb = await loadWorkbook(file.bytes)
    return sheetNames(wb).map((name) => {
      const rows = sheetToArrays(getSheet(wb, name)!, { defval: '' })
      return `Sheet ${name}:\n${rows.map((r) => r.map((c) => (c === null ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n')}`
    }).join('\n\n')
  }
  if (/^text\//.test(mime) || ['txt', 'csv', 'tsv', 'md', 'markdown', 'json', 'log', 'eml'].includes(ext) || mime === 'application/json') {
    return new TextDecoder('utf-8').decode(file.bytes)
  }
  throw new Error(`"${file.name}" can't be read by this model (${file.mime_type})`)
}

/* ── Shaping the message ── */

export interface AgentFileSummary { name: string; size: number; mime_type: string; sent_as: 'image' | 'document' | 'text' }

/**
 * The content parts for a user message carrying `files`, shaped for the
 * provider, plus a summary for logs (names, sizes, how sent — no contents).
 */
export async function buildAgentFileParts(files: StepFile[], baseUrl: string): Promise<{ parts: AgentContentPart[]; summary: AgentFileSummary[] }> {
  if (files.length > AGENT_FILE_LIMITS.maxFiles) throw new Error(`An agent step takes at most ${AGENT_FILE_LIMITS.maxFiles} files (got ${files.length})`)
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > AGENT_FILE_LIMITS.maxTotalBytes) throw new Error(`The files add up to more than ${AGENT_FILE_LIMITS.maxTotalBytes / 1024 / 1024} MB`)
  const accepts = providerAccepts(agentFileProvider(baseUrl))
  const parts: AgentContentPart[] = []
  const summary: AgentFileSummary[] = []
  let textChars = 0
  for (const file of files) {
    const base64 = () => Buffer.from(file.bytes).toString('base64')
    if (IMAGE_MIME.test(file.mime_type)) {
      if (!accepts.images) throw new Error(`"${file.name}": this agent's model API doesn't take images — use a vision-capable connector (OpenAI, Azure OpenAI, Claude, Gemini)`)
      if (file.size > AGENT_FILE_LIMITS.maxImageBytes) throw new Error(`"${file.name}" is larger than ${AGENT_FILE_LIMITS.maxImageBytes / 1024 / 1024} MB (images sent to a model)`)
      parts.push({ type: 'image_url', image_url: { url: `data:${file.mime_type.toLowerCase()};base64,${base64()}` } })
      summary.push({ name: file.name, size: file.size, mime_type: file.mime_type, sent_as: 'image' })
      continue
    }
    const isPdf = file.mime_type.toLowerCase() === 'application/pdf'
    if (isPdf && accepts.pdf) {
      if (file.size > AGENT_FILE_LIMITS.maxPdfBytes) throw new Error(`"${file.name}" is larger than ${AGENT_FILE_LIMITS.maxPdfBytes / 1024 / 1024} MB (PDFs sent to a model)`)
      const pages = pdfPageCount(file.bytes)
      if (pages > AGENT_FILE_LIMITS.maxPdfPages) throw new Error(`"${file.name}" has ${pages} pages (at most ${AGENT_FILE_LIMITS.maxPdfPages})`)
      parts.push({ type: 'file', file: { filename: file.name, file_data: `data:application/pdf;base64,${base64()}` } })
      summary.push({ name: file.name, size: file.size, mime_type: file.mime_type, sent_as: 'document' })
      continue
    }
    let text = await extractFileText(file)
    if (!text.trim()) throw new Error(`"${file.name}" has no text this model can read`)
    if (text.length > AGENT_FILE_LIMITS.maxTextChars) text = `${text.slice(0, AGENT_FILE_LIMITS.maxTextChars)}\n[… truncated at ${AGENT_FILE_LIMITS.maxTextChars} characters]`
    textChars += text.length
    if (textChars > AGENT_FILE_LIMITS.maxTotalTextChars) throw new Error(`The files' text is longer than ${AGENT_FILE_LIMITS.maxTotalTextChars} characters together — attach fewer files`)
    parts.push({ type: 'text', text: `File "${file.name}" (${file.mime_type}):\n${text}` })
    summary.push({ name: file.name, size: file.size, mime_type: file.mime_type, sent_as: 'text' })
  }
  return { parts, summary }
}

/** A message's content with file parts replaced by their names (what is kept after the call). */
export function withoutFileContents(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content.map((part: AgentContentPart) => (part.type === 'text' && !part.text.startsWith('File "') ? part.text : part.type === 'file' ? `[file ${part.file.filename}]` : part.type === 'image_url' ? '[image]' : `[${part.text.slice(0, part.text.indexOf('\n'))}]`)).join('\n')
}
