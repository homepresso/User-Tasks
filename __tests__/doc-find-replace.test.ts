import { describe, it, expect, vi, beforeEach } from 'vitest'
import PizZip from 'pizzip'

/**
 * doc_word / doc_excel / doc_powerpoint find & replace: `find` is a LITERAL
 * placeholder (so {{Name}} in a template is found as written); only `replace`
 * is resolved as an expression. An empty find is skipped (it used to split the
 * document into characters and blow up), and replacement output is capped.
 */
const stored: { body: Buffer }[] = []
let template: Buffer = Buffer.alloc(0)

vi.mock('@/lib/storage/files', async (importOriginal) => ({
  fileSource: (await importOriginal<typeof import('@/lib/storage/files')>()).fileSource,
  fetchFile: async () => new Response(new Uint8Array(template)),
  storeWorkflowFile: async (_c: any, _t: string, body: Uint8Array) => {
    stored.push({ body: Buffer.from(body) })
    return { url: 'https://files.example.com/out', path: 'out', ref: 'storage://out' }
  },
}))

import { handleDocWord, handleDocExcel } from '@/lib/doc-handlers'
import { resolveExpression } from '@/lib/expression-resolver'

function docx(text: string): Buffer {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  return zip.generate({ type: 'nodebuffer' })
}
const docText = (buf: Buffer) => new PizZip(buf).file('word/document.xml')!.asText()

const ctx = { variables: { customer: 'Ada', total: 42 } }
const resolve = (expr: any) => resolveExpression(expr, ctx)

beforeEach(() => { stored.length = 0 })

describe('doc_word find & replace', () => {
  it('treats a {{placeholder}} find literally and resolves only replace', async () => {
    template = docx('Dear {{Name}}, you owe {{Total}}.')
    const result = await handleDocWord({
      template_url: 'https://files.example.com/t.docx',
      replacements: [{ find: '{{Name}}', replace: '{{customer}}' }, { find: '{{Total}}', replace: '{{total}}' }],
    }, resolve, {} as any, 't1', () => {})
    expect(result.fileName).toBe('document.docx')
    const text = docText(stored[0].body)
    expect(text).toContain('Dear Ada, you owe 42.')
  })

  it('skips an empty find instead of exploding the document', async () => {
    template = docx('Hello [[NAME]]')
    const logs: string[] = []
    const result = await handleDocWord({
      template_url: 'x', replacements: [{ find: '', replace: 'X' }, { find: '   ', replace: 'X' }, { find: '[[NAME]]', replace: 'Ada' }],
    }, resolve, {} as any, 't1', () => {}, (m) => logs.push(m))
    expect(docText(stored[0].body)).toContain('Hello Ada')
    expect(result.skipped_replacements).toBe(2)
    expect(logs.join(" ")).toMatch(/empty "find"/)
  })

  it('stops a replacement that would grow the document without bound', async () => {
    template = docx('a'.repeat(2000))
    await expect(handleDocWord({
      template_url: 'x', replacements: [{ find: 'a', replace: 'b'.repeat(100_000) }],
    }, resolve, {} as any, 't1', () => {})).rejects.toThrow(/too large/)
  })
})

describe('doc_excel find & replace', () => {
  it('treats find literally', async () => {
    const xl = await import('@/lib/excel')
    const wb = xl.buildWorkbook([{ name: 'Sheet1', arrays: [['Customer', '{{Name}}']] }])
    template = await xl.workbookToBuffer(wb)
    await handleDocExcel({
      template_url: 'x', replacements: [{ find: '{{Name}}', replace: '{{customer}}' }],
    }, resolve, {} as any, 't1', () => {})
    const out = await xl.loadWorkbook(stored[0].body)
    expect(xl.sheetToArrays(xl.getSheet(out)!)[0]).toEqual(['Customer', 'Ada'])
  })
})
