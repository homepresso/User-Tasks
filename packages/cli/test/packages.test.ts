import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/exit-codes'
import { packPackage, PACKAGE_FORMAT_VERSION, PACKAGE_KIND } from '../src/package-format'
import { readZip, writeZip } from '../src/package-zip'
import { parseValueAssignments } from '../src/commands/packages'
import { harness, ok, type Recorded } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const REQ = 'connector:connectors:3fa8c21b-1234-4678-9abc-def012345678'
const dir = () => mkdtempSync(join(tmpdir(), 'usertasks-pkg-'))

function packageFile(): string {
  const { bytes } = packPackage({
    header: {
      format_version: PACKAGE_FORMAT_VERSION, kind: PACKAGE_KIND,
      package: { id: '11111111-1111-4111-8111-111111111111', name: 'Invoice approval', slug: 'invoice-approval', version: '1.0.0', description: null, author: 'Northwind', created_at: '2026-10-26T00:00:00.000Z', readme: null },
      data: {}, requirements: [], dependencies: [],
    },
    files: [{ path: 'assets/workflows/invoice-approval-22222222.json', content: JSON.stringify({ asset_type: 'workflows', id: '22222222-2222-4222-8222-222222222222', asset: { name: 'Invoice approval' } }) }],
  })
  const path = join(dir(), 'invoice-approval-1.0.0.utpkg')
  writeFileSync(path, bytes)
  return path
}

const requirement = (missing: string[]) => ({
  id: REQ, kind: 'connector', label: 'PostgreSQL connection “Invoices DB”', description: '', required: true, status: missing.length ? 'missing' : 'met',
  fields: [
    { key: 'credentials.username', label: 'Username', type: 'string', secret: true, target: {} },
    { key: 'credentials.password', label: 'Password', type: 'password', secret: true, target: {} },
  ],
  field_states: [
    { key: 'credentials.username', state: missing.includes('credentials.username') ? 'missing' : 'provided' },
    { key: 'credentials.password', state: missing.includes('credentials.password') ? 'missing' : 'provided' },
  ],
})

function plan(missing: string[], extra: Record<string, unknown> = {}) {
  return {
    dry_run: true, mode: 'install',
    package: { id: '11111111-1111-4111-8111-111111111111', name: 'Invoice approval', slug: 'invoice-approval', version: '1.0.0', description: null },
    verification: { valid: true, signed: true, signature_ok: true, fingerprint: 'aa:bb', trust: 'untrusted', errors: [] },
    installed_version: null,
    plan: { assets: [{ section: 'workflows', name: 'Invoice approval', action: 'create' }], summary: { create: 1, update: 0, unchanged: 0, error: 0 } },
    removed_upstream: [], requirements: [requirement(missing)], data: [], dependencies: [],
    blockers: missing.length ? ['Missing required values for PostgreSQL connection'] : [], warnings: [], ...extra,
  }
}

/** Plans report a field missing until the request supplies it. */
function responder(installStatus = 'complete') {
  return (request: Recorded) => {
    const body = request.body as { values?: Record<string, Record<string, string>>; keep_incomplete?: boolean } | undefined
    const given = body?.values?.[REQ] ?? {}
    const missing = ['credentials.username', 'credentials.password'].filter((key) => !given[key])
    if (request.url.pathname.endsWith('/package-installs/plan')) return ok(plan(missing))
    if (request.url.pathname.endsWith('/package-installs')) return ok({ ...plan(missing), dry_run: false, install: { id: 'inst-1', slug: 'invoice-approval', version: '1.0.0', status: missing.length ? 'incomplete' : installStatus }, result: { errors: [], published: [] } })
    return ok({})
  }
}

describe('packages inspect (offline)', () => {
  it('verifies an intact package', async () => {
    const h = harness({ env })
    expect(await h.run('packages', 'inspect', packageFile(), '-o', 'table')).toBe(EXIT.ok)
    expect(h.stdout()).toContain('Invoice approval 1.0.0')
    expect(h.stdout()).toContain('✓ intact')
    expect(h.requests).toHaveLength(0)
  })

  it('exits 6 for a modified package', async () => {
    const path = packageFile()
    const entries = readZip(readFileSync(path)).map((e) => (e.path.startsWith('assets/') ? { path: e.path, data: Buffer.from('{"evil":true}') } : e))
    writeFileSync(path, writeZip(entries))
    const h = harness({ env })
    expect(await h.run('packages', 'inspect', path, '-o', 'table')).toBe(EXIT.validation)
    expect(h.stdout()).toContain('MODIFIED OR CORRUPT')
  })
})

describe('packages install', () => {
  it('parses --set <requirement>.<field>=value (field keys may contain dots)', () => {
    expect(parseValueAssignments([`${REQ}.credentials.password=a=b`])).toEqual({ [REQ]: { 'credentials.password': 'a=b' } })
    expect(() => parseValueAssignments(['nodot=1'])).toThrow(/requirement id/)
  })

  it('without a terminal, missing required values fail with --set hints and nothing is installed', async () => {
    const h = harness({ env, responder: responder() })
    expect(await h.run('packages', 'install', packageFile(), '-o', 'table')).toBe(EXIT.validation)
    expect(h.stderr()).toContain(`--set '${REQ}.credentials.password=…'`)
    expect(h.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/package-installs/plan'])
  })

  it('--keep-incomplete installs and says how to complete setup', async () => {
    const h = harness({ env, responder: responder() })
    expect(await h.run('packages', 'install', packageFile(), '--keep-incomplete', '-o', 'table')).toBe(EXIT.ok)
    const install = h.requests.find((r) => r.url.pathname === '/api/v1/package-installs')!
    expect(install.body).toMatchObject({ keep_incomplete: true, source: 'cli', file_name: 'invoice-approval-1.0.0.utpkg' })
    expect(typeof (install.body as { file: string }).file).toBe('string')
    expect(h.stdout()).toContain('usertasks packages complete invoice-approval')
  })

  it('--set with ${env:} and -f values.yaml supply values (secrets substituted locally)', async () => {
    const values = join(dir(), 'values.yaml')
    writeFileSync(values, `"${REQ}":\n  credentials.username: app\n`)
    const h = harness({ env: { ...env, DB_PASSWORD: 'hunter2' }, responder: responder() })
    expect(await h.run('packages', 'install', packageFile(), '-f', values, '--set', `${REQ}.credentials.password=\${env:DB_PASSWORD}`, '-o', 'table')).toBe(EXIT.ok)
    const install = h.requests.find((r) => r.url.pathname === '/api/v1/package-installs')!
    expect(install.body).toMatchObject({ keep_incomplete: false, values: { [REQ]: { 'credentials.username': 'app', 'credentials.password': 'hunter2' } } })
  })

  it('on a terminal, prompts for missing values (secrets without echo) and installs', async () => {
    const h = harness({ env, responder: responder(), tty: true, answers: [], stdin: 's3cret', confirm: true })
    expect(await h.run('packages', 'install', packageFile(), '-o', 'table')).toBe(EXIT.ok)
    const install = h.requests.find((r) => r.url.pathname === '/api/v1/package-installs')!
    expect(install.body).toMatchObject({ values: { [REQ]: { 'credentials.username': 's3cret', 'credentials.password': 's3cret' } }, keep_incomplete: false })
  })

  it('on a terminal, skipped prompts can be kept incomplete', async () => {
    const h = harness({ env, responder: responder(), tty: true, stdin: '', confirm: true })
    expect(await h.run('packages', 'install', packageFile(), '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests.find((r) => r.url.pathname === '/api/v1/package-installs')!.body).toMatchObject({ keep_incomplete: true })
  })

  it('--dry-run only plans', async () => {
    const h = harness({ env, responder: responder() })
    expect(await h.run('packages', 'install', packageFile(), '--dry-run', '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/package-installs/plan'])
    expect(h.stdout()).toContain('+ create')
    expect(h.stdout()).toContain('✗ PostgreSQL connection')
  })
})

describe('packages build / complete', () => {
  it('build saves the .utpkg', async () => {
    const out = join(dir(), 'x.utpkg')
    const h = harness({ env, responder: () => ok({ version: { version: '1.0.1', checksum: 'sha256:x', signed: true, fingerprint: 'aa', asset_count: 3 }, manifest: { requirements: [] }, warnings: [], file_name: 'p-1.0.1.utpkg', file_base64: Buffer.from('zip').toString('base64') }) })
    expect(await h.run('packages', 'build', 'invoice-approval', '--out', out, '-o', 'table')).toBe(EXIT.ok)
    expect(existsSync(out)).toBe(true)
    expect(h.requests[0]).toMatchObject({ method: 'POST', body: { bump: 'patch', include_file: true } })
    expect(h.requests[0].url.pathname).toBe('/api/v1/packages/invoice-approval/versions')
  })

  it('complete posts the values', async () => {
    const h = harness({ env, responder: () => ok({ status: 'complete', requirements: [requirement([])], warnings: [], result: { published: ['w1'] } }) })
    expect(await h.run('packages', 'complete', 'inst-1', '--set', `${REQ}.credentials.password=x`, '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests.at(-1)!.body).toMatchObject({ values: { [REQ]: { 'credentials.password': 'x' } }, dry_run: false })
    expect(h.stdout()).toContain('activated 1 workflow')
  })
})

describe('packages history', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    id: 'ev-1', created_at: '2026-10-26T09:30:00.000Z', package_name: 'Invoice approval', action: 'upgrade', status: 'succeeded',
    from_version: '1.0.0', to_version: '1.1.0', channel: 'cli', actor: { name: 'Ada', email: 'ada@northwind.example' },
    counts: { created: 1, updated: 2 }, signed: true, error: null, ...overrides,
  })

  it('lists the history with filters as query parameters', async () => {
    const h = harness({ env, responder: () => ok({ events: [event(), event({ id: 'ev-2', action: 'uninstall', status: 'failed', error: '1 run is still in progress', from_version: '1.1.0', to_version: null })], total: 2 }) })
    expect(await h.run('packages', 'history', 'invoice-approval', '--action', 'upgrade,uninstall', '--status', 'failed', '--user', 'ada@northwind.example', '--since', '2026-10-01', '-o', 'table')).toBe(EXIT.ok)
    const request = h.requests[0]
    expect(request.url.pathname).toBe('/api/v1/package-events')
    expect(Object.fromEntries(request.url.searchParams)).toEqual({ package: 'invoice-approval', action: 'upgrade,uninstall', status: 'failed', actor: 'ada@northwind.example', since: '2026-10-01' })
    const out = h.stdout()
    expect(out).toContain('1.0.0 → 1.1.0')
    expect(out).toContain('+1 ~2')
    expect(out).toContain('failed: 1 run is still in progress')
    expect(out).toContain('ada@northwind.example')
  })

  it('prints JSON with -o json', async () => {
    const h = harness({ env, responder: () => ok({ events: [event()], total: 1 }) })
    expect(await h.run('packages', 'history', '-o', 'json')).toBe(EXIT.ok)
    expect(JSON.parse(h.stdout())).toMatchObject({ events: [{ id: 'ev-1', action: 'upgrade' }], total: 1 })
    expect([...h.requests[0].url.searchParams.keys()]).toEqual([])
  })
})

describe('packages uninstall', () => {
  const dryPlan = (blockers: string[] = []) => ({
    dry_run: true, name: 'Invoice approval', version: '1.1.0',
    plan: [{ section: 'workflows', name: 'Invoice approval', action: 'delete' }, { section: 'data_tables', name: 'Vendors', action: 'delete', rows: 12 }],
    summary: { delete: 2, skip: 0, gone: 0, rows: 12 }, active_runs: [{ id: 'run-1', workflow_name: 'Invoice approval', status: 'waiting_for_event' }], active_run_count: 1, blockers,
  })

  it('stops on blockers (runs in progress) without uninstalling', async () => {
    const h = harness({ env, confirm: true, responder: () => ok(dryPlan(['1 run is still in progress for the package\'s workflows (cancel them first, or pass cancel_runs)'])) })
    expect(await h.run('packages', 'uninstall', 'invoice-approval', '--delete-data', '-o', 'table')).toBe(EXIT.validation)
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].body).toMatchObject({ dry_run: true, delete_data: true, cancel_runs: false, source: 'cli' })
    expect(h.stdout()).toContain('12 rows deleted')
    expect(h.stdout()).toContain('! 1 run is still in progress')
  })

  it('--cancel-runs --delete-data uninstalls everything after the plan', async () => {
    const h = harness({ env, confirm: true, responder: (request) => ok((request.body as { dry_run?: boolean }).dry_run ? dryPlan() : { ...dryPlan(), dry_run: false, errors: [], runs_cancelled: 1 }) })
    expect(await h.run('packages', 'uninstall', 'invoice-approval', '--delete-data', '--force', '--cancel-runs', '-o', 'table')).toBe(EXIT.ok)
    expect(h.requests.map((r) => (r.body as { dry_run?: boolean }).dry_run ?? false)).toEqual([true, false])
    expect(h.requests[1].body).toEqual({ force: true, delete_data: true, cancel_runs: true, source: 'cli' })
    expect(h.stdout()).toContain('Uninstalled: 2 removed, 0 kept, 1 runs cancelled.')
  })
})
