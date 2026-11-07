import { describe, expect, it } from 'vitest'
import {
  autoPickCollection, collectionAt, collectionItemFields, collectionPathFromExpression, findCollections, isCollectionPath, normalizeCollectionPath,
  pagingHints, runtimeView, suggestFieldFormat, unwrapExecutorResult, validateCollectionPath, workflowCollectionExpression,
} from '@/lib/response-collections'
import { captureResponseSample, inferSchema, referenceResponseSchema, schemaFromOutputs, type ResponseSchema } from '@/lib/response-schema'
import { normalizeDataTableConfig } from '@/lib/forms/data-table'
import { lookupResultsArray, normalizeLookupConfig } from '@/lib/forms/lookup'
import { responseRows } from '@/lib/services/form-data-table'
import { resolveExpression } from '@/lib/expression-resolver'
import { normalizeReferenceOutput } from '@/lib/services/references'
import { keepCapturedModel } from '@/lib/services/connectors'
import { awsS3Connector } from '@/lib/connectors/definitions/aws-s3'

/** Exactly what the user's S3 list-objects reference returned. */
const S3 = {
  contents: [
    { key: 'invoices/2021/inv-001.pdf', size: 0, last_modified: '2021-06-02T16:44:29.000Z', etag: '"d41d8cd98f00b204e9800998ecf8427e"', storage_class: 'STANDARD' },
    { key: 'invoices/2021/inv-002.pdf', size: 48213, last_modified: '2021-06-03T09:12:01.000Z', etag: '"9e107d9d372bb6826bd81d3542a419d6"', storage_class: 'STANDARD' },
    { key: 'reports/q2.xlsx', size: 1048576, last_modified: '2021-07-01T00:00:00.000Z', etag: '"e4d909c290d0fb1ca068ffaddf22cbd0"', storage_class: 'STANDARD_IA' },
  ],
  common_prefixes: [],
  key_count: 23,
  is_truncated: false,
  prefix: '',
  next_continuation_token: null,
}

const listObjects = awsS3Connector.referenceTemplates.find((t) => t.key === 'list_objects')!
/** The reference the S3 connector generates (lib/services/connectors referenceRowsFor). */
const connectorReference = () => ({
  outputs: listObjects.outputs.map((o) => normalizeReferenceOutput(o)),
  request_config: { response_schema: { version: 1, source: 'connector', root: schemaFromOutputs(listObjects.outputs.map((o) => ({ ...o, path: o.name }))) } },
})

describe('root cause: the S3 reference offered no usable rows list', () => {
  it('the connector model declares contents as a list with no item model, next to common_prefixes', () => {
    const model = referenceResponseSchema(connectorReference())!
    const lists = findCollections(model.root)
    expect(lists.map((c) => c.path)).toEqual(['contents', 'common_prefixes'])
    expect(lists.every((c) => c.itemSchema === null)).toBe(true)
    // Nothing to auto-pick and no fields to add as columns until a real response is seen.
    expect(autoPickCollection(lists)).toBeNull()
  })

  it('without a stored model, outputs with empty paths are top-level fields (not "the whole response" five times)', () => {
    const model = referenceResponseSchema({ outputs: connectorReference().outputs })!
    expect(model.root.type).toBe('object')
    expect(findCollections(model.root).map((c) => c.path)).toEqual(['contents', 'common_prefixes'])
    // A single unpathed output still means the whole response.
    expect(schemaFromOutputs([{ name: 'users', type: 'array' }])).toEqual({ type: 'array' })
  })
})

describe('schema inference from the S3 response', () => {
  const root = inferSchema(S3)
  it('types every field', () => {
    expect(root.type).toBe('object')
    const contents = root.fields!.find((f) => f.name === 'contents')!
    expect(contents.type).toBe('array')
    expect(contents.items?.fields?.map((f) => [f.name, f.type])).toEqual([
      ['key', 'string'], ['size', 'integer'], ['last_modified', 'string'], ['etag', 'string'], ['storage_class', 'string'],
    ])
    expect(root.fields!.find((f) => f.name === 'next_continuation_token')!.type).toBe('null')
    expect(root.fields!.find((f) => f.name === 'key_count')!.type).toBe('integer')
  })

  it('auto-picks contents (the only list of objects) and counts its items', () => {
    const lists = findCollections(root, S3)
    expect(lists.map((c) => c.path)).toEqual(['contents', 'common_prefixes'])
    expect(lists[0]).toMatchObject({ objectItems: true, nested: false, count: 3 })
    expect(autoPickCollection(lists)).toBe('contents')
  })
})

describe('collections at any depth', () => {
  it('finds deep lists, lists inside list items and the root list', () => {
    const root = inferSchema({
      data: { result: { items: [{ id: 1, owner: { display_name: 'Ann' }, tags: ['a'], lines: [{ sku: 'X', qty: 1 }] }] } },
      meta: { total: 1 },
    })
    const paths = findCollections(root).map((c) => c.path)
    expect(paths).toEqual(['data.result.items', 'data.result.items[].tags', 'data.result.items[].lines'])
    const lists = findCollections(root)
    expect(lists.find((c) => c.path === 'data.result.items[].lines')).toMatchObject({ nested: true, objectItems: true })
    // One list of objects outside other lists → it, even though another sits inside its items.
    expect(autoPickCollection(lists)).toBe('data.result.items')

    const rootList = inferSchema([{ id: 1, children: [[1, 2]] }])
    expect(findCollections(rootList).map((c) => c.path)).toEqual(['', '[].children', '[].children[]'])
    expect(autoPickCollection(findCollections(rootList))).toBe('')
  })

  it('leaves a real choice to the designer', () => {
    const lists = findCollections(inferSchema({ users: [{ id: 1 }], groups: [{ id: 2 }] }))
    expect(autoPickCollection(lists)).toBeNull()
    expect(autoPickCollection(findCollections(inferSchema({ names: ['a', 'b'] })))).toBe('names')
  })
})

describe('typed paths', () => {
  const root = inferSchema({ body: { value: [{ children: [{ id: 1 }] }] }, contents: [{ key: 'a' }], count: 2, one: { id: 1 } })
  it('normalizes the spellings designers type', () => {
    expect(normalizeCollectionPath(' contents[] ')).toBe('contents')
    expect(normalizeCollectionPath('$.data.items')).toBe('data.items')
    expect(normalizeCollectionPath('body.value.0.children')).toBe('body.value[0].children')
    expect(normalizeCollectionPath('data.items.')).toBe('data.items')
  })

  it('validates against the model', () => {
    expect(validateCollectionPath(root, 'contents')).toMatchObject({ ok: true, path: 'contents' })
    expect(validateCollectionPath(root, 'body.value[0].children')).toMatchObject({ ok: true })
    expect(validateCollectionPath(root, 'body.value[].children').itemSchema?.fields?.[0].name).toBe('id')
    expect(validateCollectionPath(root, 'nope')).toMatchObject({ ok: false, message: 'The response has no "nope".' })
    expect(validateCollectionPath(root, 'count')).toMatchObject({ ok: false, message: '"count" is a number, not a list.' })
    expect(validateCollectionPath(root, 'one')).toMatchObject({ ok: true, message: 'This is a single object — it becomes one row.' })
    // The response itself as rows only when it is a list (the server reads no rows from an object).
    expect(validateCollectionPath(root, '')).toMatchObject({ ok: false })
    expect(collectionAt({ one: { id: 1 } }, '')).toEqual([])
    expect(collectionAt({ one: { id: 1 } }, 'one')).toEqual([{ id: 1 }])
    expect(validateCollectionPath(root, 'a..b').ok).toBe(false)
    expect(validateCollectionPath(root, 'a b').ok).toBe(false)
    // No model: only the syntax is checked.
    expect(validateCollectionPath(null, 'data.items')).toMatchObject({ ok: true })
    expect(isCollectionPath('__proto__.x')).toBe(false)
  })
})

describe('designer path = runtime path', () => {
  const dataTable = (results_path: string | undefined) => normalizeDataTableConfig({ source: 'reference', reference_id: 'r', mode: 'display', results_path, columns: [{ key: 'key', label: 'Key', type: 'text' }] })
  const lookup = (results_path: string | undefined) => normalizeLookupConfig({ source: 'reference', reference_id: 'r', results_path })

  it('the S3 shape: the auto-picked path reads the contents rows in the Data table, lookups and Loops', () => {
    const model = captureResponseSample(referenceResponseSchema(connectorReference()), S3)
    const view = runtimeView(model)
    const picked = autoPickCollection(findCollections(view.root, view.sample))!
    expect(picked).toBe('contents')
    // The stored config keeps the path and the server reads the same rows.
    expect(dataTable(picked).results_path).toBe('contents')
    expect(responseRows(dataTable(picked), S3)).toEqual(S3.contents)
    expect(lookupResultsArray(lookup(picked), S3)).toEqual(S3.contents)
    const expression = workflowCollectionExpression('list_files_response', picked)
    expect(expression).toBe('{{list_files_response.contents}}')
    expect(resolveExpression(expression, { variables: { list_files_response: S3 } } as never)).toEqual(S3.contents)
    expect(collectionPathFromExpression(expression, 'list_files_response')).toBe('contents')
  })

  it('every list the picker offers resolves to the same rows on the server', () => {
    const response = {
      data: { result: { items: [{ id: 1, lines: [{ sku: 'A' }, { sku: 'B' }] }, { id: 2, lines: [{ sku: 'C' }] }] } },
      body: { value: [{ children: [{ id: 'c1' }, { id: 'c2' }] }] },
    }
    const root = inferSchema(response)
    const expected: Record<string, unknown[]> = {
      'data.result.items': response.data.result.items,
      'data.result.items[].lines': [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }],
      'body.value': response.body.value,
      'body.value[].children': [{ id: 'c1' }, { id: 'c2' }],
    }
    for (const { path } of findCollections(root)) {
      expect(dataTable(path).results_path).toBe(path)
      expect(responseRows(dataTable(path), response)).toEqual(expected[path])
      expect(lookupResultsArray(lookup(path), response)).toEqual(expected[path])
      expect(resolveExpression(workflowCollectionExpression('step_response', path), { variables: { step_response: response } } as never)).toEqual(expected[path])
    }
    // Typed index paths too.
    expect(responseRows(dataTable('body.value[0].children'), response)).toEqual([{ id: 'c1' }, { id: 'c2' }])
    expect(resolveExpression(workflowCollectionExpression('step_response', 'body.value[0].children'), { variables: { step_response: response } } as never)).toEqual([{ id: 'c1' }, { id: 'c2' }])
    // The root list.
    expect(responseRows(dataTable(undefined), [{ a: 1 }])).toEqual([{ a: 1 }])
    expect(collectionAt({ a: 1 }, '')).toEqual([])
  })

  it('a model captured with its wrapper shows paths relative to the body the runtime reads', () => {
    const wrapped: ResponseSchema = { version: 1, source: 'manual', root: inferSchema({ status: 200, headers: { 'content-type': 'application/json' }, data: S3 }), sample: { status: 200, headers: {}, data: S3 } }
    const view = runtimeView(wrapped)
    expect(view.unwrapped).toBe('data')
    const picked = autoPickCollection(findCollections(view.root, view.sample))
    expect(picked).toBe('contents')
    expect(responseRows(dataTable(picked!), S3)).toHaveLength(3)
    expect(unwrapExecutorResult({ status: 200, data: S3, headers: {} })).toBe(S3)
    // A payload that merely has a "data" key is not a wrapper.
    expect(runtimeView({ version: 1, source: 'sample', root: inferSchema({ data: [{ id: 1 }], page: 1 }) }).unwrapped).toBeNull()
  })

  it('never walks into prototypes', () => {
    expect(collectionAt({ a: [1] }, '__proto__')).toEqual([])
    expect(collectionAt({ a: [1] }, 'constructor.prototype')).toEqual([])
  })
})

describe('item fields', () => {
  it('lists nested item fields up to 3 levels with formats that default well', () => {
    const item = inferSchema({ key: 'a.pdf', size: 1024, last_modified: '2021-06-02T16:44:29.000Z', created: '2021-06-02', owner: { display_name: 'Ann', id: 'u1', org: { name: 'Acme', region: { code: 'nz' } } }, tags: ['x'] })
    const fields = collectionItemFields(item)
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]))
    expect(byPath.size.format).toBe('file_size')
    expect(byPath.last_modified.format).toBe('datetime')
    expect(byPath.created.format).toBe('date')
    expect(byPath.key.format).toBe('text')
    expect(byPath.owner.container).toBe(true)
    expect(byPath['owner.display_name']).toMatchObject({ level: 1, type: 'string', example: 'Ann' })
    expect(byPath['owner.org.name']).toMatchObject({ level: 2 })
    // The 4th level is offered as one JSON field, not walked.
    expect(byPath['owner.org.region']).toMatchObject({ type: 'object', format: 'json' })
    expect(byPath['owner.org.region.code']).toBeUndefined()
    expect(byPath.tags.format).toBe('json')
  })

  it('formats', () => {
    expect(suggestFieldFormat('size', 'integer', 0)).toBe('file_size')
    expect(suggestFieldFormat('contentLength', 'integer', 0)).toBe('file_size')
    expect(suggestFieldFormat('size_bytes', 'number', 1.5)).toBe('file_size')
    expect(suggestFieldFormat('quantity', 'integer', 3)).toBe('integer')
    expect(suggestFieldFormat('price', 'number', 3.5)).toBe('number')
    expect(suggestFieldFormat('size', 'string', 'XL')).toBe('text')
  })
})

describe('paging hints', () => {
  it('finds continuation keys, next links and totals', () => {
    expect(pagingHints(inferSchema(S3))).toEqual([
      { path: 'is_truncated', kind: 'has_more' },
      { path: 'next_continuation_token', kind: 'cursor' },
    ])
    expect(pagingHints(inferSchema({ value: [], '@odata.nextLink': 'https://x', '@odata.count': 4 }))).toEqual([
      { path: '@odata.nextLink', kind: 'next_link' }, { path: '@odata.count', kind: 'total' },
    ])
    expect(pagingHints(inferSchema({ data: [], meta: { total: 4, next: null } }))).toEqual([{ path: 'meta.total', kind: 'total' }, { path: 'meta.next', kind: 'next_link' }])
  })
})

describe('merging a sample into an existing model', () => {
  const at = new Date('2026-10-31T00:00:00Z')
  it('a connector model keeps its structure and gains the item fields', () => {
    const merged = captureResponseSample(referenceResponseSchema(connectorReference()), S3, at)
    expect(merged.source).toBe('connector')
    expect(merged.samples).toBe(1)
    const contents = merged.root.fields!.find((f) => f.name === 'contents')!
    expect(contents.items?.fields?.map((f) => f.name)).toEqual(['key', 'size', 'last_modified', 'etag', 'storage_class'])
    // Fields only the sample has are added, not required.
    expect(merged.root.fields!.find((f) => f.name === 'prefix')).toMatchObject({ required: false })
  })

  it('a second sample merges into the first', () => {
    const first = captureResponseSample(null, S3, at)
    const second = captureResponseSample(first, { ...S3, contents: [{ key: 'b', size: 1, last_modified: '2021-01-01T00:00:00Z', owner: { display_name: 'Ann' } }] }, at)
    expect(second.source).toBe('sample')
    expect(second.samples).toBe(2)
    const item = second.root.fields!.find((f) => f.name === 'contents')!.items!
    expect(item.fields!.map((f) => f.name)).toEqual(['key', 'size', 'last_modified', 'owner', 'etag', 'storage_class'])
    expect(item.fields!.find((f) => f.name === 'owner')).toMatchObject({ required: false })
  })

  it('a response that contradicts the model\'s top level replaces it rather than turning it into "any"', () => {
    const objectModel: ResponseSchema = { version: 1, source: 'connector', root: { type: 'object', fields: [{ name: 'users', type: 'array' }] } }
    const merged = captureResponseSample(objectModel, [{ id: 1 }], at)
    expect(merged).toMatchObject({ source: 'sample', root: { type: 'array' } })
    // A broken outputs-derived model (whole response = a list) is replaced too.
    const broken = captureResponseSample({ version: 1, source: 'outputs', root: { type: 'array' } }, S3, at)
    expect(broken.root.type).toBe('object')
  })

  it('regenerating connector references keeps a captured model', () => {
    const generated = { method: 'GET', response_schema: { version: 1, source: 'connector', root: { type: 'object', fields: [] } } }
    const captured = captureResponseSample(referenceResponseSchema(connectorReference()), S3, at)
    expect(keepCapturedModel(generated, { response_schema: captured }).response_schema).toMatchObject({ source: 'connector', samples: 1 })
    expect(keepCapturedModel(generated, { response_schema: generated.response_schema }).response_schema).toBe(generated.response_schema)
    expect(keepCapturedModel(generated, null)).toBe(generated)
  })
})
