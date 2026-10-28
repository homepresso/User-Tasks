import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/egress-guard', () => ({ assertSafeEgressUrl: async () => {} }))
vi.mock('@/lib/integrations/attach-auth', () => ({ applyAuthHeaders: async () => {} }))

import { executeReference } from '@/lib/reference-executor'
import { referenceInputText, substituteInputPlaceholder } from '@/lib/reference-input-utils'

/**
 * Object / array values given to reference inputs used to arrive as
 * "[object Object]". Body templates get real JSON (a quoted "{{x}}"
 * placeholder becomes the JSON value, not a string); query, header and path
 * inputs get the value as a JSON string.
 */
const customer = { id: 7, name: 'Ada', tags: ['vip'] }

describe('reference input serialisation helpers', () => {
  it('referenceInputText', () => {
    expect(referenceInputText(customer)).toBe(JSON.stringify(customer))
    expect(referenceInputText(['a', 'b'])).toBe('["a","b"]')
    expect(referenceInputText({ _file: true, url: 'https://f/x.pdf' })).toBe('https://f/x.pdf')
    expect(referenceInputText(null)).toBe('')
    expect(referenceInputText(42)).toBe('42')
    expect(referenceInputText('text')).toBe('text')
  })

  it('substituteInputPlaceholder in JSON bodies', () => {
    expect(JSON.parse(substituteInputPlaceholder('{"c": {{customer}}}', 'customer', customer, 'json'))).toEqual({ c: customer })
    expect(JSON.parse(substituteInputPlaceholder('{"c": "{{customer}}"}', 'customer', customer, 'json'))).toEqual({ c: customer })
    expect(substituteInputPlaceholder('{"n": "{{name}}"}', 'name', 'Ada', 'json')).toBe('{"n": "Ada"}')
    expect(substituteInputPlaceholder('/x/{{a.b}}', 'a.b', 'v', 'text')).toBe('/x/v')
  })
})

describe('executeReference with object inputs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends objects as JSON in the body and as JSON text in query/header', async () => {
    const ref = {
      id: 'ref-1', tenant_id: 't1',
      request_config: { method: 'POST', path_template: '/customers', body_template: '{"customer": "{{customer}}", "ids": {{ids}}}' },
      inputs: [
        { name: 'customer', location: 'body' },
        { name: 'ids', location: 'body' },
        { name: 'filter', location: 'query' },
        { name: 'x_meta', location: 'header' },
      ],
      integration: { id: 'int-1', tenant_id: 't1', config: { base_url: 'https://api.example.com' } },
    }
    const b: any = { select: () => b, eq: () => b, single: async () => ({ data: ref, error: null }), insert: async () => ({ error: null }) }
    const supabase: any = { from: () => b }
    const calls: { url: string; init: any }[] = []
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await executeReference({
      supabase, referenceId: 'ref-1',
      inputValues: { customer, ids: [1, 2], filter: { status: 'open' }, x_meta: ['a'] } as any,
    })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body)).toEqual({ customer, ids: [1, 2] })
    const url = new URL(calls[0].url)
    expect(url.searchParams.get('filter')).toBe('{"status":"open"}')
    expect(calls[0].init.headers.x_meta).toBe('["a"]')
    expect(calls[0].init.body).not.toContain('[object Object]')
  })
})

describe('custom JSON body expressions', () => {
  it('json: true interpolates objects and arrays as JSON', async () => {
    const { resolveExpression } = await import('@/lib/expression-resolver')
    const ctx = { variables: { customer, ids: [1, 2], name: 'Ada' }, json: true }
    expect(JSON.parse(resolveExpression('{"c": {{customer}}, "ids": {{ids}}, "n": "{{name}}"}', ctx))).toEqual({ c: customer, ids: [1, 2], n: 'Ada' })
    // Default (text) interpolation is unchanged.
    expect(resolveExpression('ids: {{ids}}', { variables: { ids: [1, 2] } })).toBe('ids: 1,2')
  })
})
