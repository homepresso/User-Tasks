import { describe, expect, it } from 'vitest'
import { redactUrl, xmlElements } from '@/lib/reference-executor'

// 2026-11 QA pass: secret-in-path webhook URLs masked in call logs; Azure
// list parsing linear on a hostile upstream body.
describe('redactUrl', () => {
  it('masks the path of webhook URLs whose path is the secret', () => {
    expect(redactUrl('https://acme.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456')).toBe('https://acme.webhook.office.com/***')
    expect(redactUrl('https://hooks.slack.com/services/T000/B000/XXXX')).toBe('https://hooks.slack.com/***')
    expect(redactUrl('https://prod-01.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRET')).not.toContain('SECRET')
  })
  it('leaves ordinary API paths readable', () => {
    expect(redactUrl('https://api.example.com/v1/items?token=abc')).toBe('https://api.example.com/v1/items?token=***')
  })
})

describe('xmlElements', () => {
  it('yields each element', () => {
    expect([...xmlElements('<Blobs><Blob><Name>a</Name></Blob><Blob><Name>b</Name></Blob></Blobs>', 'Blob')]).toEqual(['<Blob><Name>a</Name></Blob>', '<Blob><Name>b</Name></Blob>'])
  })
  it('is linear on many unclosed start tags', () => {
    const hostile = '<Blobs>' + '<Blob>'.repeat(200_000)
    const t = Date.now()
    expect([...xmlElements(hostile, 'Blob')]).toEqual([])
    expect(Date.now() - t).toBeLessThan(2000)
  })
})
