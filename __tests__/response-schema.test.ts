import { describe, expect, it } from 'vitest'
import {
  captureResponseSample,
  inferSchema,
  mergeSchemaNodes,
  normalizeResponseSchema,
  referenceResponseSchema,
  schemaAtPath,
  schemaFromColumns,
  schemaFromJsonSchema,
  schemaFromOutputs,
  splitPath,
  trimSample,
  valueAtPath,
} from '@/lib/response-schema'
import { parseApiSpec, parseResponseSchema } from '@/lib/api-spec-parser'

const customers = {
  total: 2,
  data: [
    { id: 1, name: 'Ada', email: 'ada@example.com', address: { city: 'Wellington' }, tags: ['vip'] },
    { id: 2, name: 'Grace', email: 'grace@example.com', address: { city: 'Auckland', zip: '1010' }, tags: [], phone: null },
  ],
}

describe('inferSchema', () => {
  it('models nested objects and arrays of objects with examples', () => {
    const root = inferSchema(customers)
    expect(root.type).toBe('object')
    expect(schemaAtPath(root, 'total')).toMatchObject({ type: 'integer', example: 2 })
    const data = schemaAtPath(root, 'data')!
    expect(data.type).toBe('array')
    expect(data.items?.type).toBe('object')
    expect(schemaAtPath(root, 'data[].address.city')).toMatchObject({ type: 'string', example: 'Wellington' })
    expect(schemaAtPath(root, 'data.0.email')?.type).toBe('string')
    expect(schemaAtPath(root, 'data[].tags')).toMatchObject({ type: 'array', items: { type: 'string' } })
  })

  it('merges array items: optional fields, nullable values', () => {
    const item = schemaAtPath(inferSchema(customers), 'data[]')!
    const zip = item.fields!.find((f) => f.name === 'address')!.fields!.find((f) => f.name === 'zip')!
    expect(zip.required).toBe(false)
    const phone = item.fields!.find((f) => f.name === 'phone')!
    expect(phone.required).toBe(false)
    expect(phone.type).toBe('null')
    const id = item.fields!.find((f) => f.name === 'id')!
    expect(id.required).toBeUndefined()
  })

  it('widens mixed types: integer+number → number, string+number → any, null → nullable', () => {
    expect(mergeSchemaNodes({ type: 'integer' }, { type: 'number' }).type).toBe('number')
    expect(mergeSchemaNodes({ type: 'string' }, { type: 'number' }).type).toBe('any')
    expect(mergeSchemaNodes({ type: 'null' }, { type: 'string', example: 'x' })).toMatchObject({ type: 'string', nullable: true, example: 'x' })
    const mixed = inferSchema([{ v: 1 }, { v: 'a' }, { v: null }])
    expect(schemaAtPath(mixed, '[].v')).toMatchObject({ type: 'any', nullable: true })
  })

  it('never keeps examples for credential-shaped fields', () => {
    const root = inferSchema({ access_token: 'abc', password: 'p', user: { api_key: 'k', name: 'n' } })
    expect(schemaAtPath(root, 'access_token')?.example).toBeUndefined()
    expect(schemaAtPath(root, 'password')?.example).toBeUndefined()
    expect(schemaAtPath(root, 'user.api_key')?.example).toBeUndefined()
    expect(schemaAtPath(root, 'user.name')?.example).toBe('n')
  })

  it('stores fields as an array so export scrubbing cannot mask a "password" field model', async () => {
    const { scrubSecretsForExport } = await import('@/lib/portability/scrub')
    const root = inferSchema({ password: 'x', token: 'y' })
    expect(scrubSecretsForExport(root)).toEqual(root)
  })
})

describe('merging samples', () => {
  it('captureResponseSample merges successive samples and trims the stored sample', () => {
    const first = captureResponseSample(null, { data: [{ id: 1, name: 'A' }] })
    expect(first.source).toBe('sample')
    expect(first.samples).toBe(1)
    const second = captureResponseSample(first, { data: [{ id: 2, email: 'b@x' }], next: 'cursor' })
    expect(second.samples).toBe(2)
    expect(schemaAtPath(second.root, 'data[].email')?.type).toBe('string')
    expect((schemaAtPath(second.root, 'data[].name') as any)?.required).toBe(false)
    expect((schemaAtPath(second.root, 'next') as any)?.required).toBe(false)
    const big = captureResponseSample(null, { rows: Array.from({ length: 50 }, (_, i) => ({ i, secret: 's' })) })
    expect((big.sample as any).rows).toHaveLength(20)
    expect((big.sample as any).rows[0].secret).toBe('••••')
  })

  it('a spec model keeps its structure and source; samples only add', () => {
    const spec = { version: 1 as const, source: 'openapi' as const, root: { type: 'object' as const, fields: [{ name: 'id', type: 'integer' as const, description: 'The id' }] } }
    const merged = captureResponseSample(spec, { id: 5, extra: true })
    expect(merged.source).toBe('openapi')
    expect(schemaAtPath(merged.root, 'id')).toMatchObject({ type: 'integer', description: 'The id', example: 5 })
    expect(schemaAtPath(merged.root, 'extra')?.type).toBe('boolean')
  })

  it('trimSample cuts long strings and deep nesting', () => {
    const trimmed = trimSample({ s: 'x'.repeat(500) }) as any
    expect(trimmed.s.length).toBeLessThan(210)
  })
})

describe('from declared outputs / columns (backfill)', () => {
  it('builds a partial model from output paths', () => {
    const root = schemaFromOutputs([
      { name: 'name', path: 'data.customer.name', type: 'string' },
      { name: 'first_sku', path: 'items[0].sku', type: 'string' },
      { name: 'count', path: 'meta.count', type: 'number' },
    ])!
    expect(schemaAtPath(root, 'data.customer.name')?.type).toBe('string')
    expect(schemaAtPath(root, 'items')?.type).toBe('array')
    expect(schemaAtPath(root, 'items[].sku')?.type).toBe('string')
    expect(schemaAtPath(root, 'meta.count')?.type).toBe('number')
  })

  it('DB-style [].col outputs and a whole-response list become an array of rows', () => {
    const root = schemaFromOutputs([
      { name: 'results', path: '', type: 'array' },
      { name: 'id', path: '[].id', type: 'number' },
      { name: 'email', path: '[].email', type: 'string' },
    ])!
    expect(root.type).toBe('array')
    expect(schemaAtPath(root, '[].email')?.type).toBe('string')
    expect(schemaFromColumns([{ name: 'id', type: 'int4' }, { name: 'ok', type: 'boolean' }])).toMatchObject({ type: 'array', items: { fields: [{ name: 'id', type: 'integer' }, { name: 'ok', type: 'boolean' }] } })
  })

  it('referenceResponseSchema prefers the stored model, else derives from outputs', () => {
    expect(referenceResponseSchema({ outputs: [{ name: 'x', path: 'a.b', type: 'string' }] })?.source).toBe('outputs')
    expect(referenceResponseSchema({ request_config: { response_schema: { source: 'sample', root: { type: 'array' } } }, outputs: [] })?.source).toBe('sample')
    expect(referenceResponseSchema({ outputs: [] })).toBeNull()
  })

  it('normalizeResponseSchema accepts a bare root and drops junk', () => {
    const schema = normalizeResponseSchema({ type: 'object', fields: [{ name: 'a', type: 'weird', evil: 1 }, { nope: true }] })!
    expect(schema.source).toBe('manual')
    expect(schema.root.fields).toEqual([{ name: 'a', type: 'any' }])
    expect(normalizeResponseSchema('nope')).toBeNull()
  })
})

describe('paths', () => {
  it('splitPath understands dots, [n] and []', () => {
    expect(splitPath('data[0].items[].name')).toEqual(['data', '0', 'items', '[]', 'name'])
    expect(splitPath('[].col')).toEqual(['[]', 'col'])
    expect(valueAtPath(customers, 'data[1].address.city')).toBe('Auckland')
    expect(valueAtPath(customers, 'data.0.name')).toBe('Ada')
  })
})

describe('OpenAPI response extraction', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Shop' },
    servers: [{ url: 'https://shop.test' }],
    paths: {
      '/customers': {
        get: {
          summary: 'List customers',
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerList' } } } },
          },
        },
      },
      '/customers/{id}': {
        get: {
          summary: 'Get customer',
          responses: { '201': { description: 'x' }, default: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } } },
        },
      },
    },
    components: {
      schemas: {
        CustomerList: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } }, next: { type: ['string', 'null'] } } },
        Customer: {
          allOf: [
            { $ref: '#/components/schemas/Base' },
            { type: 'object', properties: { email: { type: 'string', example: 'ada@example.com', description: 'Primary email' }, address: { $ref: '#/components/schemas/Address' }, referrer: { $ref: '#/components/schemas/Customer' } } },
          ],
        },
        Base: { type: 'object', properties: { id: { type: 'integer' } } },
        Address: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  }

  it('resolves $ref, allOf, nullable type arrays and recursion', () => {
    const parsed = parseApiSpec(JSON.stringify(spec))
    const list = parsed.references.find((ref) => ref.name === 'List customers')!
    expect(list.responseSchema?.source).toBe('openapi')
    const root = list.responseSchema!.root
    expect(schemaAtPath(root, 'data[].email')).toMatchObject({ type: 'string', example: 'ada@example.com', description: 'Primary email' })
    expect(schemaAtPath(root, 'data[].id')?.type).toBe('integer')
    expect(schemaAtPath(root, 'data[].address.city')?.type).toBe('string')
    expect(schemaAtPath(root, 'next')).toMatchObject({ type: 'string', nullable: true, required: false })
    // Recursive $ref stops instead of looping.
    expect(schemaAtPath(root, 'data[].referrer')?.type).toBe('object')
    const get = parsed.references.find((ref) => ref.name === 'Get customer')!
    expect(schemaAtPath(get.responseSchema!.root, 'email')?.type).toBe('string')
  })

  it('handles Swagger 2 response schemas with definitions', () => {
    const schema = parseResponseSchema(
      { '200': { schema: { type: 'array', items: { $ref: '#/definitions/Pet' } } } },
      { Pet: { type: 'object', properties: { name: { type: 'string' } } } },
    )!
    expect(schemaAtPath(schema.root, '[].name')?.type).toBe('string')
    expect(parseResponseSchema({ '404': {} })).toBeUndefined()
  })

  it('schemaFromJsonSchema handles oneOf as a merge', () => {
    const node = schemaFromJsonSchema({ oneOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object', properties: { b: { type: 'number' } } }] })
    expect(node.fields?.map((f) => f.name)).toEqual(['a', 'b'])
  })
})
