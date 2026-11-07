import { describe, expect, it } from 'vitest'
import { coerceInputValue, publicInputRows, resolveCustomInputs, CustomReferenceError } from '@/lib/custom-references/inputs'
import { customOutputModel, sqlTypeToSchemaType } from '@/lib/custom-references/model'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { apiParameterValues, compareValues, describeShaping, planShaping, shapeResult, testCondition } from '@/lib/custom-references/shaping'
import { compileTableQuery, quoteIdent } from '@/lib/custom-references/sql'
import { compileSql } from '@/lib/db-reference'
import type { CustomReferenceConfig } from '@/lib/custom-references/types'

const S3_ROWS = {
  Name: 'docs',
  IsTruncated: false,
  Contents: [
    { Key: 'reports/2026/a.pdf', Size: 1200, LastModified: '2026-10-01T10:00:00Z', Owner: { DisplayName: 'ann', Address: { Country: 'NZ' } } },
    { Key: 'reports/2026/b.pdf', Size: 50, LastModified: '2026-10-03T10:00:00Z', Owner: { DisplayName: 'bob', Address: { Country: 'AU' } } },
    { Key: 'images/c.png', Size: 900, LastModified: '2026-10-02T10:00:00Z', Owner: { DisplayName: 'cat', Address: { Country: 'NZ' } } },
    { Key: 'reports/2025/d.pdf', Size: 300, LastModified: '2025-01-02T10:00:00Z', Owner: { DisplayName: 'dan', Address: { Country: 'US' } } },
  ],
}

const S3_SOURCE = {
  type: 'operation' as const,
  inputs: [{ name: 'bucket', location: 'path' }, { name: 'prefix' }, { name: 'max_keys' }, { name: 'sort' }, { name: 'order' }, { name: 'offset' }],
  params: [] as Array<{ name: string; value: string }>,
}

function s3Config(extra: Partial<CustomReferenceConfig> = {}): CustomReferenceConfig {
  return normalizeCustomConfig({
    kind: 'list',
    source: { ...S3_SOURCE, params: [{ name: 'bucket', value: '{{input.bucket}}' }] },
    inputs: [
      { name: 'bucket', type: 'string', mode: 'fixed', fixed_value: 'docs' },
      { name: 'prefix', type: 'string' },
    ],
    rows_path: 'Contents',
    columns: [{ path: 'Key', alias: 'key' }, { path: 'Size', alias: 'size', type: 'integer' }, { path: 'LastModified', alias: 'last_modified', type: 'date' }],
    filter: { op: 'and', conditions: [{ field: 'Key', operator: 'starts_with', value: '{{input.prefix}}' }] },
    sort: [{ field: 'last_modified', direction: 'desc' }],
    ...extra,
  })
}

describe('custom references: shaping pipeline', () => {
  it('filter → sort → project: S3 list keeps only key/size/last_modified, prefix-filtered, newest first', () => {
    const config = s3Config()
    const { values } = resolveCustomInputs(config, { prefix: 'reports/' })
    const { data, stats } = shapeResult(S3_ROWS, config, values)
    expect(data).toEqual([
      { key: 'reports/2026/b.pdf', size: 50, last_modified: '2026-10-03T10:00:00Z' },
      { key: 'reports/2026/a.pdf', size: 1200, last_modified: '2026-10-01T10:00:00Z' },
      { key: 'reports/2025/d.pdf', size: 300, last_modified: '2025-01-02T10:00:00Z' },
    ])
    expect(stats).toMatchObject({ fetched: 4, matched: 3, returned: 3, truncated: false })
  })

  it('a blank optional {{input.x}} skips its condition', () => {
    const config = s3Config()
    const { values } = resolveCustomInputs(config, {})
    expect((shapeResult(S3_ROWS, config, values).data as unknown[]).length).toBe(4)
  })

  it('distinct countries from a nested path, ordered by the column when there is no sort', () => {
    const config = normalizeCustomConfig({
      kind: 'list', source: S3_SOURCE, inputs: [], rows_path: 'Contents',
      columns: [{ path: 'Owner.Address.Country', alias: 'country' }], distinct: true,
    })
    expect(shapeResult(S3_ROWS, config, {}).data).toEqual([{ country: 'AU' }, { country: 'NZ' }, { country: 'US' }])
  })

  it('distinct runs before sort and projection (first occurrence kept, then sorted)', () => {
    const config = normalizeCustomConfig({
      kind: 'list', source: S3_SOURCE, inputs: [], rows_path: 'Contents',
      columns: [{ path: 'Owner.Address.Country', alias: 'country' }], distinct: true, sort: [{ field: 'Size', direction: 'desc' }],
    })
    // NZ first seen with Size 1200, AU 50, US 300 → by size desc
    expect(shapeResult(S3_ROWS, config, {}).data).toEqual([{ country: 'NZ' }, { country: 'US' }, { country: 'AU' }])
  })

  it('projection: aliases, nested paths up to 3 levels, missing values as null', () => {
    const config = normalizeCustomConfig({
      kind: 'list', source: S3_SOURCE, inputs: [], rows_path: 'Contents',
      columns: [{ path: 'Owner.DisplayName', alias: 'owner' }, { path: 'Owner.Address.Country' }, { path: 'Missing' }],
    })
    expect((shapeResult(S3_ROWS, config, {}).data as any[])[0]).toEqual({ owner: 'ann', Country: 'NZ', Missing: null })
    expect(() => normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'a.b.c.d' }] })).toThrow(/nested more than 3/)
  })

  it('AND / OR groups', () => {
    const config = normalizeCustomConfig({
      kind: 'list', source: S3_SOURCE, inputs: [], rows_path: 'Contents', columns: [{ path: 'Key' }],
      filter: { op: 'and', conditions: [
        { field: 'Size', operator: 'gte', value: 100 },
        { op: 'or', conditions: [{ field: 'Owner.Address.Country', operator: 'eq', value: 'US' }, { field: 'Key', operator: 'ends_with', value: '.png' }] },
      ] },
    })
    expect(shapeResult(S3_ROWS, config, {}).data).toEqual([{ Key: 'images/c.png' }, { Key: 'reports/2025/d.pdf' }])
  })

  it.each([
    ['eq', 5, '5', true], ['neq', 'a', 'b', true], ['gt', 10, 9, true], ['gte', 9, 9, true], ['lt', '2026-01-01', '2026-02-01', true],
    ['lte', 3, 2, false], ['contains', 'Hello World', 'world', true], ['not_contains', 'abc', 'x', true], ['starts_with', 'Report', 're', true],
    ['ends_with', 'file.PDF', '.pdf', true], ['in', 'NZ', 'AU, NZ', true], ['not_in', 'NZ', ['AU', 'US'], true], ['is_empty', '', undefined, true],
    ['is_empty', [], undefined, true], ['is_not_empty', 0, undefined, true], ['gt', null, 1, false],
  ] as const)('operator %s(%j, %j) = %s', (op, field, expected, result) => {
    expect(testCondition(field, op as any, expected)).toBe(result)
  })

  it('compares numbers numerically, ISO dates chronologically, text naturally', () => {
    expect(compareValues('10', '9')).toBe(1)
    expect(compareValues('2026-01-02T00:00:00Z', '2025-12-31')).toBe(1)
    expect(compareValues('file2', 'file10')).toBe(-1)
  })

  it('sort is stable, multi-column, empties last', () => {
    const rows = [{ g: 'b', n: 1 }, { g: 'a', n: 2 }, { g: '', n: 3 }, { g: 'a', n: 1 }]
    const config = normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'g' }, { path: 'n' }], sort: [{ field: 'g', direction: 'asc' }, { field: 'n', direction: 'desc' }] })
    expect(shapeResult(rows, config, {}).data).toEqual([{ g: 'a', n: 2 }, { g: 'a', n: 1 }, { g: 'b', n: 1 }, { g: '', n: 3 }])
  })

  it('limit / paging: page size, max rows, page + limit inputs, { rows, total }', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }))
    const base = { kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'id' }] }
    expect((shapeResult(rows, normalizeCustomConfig({ ...base, page_size: 5 }), {}).data as any[]).map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
    const paged = normalizeCustomConfig({ ...base, page_size: 10, max_rows: 12, paging_inputs: true, include_total: true })
    const { values } = resolveCustomInputs(paged, { page: 3, limit: 50 })
    expect(values.limit).toBe(12) // capped by max rows
    expect(shapeResult(rows, paged, values).data).toEqual({ rows: rows.slice(24, 30), total: 30 })
  })

  it('caps server-side shaping at 1,000 source rows and says so', () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }))
    const config = normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'id' }], include_total: true })
    const result = shapeResult(rows, config, {})
    expect(result.stats).toMatchObject({ fetched: 1000, truncated: true })
    expect((result.data as any).total).toBe(1000)
  })

  it('stops shaping past its time budget', () => {
    const config = s3Config()
    expect(() => shapeResult(S3_ROWS, config, { prefix: 'r' }, { now: () => 0 })).not.toThrow()
    let calls = 0
    const clock = () => (calls++ === 0 ? 0 : 60_000) // the first reading sets the deadline; later ones are past it
    expect(() => shapeResult(S3_ROWS, config, { prefix: 'r' }, { now: clock })).toThrow(/took too long/)
  })
})

describe('custom references: read vs list output', () => {
  it('read returns one projected object (key matched on the server), null when missing', () => {
    const config = normalizeCustomConfig({
      kind: 'read', source: S3_SOURCE, inputs: [{ name: 'key', type: 'string', required: true }], rows_path: 'Contents',
      columns: [{ path: 'Key', alias: 'key' }, { path: 'Size', alias: 'size' }], read: { key_input: 'key', key_field: 'Key' },
    })
    expect(shapeResult(S3_ROWS, config, { key: 'images/c.png' }).data).toEqual({ key: 'images/c.png', size: 900 })
    expect(shapeResult(S3_ROWS, config, { key: 'nope' })).toMatchObject({ data: null })
  })

  it('read with not_found = error flags it', () => {
    const config = normalizeCustomConfig({
      kind: 'read', source: S3_SOURCE, inputs: [{ name: 'key', type: 'string' }], rows_path: 'Contents', columns: [{ path: 'Key' }],
      read: { key_input: 'key', key_field: 'Key', not_found: 'error' },
    })
    expect(shapeResult(S3_ROWS, config, { key: 'nope' }).notFound).toBe(true)
  })

  it('a read of a single object response (no rows path)', () => {
    const config = normalizeCustomConfig({ kind: 'read', source: S3_SOURCE, inputs: [], rows_path: 'Owner', columns: [{ path: 'DisplayName', alias: 'name' }] })
    expect(shapeResult({ Owner: { DisplayName: 'ann', Secret: 'x' } }, config, {}).data).toEqual({ name: 'ann' })
  })
})

describe('custom references: inputs', () => {
  it('validates declared types and drops unknown inputs', () => {
    const config = normalizeCustomConfig({
      kind: 'list', source: S3_SOURCE, columns: [{ path: 'Key' }],
      inputs: [{ name: 'n', type: 'integer' }, { name: 'flag', type: 'boolean' }, { name: 'when', type: 'date' }, { name: 'tags', type: 'array' }],
    })
    const { values } = resolveCustomInputs(config, { n: '42', flag: 'yes', when: '2026-01-01', tags: 'a, b', sneaky: 'x', __proto__: 'y' })
    expect(values).toEqual({ n: 42, flag: true, when: '2026-01-01', tags: ['a', 'b'] })
    expect(() => resolveCustomInputs(config, { n: '4.5' })).toThrow(/whole number/)
    expect(() => resolveCustomInputs(config, { flag: 'maybe' })).toThrow(/true or false/)
    expect(() => resolveCustomInputs(config, { when: 'not a date' })).toThrow(/must be a date/)
    expect(() => coerceInputValue('object', '[1]', 'o')).toThrow(CustomReferenceError)
  })

  it('required inputs and defaults', () => {
    const config = normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, columns: [{ path: 'Key' }], inputs: [{ name: 'a', type: 'string', required: true }, { name: 'b', type: 'number', default_value: '7' }] })
    expect(() => resolveCustomInputs(config, {})).toThrow(/Required input "a"/)
    expect(resolveCustomInputs(config, { a: 'x' }).values).toEqual({ a: 'x', b: 7 })
  })

  it('a Fixed input is never taken from the caller and is hidden from the public inputs', () => {
    const config = s3Config()
    const { values } = resolveCustomInputs(config, { bucket: 'someone-elses-bucket', prefix: 'r' })
    expect(values.bucket).toBe('docs')
    expect(apiParameterValues(config, values)).toEqual({ bucket: 'docs' })
    expect(publicInputRows(config).map((i) => i.name)).toEqual(['prefix'])
  })

  it('a Fixed input can use an integration setting (server-side) and marks credentials sensitive', () => {
    const config = normalizeCustomConfig({
      kind: 'list', source: S3_SOURCE, columns: [{ path: 'Key' }],
      inputs: [{ name: 'bucket', type: 'string', mode: 'fixed', fixed_setting: 'bucket' }, { name: 'auth', type: 'string', mode: 'fixed', fixed_setting: 'api_token' }],
      source_params_ignored: true,
    }, { settingNames: new Set(['bucket', 'api_token']) })
    const resolved = resolveCustomInputs(config, { bucket: 'evil' }, { bucket: 'docs', api_token: 's3cr3t' })
    expect(resolved.values).toMatchObject({ bucket: 'docs', auth: 's3cr3t' })
    expect(Array.from(resolved.sensitive)).toEqual(['auth'])
    expect(() => resolveCustomInputs(config, {}, {})).toThrow(/not set/)
  })

  it('refuses secrets typed as plain Fixed values, unknown settings, and credentials in server-side filters', () => {
    const base = { kind: 'list', source: S3_SOURCE, columns: [{ path: 'Key' }] }
    expect(() => normalizeCustomConfig({ ...base, inputs: [{ name: 'api_key', type: 'string', mode: 'fixed', fixed_value: 'sk-123' }] })).toThrow(/looks like a secret/)
    expect(() => normalizeCustomConfig({ ...base, inputs: [{ name: 'client_secret', type: 'string', mode: 'fixed', fixed_value: 'x' }] })).toThrow(/looks like a secret/)
    expect(() => normalizeCustomConfig({ ...base, inputs: [{ name: 'b', type: 'string', mode: 'fixed', fixed_setting: 'nope' }] }, { settingNames: new Set(['bucket']) })).toThrow(/no setting "nope"/)
    expect(() => normalizeCustomConfig({
      ...base,
      inputs: [{ name: 'tok', type: 'string', mode: 'fixed', fixed_setting: 'access_token' }],
      filter: { op: 'and', conditions: [{ field: 'Key', operator: 'contains', value: '{{input.tok}}' }] },
    })).toThrow(/holds a credential/)
  })

  it('existing references convert cleanly: inputs without a mode are Ask', () => {
    const config = normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, columns: [{ path: 'Key' }], inputs: [{ name: 'prefix', type: 'string' }] })
    expect(config.inputs[0].mode).toBe('ask')
  })

  it('refuses undeclared {{input.x}} and names that collide with paging inputs', () => {
    expect(() => normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'Key' }], filter: { op: 'and', conditions: [{ field: 'Key', operator: 'eq', value: '{{input.ghost}}' }] } })).toThrow(/not declared/)
    expect(() => normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [{ name: 'page', type: 'integer' }], paging_inputs: true, columns: [{ path: 'Key' }] })).toThrow(/reserved/)
  })
})

describe('custom references: REST mapping vs server-applied', () => {
  it('a top-level AND condition can be sent to the API; the rest stay on the server', () => {
    const config = s3Config({
      filter: { op: 'and', conditions: [
        { field: 'Key', operator: 'starts_with', value: '{{input.prefix}}', api_param: 'prefix' },
        { field: 'Size', operator: 'gt', value: 100 },
      ] },
      api: { sort_param: 'sort', order_param: 'order', limit_param: 'max_keys', offset_param: 'offset' },
      page_size: 2,
    } as any)
    const plan = planShaping(config)
    expect(Array.from(plan.apiConditions)).toEqual([0])
    expect(plan).toMatchObject({ apiSort: true, apiPaging: true, allAtSource: false })
    const { values } = resolveCustomInputs(config, { prefix: 'reports/' })
    expect(apiParameterValues(config, values, plan)).toEqual({ bucket: 'docs', prefix: 'reports/', sort: 'last_modified', order: 'desc', max_keys: 2, offset: 0 })
    // The API already filtered by prefix: the server applies only Size > 100, keeps the API's order.
    const data = shapeResult(S3_ROWS, config, values, { plan }).data as any[]
    expect(data.map((r) => r.key)).toEqual(['reports/2026/a.pdf', 'images/c.png'])
    const where = describeShaping(config)
    expect(where.api.join(' ')).toMatch(/prefix/)
    expect(where.server.join(' ')).toMatch(/Filter \(1 condition\)/)
  })

  it('API mapping is refused inside OR groups and for unknown parameters', () => {
    expect(() => normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'Key' }], filter: { op: 'or', conditions: [{ field: 'Key', operator: 'eq', value: 'x', api_param: 'prefix' }] } })).toThrow(/top-level/)
    expect(() => normalizeCustomConfig({ kind: 'list', source: S3_SOURCE, inputs: [], columns: [{ path: 'Key' }], filter: { op: 'and', conditions: [{ field: 'Key', operator: 'eq', value: 'x', api_param: 'nope' }] } })).toThrow(/no parameter/)
  })
})

describe('custom references: database tables compile to parameterised SQL', () => {
  const tableConfig = (extra: any = {}) => normalizeCustomConfig({
    kind: 'list',
    source: { type: 'table', schema: 'dbo', table: 'Customers', columns: [{ name: 'Id', type: 'int' }, { name: 'Name', type: 'nvarchar' }, { name: 'Country', type: 'nvarchar' }] },
    inputs: [{ name: 'q', type: 'string' }, { name: 'country', type: 'string' }],
    columns: [{ path: 'Name', alias: 'name' }, { path: 'Country' }],
    filter: { op: 'and', conditions: [
      { field: 'Name', operator: 'contains', value: '{{input.q}}' },
      { op: 'or', conditions: [{ field: 'Country', operator: 'eq', value: '{{input.country}}' }, { field: 'Country', operator: 'in', value: ['NZ', 'AU'] }] },
    ] },
    sort: [{ field: 'name', direction: 'desc' }],
    page_size: 25,
    ...extra,
  })

  it('postgres: quoted identifiers, every value a token bound as a driver parameter', () => {
    const q = compileTableQuery(tableConfig(), { q: "x'; DROP TABLE t; --", country: 'US' }, 'postgres')
    expect(q.sql).toBe(`SELECT "Name" AS "name", "Country" FROM "dbo"."Customers" WHERE (LOWER(CAST("Name" AS text)) LIKE {{cv0}} ESCAPE '!' AND ("Country" = {{cv1}} OR "Country" IN ({{cv2}}, {{cv3}}))) ORDER BY "Name" DESC LIMIT 25`)
    expect(q.values).toEqual({ cv0: "%x'; drop table t; --%", cv1: 'US', cv2: 'NZ', cv3: 'AU' })
    expect(q.sql).not.toContain('DROP')
    // lib/db-reference binds the tokens: the value never reaches the SQL text.
    const compiled = compileSql(q.sql, 'postgres', q.values, q.inputs, undefined, 1000)
    expect(compiled.sql).toContain('LIKE $1')
    expect(compiled.params).toEqual(["%x'; drop table t; --%", 'US', 'NZ', 'AU'])
  })

  it('mssql paging, distinct ordering, blank optional inputs skip their condition, LIKE wildcards escaped', () => {
    const config = tableConfig({ distinct: true, sort: [], paging_inputs: true, filter: { op: 'and', conditions: [{ field: 'Name', operator: 'starts_with', value: '{{input.q}}' }, { field: 'Country', operator: 'eq', value: '{{input.country}}' }] } })
    const q = compileTableQuery(config, { q: '50%_off', country: '', page: 3, limit: 10 }, 'mssql')
    expect(q.sql).toBe(`SELECT DISTINCT [Name] AS [name], [Country] FROM [dbo].[Customers] WHERE LOWER(CAST([Name] AS NVARCHAR(MAX))) LIKE {{cv0}} ESCAPE '!' ORDER BY [Name] ASC, [Country] ASC OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY`)
    expect(q.values.cv0).toBe('50!%!_off%')
  })

  it('read kind: key input bound, LIMIT 1; include_total adds a COUNT query', () => {
    const read = normalizeCustomConfig({
      kind: 'read', source: { type: 'table', table: 'Customers', columns: [{ name: 'Id' }, { name: 'Name' }] },
      inputs: [{ name: 'id', type: 'integer', required: true }], columns: [{ path: 'Name' }], read: { key_input: 'id', key_field: 'Id' },
    })
    const q = compileTableQuery(read, { id: 7 }, 'mysql')
    expect(q.sql).toBe('SELECT `Name` FROM `Customers` WHERE `Id` = {{cv0}} LIMIT 1')
    const listed = compileTableQuery(tableConfig({ include_total: true }), {}, 'oracle')
    expect(listed.countSql).toMatch(/^SELECT COUNT\(\*\) AS total FROM \(SELECT "Name" AS "name", "Country" FROM "dbo"."Customers" WHERE "Country" IN/)
    expect(listed.sql).toMatch(/OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY$/)
  })

  it('only introspected columns and safe names are accepted', () => {
    expect(() => normalizeCustomConfig({ kind: 'list', source: { type: 'table', table: 'T', columns: [{ name: 'a' }] }, inputs: [], columns: [{ path: 'b' }] })).toThrow(/not a column/)
    expect(() => quoteIdent('a"; DROP TABLE x; --', 'postgres')).toThrow()
    expect(() => quoteIdent('a]--', 'mssql')).toThrow()
    const bad = tableConfig({ filter: { op: 'and', conditions: [{ field: 'Secret', operator: 'eq', value: 1 }] } })
    expect(() => compileTableQuery(bad, {}, 'postgres')).toThrow(/not a column/)
  })

  it('with distinct, sort columns must be selected', () => {
    expect(() => tableConfig({ distinct: true, sort: [{ field: 'Id', direction: 'asc' }] })).toThrow(/selected column/)
  })
})

describe('custom references: output model', () => {
  it('list → array of the projected columns with types; total → { rows, total }; read → nullable object', () => {
    const config = s3Config()
    const list = customOutputModel(config, { type: 'object', fields: [{ name: 'Key', type: 'string' }] })
    expect(list.response_schema.root).toEqual({
      type: 'array',
      items: { type: 'object', fields: [{ name: 'key', type: 'string' }, { name: 'size', type: 'integer' }, { name: 'last_modified', type: 'string', format: 'date-time' }] },
    })
    expect(list.outputs.map((o) => [o.name, o.path, o.type])).toEqual([['key', '[].key', 'string'], ['size', '[].size', 'number'], ['last_modified', '[].last_modified', 'string']])
    expect(list.response_schema.source).toBe('manual') // never overwritten by "auto" sample capture

    const total = customOutputModel({ ...config, include_total: true }, null)
    expect(total.response_schema.root.fields?.map((f) => f.name)).toEqual(['rows', 'total'])

    const read = customOutputModel({ ...config, kind: 'read' }, null)
    expect(read.response_schema.root).toMatchObject({ type: 'object', nullable: true })
    expect(read.outputs[0]).toMatchObject({ name: 'key', path: 'key' })
  })

  it('table columns map SQL types', () => {
    expect(['int', 'bigint', 'numeric(10,2)', 'bit', 'jsonb', 'nvarchar(50)'].map(sqlTypeToSchemaType)).toEqual(['integer', 'integer', 'number', 'boolean', 'object', 'string'])
  })
})
