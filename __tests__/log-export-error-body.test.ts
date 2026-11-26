import { describe, expect, it } from 'vitest'
import { readErrorBody } from '@/lib/log-export/deliver'

// The shipper read whole error bodies before clipping them (2026-11 QA pass).
describe('readErrorBody', () => {
  it('reads at most maxBytes of an endless body and cancels the rest', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024).fill(120)) } })
    const text = await readErrorBody(new Response(body, { status: 500 }), 4096)
    expect(text.length).toBe(4096)
    expect(pulled).toBeLessThan(10)
  })
  it('returns short bodies whole', async () => {
    expect(await readErrorBody(new Response('bad request', { status: 400 }), 4096)).toBe('bad request')
  })
})
