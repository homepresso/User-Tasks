import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/exit-codes'
import { dependenciesOnlyFrom, parseRefSpec, parseSelection } from '../src/commands/package-authoring'
import { harness, ok, type Recorded } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const uid = (n: number) => `3fa8c21b-0000-4000-8000-${String(n).padStart(12, '0')}`
const hit = (n: number, name: string, type = 'workflow', extra: Record<string, unknown> = {}) => ({ type, id: uid(n), name, label: type === 'workflow' ? 'Workflow' : 'Data table', description: null, updated_at: '2026-10-20T10:00:00Z', created_by: null, tags: [], ...extra })
const page = (assets: unknown[], extra: Record<string, unknown> = {}) => ({ assets, total: assets.length, counts: { workflow: assets.length }, next_cursor: null, types: [], hidden_types: [], ...extra })
const pkg = { id: uid(900), name: 'Invoice approval', slug: 'invoice-approval', description: null, latest_version: null, roots: [{ type: 'workflow', id: uid(1) }], items: [], excluded: [], data_modes: {} }

function route(handlers: Record<string, (request: Recorded) => unknown>) {
  return (request: Recorded) => {
    const k = `${request.method} ${request.url.pathname.replace('/api/v1', '')}`
    const handler = handlers[k]
    if (!handler) return { status: 404, body: { success: false, error: { message: `no route ${k}` } } }
    return ok(handler(request))
  }
}

describe('helpers', () => {
  it('parses refs: type:id, bare ids, type:name and names', () => {
    expect(parseRefSpec(`data_table:${uid(1)}`)).toEqual({ type: 'data_table', id: uid(1) })
    expect(parseRefSpec(`data-table:${uid(1)}`)).toEqual({ type: 'data_table', id: uid(1) })
    expect(parseRefSpec(uid(2))).toEqual({ type: 'workflow', id: uid(2) })
    expect(parseRefSpec('email_template:Approval request')).toEqual({ type: 'email_template', name: 'Approval request' })
    expect(parseRefSpec('Invoice approval: EU')).toEqual({ type: 'workflow', name: 'Invoice approval: EU' })
  })

  it('parses selections', () => {
    expect(parseSelection('1, 3-4', 5)).toEqual([0, 2, 3])
    expect(parseSelection('a', 3)).toEqual([0, 1, 2])
    expect(parseSelection('', 3)).toEqual([])
    expect(() => parseSelection('7', 3)).toThrow(/between 1 and 3/)
    expect(() => parseSelection('x', 3)).toThrow(/not a number/)
  })

  it('finds the dependencies only the new items pulled in', () => {
    const items = [
      { type: 'workflow', id: uid(1), name: 'Root', label: 'Workflow', included_as: 'root' as const, required_by: 'root' as const },
      { type: 'workflow', id: uid(2), name: 'New', label: 'Workflow', included_as: 'manual' as const, required_by: 'root' as const },
      { type: 'data_table', id: uid(3), name: 'Only new', label: 'Data table', included_as: 'dependency' as const, required_by: { type: 'workflow', id: uid(2) } },
      { type: 'data_table', id: uid(4), name: 'Shared', label: 'Data table', included_as: 'dependency' as const, required_by: { type: 'workflow', id: uid(2) } },
    ]
    expect(dependenciesOnlyFrom(items, [{ type: 'workflow', id: uid(2) }], new Set([`workflow:${uid(1)}`, `data_table:${uid(4)}`]))).toEqual([{ type: 'data_table', id: uid(3) }])
  })
})

describe('packages assets', () => {
  it('searches with filters and prints a table with counts and the next cursor', async () => {
    const h = harness({ env, responder: route({ 'GET /packages/assets': () => page([hit(1, 'Invoice approval'), hit(2, 'Vendors', 'data_table', { in_package: 'dependency' })], { total: 3012, counts: { workflow: 3000, data_table: 12 }, next_cursor: 'abc' }) }) })
    expect(await h.run('packages', 'assets', 'inv', '--type', 'workflow,data-table', '--updated-since', '7d', '--package', 'invoice-approval', '--limit', '2', '-o', 'table')).toBe(EXIT.ok)
    const query = Object.fromEntries(h.requests[0].url.searchParams)
    expect(query).toEqual({ search: 'inv', type: 'workflow,data_table', updated_since: '7d', package: 'invoice-approval', limit: '2' })
    expect(h.stdout()).toContain('Invoice approval')
    expect(h.stdout()).toContain('dependency')
    expect(h.stdout()).toContain(`data_table:${uid(2)}`)
    expect(h.stdout()).toContain('2 of 3012 (workflow 3000, data_table 12)')
    expect(h.stdout()).toContain('More: --after abc')
  })

  it('--all follows the cursor', async () => {
    const h = harness({ env, responder: route({ 'GET /packages/assets': (r) => (r.url.searchParams.get('after') ? page([hit(2, 'B')], { total: 2 }) : page([hit(1, 'A')], { total: 2, next_cursor: 'c1' })) }) })
    expect(await h.run('packages', 'assets', '--all', '-o', 'json')).toBe(EXIT.ok)
    expect(h.requests.map((r) => r.url.searchParams.get('after'))).toEqual([null, 'c1'])
    expect(JSON.parse(h.stdout()).assets.map((a: { name: string }) => a.name)).toEqual(['A', 'B'])
  })

  it('rejects unknown types locally', async () => {
    const h = harness({ env })
    expect(await h.run('packages', 'assets', '--type', 'widget')).toBe(EXIT.usage)
    expect(h.requests).toHaveLength(0)
  })
})

describe('packages create', () => {
  it('creates from a workflow name, with readme and description', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usertasks-pkg-'))
    writeFileSync(join(dir, 'README.md'), '# Invoice approval\n')
    const h = harness({ env, responder: route({
      'GET /packages/assets': () => page([hit(1, 'Invoice approval'), hit(5, 'Invoice approval v2')]),
      'POST /packages': (r) => ({ package: { ...pkg, ...(r.body as object) } }),
    }) })
    expect(await h.run('packages', 'create', 'Invoice approval', '--from', 'Invoice approval', '--description', 'AP flow', '--readme', join(dir, 'README.md'), '--rows', uid(7), '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests[0].url.searchParams.get('type')).toBe('workflow')
    expect(h.requests[1].body).toEqual({ name: 'Invoice approval', description: 'AP flow', readme: '# Invoice approval\n', roots: [{ type: 'workflow', id: uid(1) }], data_modes: { [uid(7)]: 'rows' } })
    expect(h.stdout()).toContain('usertasks packages show invoice-approval')
  })

  it('asks which match to use on a terminal (--search)', async () => {
    const h = harness({ env, tty: true, answers: ['1,2'], responder: route({
      'GET /packages/assets': () => page([hit(1, 'Vendor onboarding'), hit(2, 'Vendors', 'data_table'), hit(3, 'Vendor offboarding')]),
      'POST /packages': (r) => ({ package: { ...pkg, ...(r.body as object) } }),
    }) })
    expect(await h.run('packages', 'create', 'Vendors', '--search', 'vendor', '-o', 'json')).toBe(EXIT.ok)
    expect(h.stderr()).toContain('Vendor offboarding')
    expect((h.requests[1].body as { roots: unknown[] }).roots).toEqual([{ type: 'workflow', id: uid(1) }, { type: 'data_table', id: uid(2) }])
  })

  it('without a terminal, an ambiguous name exits 2 and lists the candidates', async () => {
    const h = harness({ env, responder: route({ 'GET /packages/assets': () => page([hit(1, 'Vendor onboarding'), hit(3, 'Vendor offboarding')]) }) })
    expect(await h.run('packages', 'create', 'Vendors', '--from', 'Vendor')).toBe(EXIT.usage)
    expect(h.stderr()).toContain(`workflow:${uid(3)}`)
    expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(0)
  })

  it('still accepts a full body with -f / --set', async () => {
    const h = harness({ env, responder: route({ 'POST /packages': (r) => ({ package: { ...pkg, ...(r.body as object) } }) }) })
    expect(await h.run('packages', 'create', '--set', 'name=From set', '--set', `roots:=[{"type":"workflow","id":"${uid(1)}"}]`, '-o', 'json')).toBe(EXIT.ok)
    expect(h.requests[0].body).toEqual({ name: 'From set', roots: [{ type: 'workflow', id: uid(1) }] })
  })

  it('needs a root', async () => {
    const h = harness({ env })
    expect(await h.run('packages', 'create', 'Empty')).toBe(EXIT.usage)
    expect(h.stderr()).toContain('--from')
  })
})

describe('packages add', () => {
  it('adds ids directly', async () => {
    const h = harness({ env, responder: route({ 'PATCH /packages/invoice-approval': () => ({ package: pkg }) }) })
    expect(await h.run('packages', 'add', 'invoice-approval', `data_table:${uid(3)}`, '--rows', uid(3), '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests[0].body).toEqual({ add: [{ type: 'data_table', id: uid(3) }], data_modes: { [uid(3)]: 'rows' } })
  })

  it('--search picks on a terminal, marking what is in the package', async () => {
    const h = harness({ env, tty: true, answers: ['2'], responder: route({
      'GET /packages/assets': () => page([hit(1, 'Vendors', 'data_table', { in_package: 'dependency' }), hit(2, 'Vendor scores', 'data_table')]),
      'PATCH /packages/invoice-approval': () => ({ package: pkg }),
    }) })
    expect(await h.run('packages', 'add', 'invoice-approval', '--search', 'vendor', '--type', 'data_table', '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests[0].url.searchParams.get('package')).toBe('invoice-approval')
    expect(h.stderr()).toContain('dependency')
    expect(h.requests[1].body).toEqual({ add: [{ type: 'data_table', id: uid(2) }] })
  })

  it('--without-dependencies leaves out what only the new items use', async () => {
    const h = harness({ env, responder: route({
      'GET /packages/invoice-approval': () => ({ package: pkg, versions: [] }),
      'GET /packages/invoice-approval/contents': () => ({ items: [{ type: 'workflow', id: uid(1), name: 'Root', label: 'Workflow', included_as: 'root', required_by: 'root' }], excluded: [], requirements: [], warnings: [] }),
      'POST /packages/preview': () => ({ items: [
        { type: 'workflow', id: uid(1), name: 'Root', label: 'Workflow', included_as: 'root', required_by: 'root' },
        { type: 'workflow', id: uid(2), name: 'Sub', label: 'Workflow', included_as: 'manual', required_by: 'root' },
        { type: 'email_template', id: uid(3), name: 'Notice', label: 'Email template', included_as: 'dependency', required_by: { type: 'workflow', id: uid(2) } },
      ], excluded: [], requirements: [], warnings: [] }),
      'PATCH /packages/invoice-approval': () => ({ package: pkg }),
    }) })
    expect(await h.run('packages', 'add', 'invoice-approval', `workflow:${uid(2)}`, '--without-dependencies', '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests.at(-1)!.body).toEqual({ add: [{ type: 'workflow', id: uid(2) }], excluded: [{ type: 'email_template', id: uid(3) }] })
    expect(h.stderr()).toContain('leaving out 1 dependency: Notice')
  })
})

describe('packages show / set-data', () => {
  const contents = { items: [
    { type: 'workflow', id: uid(1), name: 'Invoice approval', label: 'Workflow', included_as: 'root', required_by: 'root' },
    { type: 'data_table', id: uid(3), name: 'Vendors', label: 'Data table', included_as: 'dependency', required_by: { type: 'workflow', id: uid(1) }, data_mode: 'rows', row_count: 12 },
  ], excluded: [{ type: 'email_template', id: uid(4), name: 'Old notice' }], requirements: [{ id: 'r1', label: 'ERP token', required: true }], warnings: [] }

  it('shows items with why each is included, data modes, left-out items and requirements', async () => {
    const h = harness({ env, responder: route({
      'GET /packages/invoice-approval': () => ({ package: { ...pkg, latest_version: '1.2.0' }, versions: [{ version: '1.2.0', created_at: '2026-10-20T00:00:00Z', signed: true, asset_count: 2 }] }),
      'GET /packages/invoice-approval/contents': () => contents,
    }) })
    expect(await h.run('packages', 'show', 'invoice-approval', '-o', 'table')).toBe(EXIT.ok)
    const out = h.stdout()
    expect(out).toContain('latest 1.2.0')
    expect(out).toContain('used by Invoice approval')
    expect(out).toContain('schema + 12 rows')
    expect(out).toContain('Old notice')
    expect(out).toContain('* ERP token')
    expect(out).toContain('2 items (1 chosen, 1 dependencies)')
  })

  it('sets a table data mode by name', async () => {
    const h = harness({ env, responder: route({
      'GET /packages/invoice-approval/contents': () => contents,
      'PATCH /packages/invoice-approval': () => ({ package: pkg }),
    }) })
    expect(await h.run('packages', 'set-data', 'invoice-approval', 'vendors', 'schema', '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests[1].body).toEqual({ data_modes: { [uid(3)]: 'schema' } })
    expect(h.stdout()).toContain('Vendors → schema only')
  })

  it('validates the mode and unknown tables', async () => {
    const bad = harness({ env })
    expect(await bad.run('packages', 'set-data', 'invoice-approval', uid(3), 'everything')).toBe(EXIT.usage)
    const missing = harness({ env, responder: route({ 'GET /packages/invoice-approval/contents': () => contents }) })
    expect(await missing.run('packages', 'set-data', 'invoice-approval', 'Nope', 'rows')).toBe(EXIT.usage)
    expect(missing.stderr()).toContain('Vendors')
  })
})
