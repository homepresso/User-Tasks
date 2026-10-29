import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { UsertasksClient } from '@usertasks/sdk'
import { harness, ok } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const dir = mkdtempSync(join(tmpdir(), 'ut-cli-files-'))
const pdf = join(dir, 'receipt.pdf')
writeFileSync(pdf, '%PDF-1.7\nreceipt\n%%EOF\n')
const file = (id: string, name: string) => ({ id, name, size: 24, mime_type: 'application/pdf', url: `/attachments/${id}`, storage_ref: 'storage://form-files/x', uploaded_by: 'u', uploaded_at: 'now', checksum_sha256: 'a' })

describe('files upload / --attach', () => {
  it('files upload sends the file (base64) into the context and prints the file object', async () => {
    const h = harness({ env, responder: () => ok({ mode: 'uploaded', file: file('f1', 'receipt.pdf') }) })
    expect(await h.run('files', 'upload', pdf, '--task', 't1', '--field', 'receipts', '-o', 'json')).toBe(0)
    expect(h.requests[0].url.pathname).toBe('/api/v1/files/uploads')
    expect(h.requests[0].body).toMatchObject({ task_id: 't1', field_key: 'receipts', name: 'receipt.pdf', size: 23, content_base64: Buffer.from('%PDF-1.7\nreceipt\n%%EOF\n').toString('base64') })
    expect(JSON.parse(h.stdout())).toMatchObject({ id: 'f1' })
    expect(await h.run('files', 'upload', pdf, '--field', 'receipts')).not.toBe(0)
  })

  it('tasks complete --attach uploads into the task and puts the ids in values', async () => {
    let n = 0
    const h = harness({ env, responder: (r) => (r.url.pathname === '/api/v1/files/uploads' ? ok({ mode: 'uploaded', file: file(`f${++n}`, 'receipt.pdf') }) : ok({ status: 'completed' })) })
    expect(await h.run('tasks', 'complete', 't1', '--outcome', 'approved', '--attach', `receipts=${pdf}`, '--attach', `receipts=${pdf}`, '--set', 'note=ok')).toBe(0)
    expect(h.requests.filter((r) => r.url.pathname === '/api/v1/files/uploads').map((r) => (r.body as { task_id: string }).task_id)).toEqual(['t1', 't1'])
    expect(h.requests.at(-1)!.body).toMatchObject({ action: 'complete', outcome: 'approved', values: { note: 'ok', receipts: ['f1', 'f2'] } })
  })

  it('forms submit / workflows start --attach use the form / the workflow start context', async () => {
    const h = harness({ env, responder: (r) => (r.url.pathname === '/api/v1/files/uploads' ? ok({ mode: 'uploaded', file: file('f9', 'receipt.pdf') }) : ok({})) })
    expect(await h.run('forms', 'submit', 'form1', '--attach', `receipts=${pdf}`, '--set', 'values:={"title":"x"}')).toBe(0)
    expect(h.requests[0].body).toMatchObject({ form_id: 'form1', field_key: 'receipts' })
    expect(h.requests[1].body).toEqual({ values: { title: 'x', receipts: ['f9'] } })
    expect(await h.run('workflows', 'start', '--set', 'workflow_id=wf1', '--attach', `scans=${pdf}`)).toBe(0)
    expect(h.requests[2].body).toMatchObject({ workflow_id: 'wf1', field_key: 'scans' })
    expect(h.requests[3].body).toEqual({ workflow_id: 'wf1', variables: { scans: ['f9'] } })
  })
})

describe('SDK uploadFile', () => {
  it('large files: init → PUT to the signed URL → complete', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ url, method: String(init.method), body: init.body })
      if (url.endsWith('/files/uploads')) return Response.json({ success: true, data: { mode: 'direct', file_id: 'f5', upload: { url: 'https://store.test/put?sig=1', method: 'PUT', headers: { 'Content-Type': 'application/pdf' } } } })
      if (url.startsWith('https://store.test/')) return new Response(null, { status: 200 })
      return Response.json({ success: true, data: { file: file('f5', 'big.pdf') } }, { status: 201 })
    })
    const client = new UsertasksClient({ baseUrl: 'https://tasks.test', fetch: fetchImpl as unknown as typeof fetch })
    const bytes = new Uint8Array(4 * 1024 * 1024)
    const uploaded = await client.uploadFile({ form_id: 'form1', field_key: 'scans' }, { name: 'big.pdf', bytes })
    expect(uploaded.id).toBe('f5')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://tasks.test/api/v1/files/uploads',
      'PUT https://store.test/put?sig=1',
      'POST https://tasks.test/api/v1/files/uploads/f5/complete',
    ])
    expect(JSON.parse(String(calls[0].body))).toEqual({ form_id: 'form1', field_key: 'scans', name: 'big.pdf', size: bytes.byteLength })
  })
})
