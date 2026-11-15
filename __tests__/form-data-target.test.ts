/**
 * Form data targets (lib/forms/data-target.ts, lib/services/form-targets.ts,
 * ctx.forms): the layout binding survives normalisation and compact saves;
 * provider field patches are bounded and only touch what they may; the
 * service runs the provider's prepare / submit with re-validated params,
 * maps Person values by e-mail to members (and back), hands only this
 * submission's files to the provider, turns provider errors into per-field
 * validation errors and conflicts, checks bindPermission when a binding is
 * added or changed, and the server registry refuses malformed targets.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { defineExtension, defineServerExtension, ExtensionError, type FormTarget } from '@user-tasks/extension-sdk'
import { applyFieldPatches, layoutDataTarget, normalizeDataTarget, normalizeFieldPatches } from '@/lib/forms/data-target'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { assertTargetBinding, checkFormTarget, formTargetDeps, mapPeopleValues, prepareFormTarget, submitFormTarget, targetError } from '@/lib/services/form-targets'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { extensionProblems } from '@/lib/extensions/server-registry'
import { createExtensionContext } from '@/lib/extensions/host'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0f000000-0000-4000-8000-0000000b0001'
const U1 = '0f000000-0000-4000-8000-0000000b0101'
const U2 = '0f000000-0000-4000-8000-0000000b0102'
const OUTSIDER = '0f000000-0000-4000-8000-0000000b0103'

const fields: TaskFieldDef[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'status', label: 'Status', type: 'choice', options: ['New', 'Done'] },
  { key: 'owner', label: 'Owner', type: 'user' },
  { key: 'team', label: 'Team', type: 'user', user_config: { multiple: true } },
  { key: 'files', label: 'Files', type: 'attachments' },
  { key: 'amount', label: 'Amount', type: 'number' },
]
const binding = { extension: 'acme', key: 'record', config: { list: 'L1', ids: ['a', 'b'] }, label: 'Acme records' }
const layout = { rows: [], params: [{ name: 'item', type: 'number', source: 'url', query_name: 'ItemId' }], data_target: binding }

function ctx(permissions: string[] | null = null): ServiceContext {
  return { db: db.current, supabase: db.current, tenantId: TENANT, actorId: U1, permissions: permissions ? new Set(permissions) : null, authKind: 'session', source: 'ui' }
}

function seed() {
  db.current = createMemorySupabase({
    users: [
      { id: U1, email: 'ana@contoso.test', display_name: 'Ana' },
      { id: U2, email: 'bo@contoso.test', display_name: 'Bo' },
      { id: OUTSIDER, email: 'out@else.test', display_name: 'Out' },
    ],
    user_memberships: [{ user_id: U1, tenant_id: TENANT }, { user_id: U2, tenant_id: TENANT }],
  })
}

let provider: FormTarget | null
beforeEach(() => {
  seed()
  provider = null
  vi.spyOn(formTargetDeps, 'provider').mockImplementation(async () => provider)
  vi.spyOn(formTargetDeps, 'assertAccess').mockResolvedValue()
  vi.spyOn(formTargetDeps, 'serviceDb').mockImplementation(async () => db.current)
})
afterEach(() => { vi.restoreAllMocks(); resetExtensionsForTest() })

describe('the layout binding', () => {
  it('normalises the binding (scalars, string arrays, bounded) and drops bad ones', () => {
    expect(normalizeDataTarget({ extension: 'acme', key: 'record', config: { a: 1, b: true, c: 'x', d: ['y', 2], e: { nested: 1 }, 'bad key': 1 } })).toEqual({ extension: 'acme', key: 'record', config: { a: 1, b: true, c: 'x', d: ['y'] } })
    expect(normalizeDataTarget({ extension: 'Acme!', key: 'record' })).toBeUndefined()
    expect(normalizeDataTarget({ extension: 'acme', key: '' })).toBeUndefined()
    expect(normalizeDataTarget('nope')).toBeUndefined()
  })

  it('survives normalisation and compact saves (and keeps a trivial grid stored)', () => {
    const keys = fields.map((f) => f.key)
    const normal = normalizeFormLayout({ rows: [], data_target: binding }, keys)!
    expect(normal.data_target).toEqual(binding)
    const compact = compactLayoutForSave(normal, keys)
    expect(compact).not.toBeNull()
    expect(layoutDataTarget(compact)).toEqual(binding)
    expect(compactLayoutForSave(normalizeFormLayout({ rows: [] }, keys)!, keys)).toBeNull()
  })
})

describe('field patches', () => {
  it('keeps only known fields and patchable keys, bounded', () => {
    const patches = normalizeFieldPatches({
      status: { options: ['New', 'Done', 'Closed', 7, null], option_labels: { Closed: 'Closed (archived)' }, type: 'text', required: true },
      amount: { min: 0, max: 'x' },
      ghost: { options: ['x'] },
    }, fields)
    expect(patches).toEqual({ status: { options: ['New', 'Done', 'Closed', '7'], option_labels: { Closed: 'Closed (archived)' }, required: true }, amount: { min: 0 } })
  })

  it('patches options only on choice-like fields, keeping labels of remaining options', () => {
    const out = applyFieldPatches(
      [...fields, { key: 'free', label: 'Free', type: 'text' }],
      { status: { options: ['Done', 'Later'], option_labels: { Later: 'Later on' } }, free: { options: ['a'] }, title: { read_only: true, help_text: 'From the record' } },
    )
    expect(out.find((f) => f.key === 'status')).toMatchObject({ options: ['Done', 'Later'], option_labels: { Later: 'Later on' } })
    expect(out.find((f) => f.key === 'free')!.options).toBeUndefined()
    expect(out.find((f) => f.key === 'title')).toMatchObject({ read_only: true, help_text: 'From the record' })
  })
})

describe('prepare', () => {
  it('passes re-validated params, applies patches and maps people by e-mail to members', async () => {
    let seen: any = null
    provider = {
      label: 'Acme record',
      async prepare(input) {
        seen = input
        return {
          values: { title: 'Hello', owner: { email: 'BO@contoso.test' }, team: [{ email: 'ana@contoso.test' }, { email: 'out@else.test', name: 'Out' }], unknown: 1 },
          version: '"4"', record: { id: '12', label: 'Hello', url: 'https://sp.example/item/12' },
          fields: { status: { options: ['New', 'Done', 'Closed'] } }, notice: 'From Acme',
        }
      },
      async submit() { return { record: { id: '1' } } },
    }
    const out = await prepareFormTarget(ctx(), { id: 'f1', name: 'F', version: 3, fields, layout }, { item: '12', other: 'x' }, 'render')
    expect(seen.params).toEqual({ item: 12 })
    expect(seen.form).toMatchObject({ id: 'f1', version: 3, config: binding.config })
    expect(out.fields.find((f) => f.key === 'status')!.options).toEqual(['New', 'Done', 'Closed'])
    expect(out.state).toMatchObject({ label: 'Acme records', mode: 'edit', version: '"4"', record: { id: '12', label: 'Hello', url: 'https://sp.example/item/12' } })
    expect(out.state!.values).toEqual({ title: 'Hello', owner: U2, team: [{ kind: 'user', id: U1, name: 'Ana' }] })
    expect(out.state!.notice).toContain('From Acme')
    expect(out.state!.notice).toContain('Out <out@else.test>')
  })

  it('is a no-op for forms without a binding and returns patches only for submit', async () => {
    expect(await prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout: { rows: [] } }, {}, 'render')).toEqual({ fields, state: null })
    provider = { label: 'x', prepare: async () => ({ fields: { status: { options: ['A'] } }, values: { title: 'ignored' } }), submit: async () => ({ record: { id: '1' } }) }
    const out = await prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, {}, 'submit')
    expect(out.state).toBeNull()
    expect(out.fields.find((f) => f.key === 'status')!.options).toEqual(['A'])
  })

  it('refuses a binding whose provider is missing, and maps provider errors', async () => {
    await expect(prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, {}, 'render')).rejects.toMatchObject({ code: 'not_found' })
    provider = { label: 'x', prepare: async () => { throw new ExtensionError('not_found', 'Item 9 not found', 404) }, submit: async () => ({ record: { id: '1' } }) }
    await expect(prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { item: 9 }, 'render')).rejects.toMatchObject({ code: 'not_found', message: 'Item 9 not found' })
  })

  it('maps people values on their own: single, multiple, unknown', async () => {
    const out = await mapPeopleValues(db.current, TENANT, fields, { owner: [{ email: 'nobody@x.test' }], team: [U2], title: 'x' })
    expect(out).toEqual({ values: { owner: null, team: [{ kind: 'user', id: U2 }], title: 'x' }, missing: ['nobody@x.test'] })
  })
})

describe('submit', () => {
  it('hands values, version, people (members only) and only this submission\'s files to the provider', async () => {
    let seen: any = null
    const file = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'a.txt' }
    provider = {
      label: 'Acme record',
      async submit(input) {
        seen = input
        const other = await input.readFile({ id: 'bbbbbbbb-0000-4000-8000-000000000002' })
        return { record: { id: '13', label: 'New', url: 'javascript:alert(1)' }, version: '"1"', message: `created${other === null ? '' : ' leaked'}` }
      },
    }
    const out = await submitFormTarget(ctx(), { id: 'f', name: 'F', version: 2, fields, layout }, { title: 'T', owner: U1, team: [{ kind: 'user', id: U2 }, { kind: 'user', id: OUTSIDER }], files: [file] }, { params: { item: '5' }, version: '"3"' })
    expect(seen.version).toBe('"3"')
    expect(seen.params).toEqual({ item: 5 })
    expect(Object.keys(seen.people).sort()).toEqual([U1, U2].sort())
    expect(seen.people[U2]).toEqual({ id: U2, name: 'Bo', email: 'bo@contoso.test' })
    expect(out).toEqual({ label: 'Acme records', record: { id: '13', label: 'New', url: null }, version: '"1"', message: 'created' })
  })

  it('turns field errors into validation errors per field, 412 into a conflict, 5xx into 502', async () => {
    const run = (error: Error) => {
      provider = { label: 'x', submit: async () => { throw error } }
      return submitFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { title: 'T' }, {})
    }
    await expect(run(new ExtensionError('invalid_field_value', 'Amount must be positive', 400, { fields: { amount: 'Must be positive', bogus: 3 } }))).rejects.toMatchObject({ code: 'validation_error', status: 400, details: { fields: { amount: 'Must be positive' } } })
    await expect(run(new ExtensionError('etag_mismatch', 'The item changed since it was read', 412))).rejects.toMatchObject({ code: 'conflict', status: 412 })
    await expect(run(new ExtensionError('upstream_error', 'Upstream down', 502))).rejects.toMatchObject({ status: 502, message: 'Acme records failed: Upstream down' })
    const plain = new Error('boom')
    await expect(run(plain)).rejects.toBe(plain)
    expect(targetError(plain, 'x')).toBe(plain)
  })

  it('requires the provider to report the record it wrote', async () => {
    provider = { label: 'x', submit: async () => ({ record: { id: '' } }) }
    await expect(submitFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, {}, {})).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('binding and checks', () => {
  it('needs bindPermission to add or change a binding, not to keep one', async () => {
    provider = { label: 'x', bindPermission: 'ext.acme.write', submit: async () => ({ record: { id: '1' } }) }
    await expect(assertTargetBinding(ctx(['forms.edit']), layout, null)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(assertTargetBinding(ctx(['forms.edit']), layout, layout)).resolves.toBeUndefined()
    await expect(assertTargetBinding(ctx(['forms.edit', 'ext.acme.write']), layout, null)).resolves.toBeUndefined()
    await expect(assertTargetBinding(ctx(['forms.edit']), { ...layout, data_target: { ...binding, config: { list: 'L2' } } }, layout)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('reports provider problems (known fields only) and turns a failure into one error', async () => {
    provider = { label: 'x', check: async () => [{ field: 'status', severity: 'warning', message: 'Choices changed' }, { field: 'gone', severity: 'error', message: 'Removed' }], submit: async () => ({ record: { id: '1' } }) }
    expect(await checkFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout })).toEqual({ label: 'Acme records', problems: [{ field: 'status', severity: 'warning', message: 'Choices changed' }, { severity: 'error', message: 'Removed' }] })
    provider = { label: 'x', check: async () => { throw new ExtensionError('upstream_error', 'down', 502) }, submit: async () => ({ record: { id: '1' } }) }
    expect((await checkFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout })).problems).toEqual([{ severity: 'error', message: 'Acme records failed: down' }])
  })
})

describe('registry and ctx.forms', () => {
  const manifest = {
    manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
    engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
    licence: { tier: 'paid', sku: 'acme', features: ['forms'] }, deployments: ['cloud', 'self_hosted'],
    permissions: [{ key: 'write', label: 'Write', default_roles: ['owner'] }],
  }

  it('refuses malformed form targets', () => {
    registerExtensionsForTest({
      definitions: [defineExtension({ manifest })],
      servers: [defineServerExtension({ id: 'acme', formTargets: { 'Bad-Key': { label: 'x', submit: async () => ({ record: { id: '1' } }) }, record: { label: 'x', feature: 'other', bindPermission: 'ext.acme.nope' } as any } })],
    })
    const problems = extensionProblems().join('\n')
    expect(problems).toContain('form target "Bad-Key": key must be')
    expect(problems).toContain('form target "record" has no submit hook')
    expect(problems).toContain('feature "other" is not declared')
    expect(problems).toContain('"ext.acme.nope" is neither')
  })

  it('lists and reads only forms bound to the calling extension', async () => {
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acme', formTargets: { record: { label: 'x', submit: async () => ({ record: { id: '1' } }) } } })] })
    db.current = createMemorySupabase({
      forms: [
        { id: '0f000000-0000-4000-8000-00000000f001', tenant_id: TENANT, name: 'Mine', version: 2, fields: [{ key: 'title', label: 'Title', type: 'text' }], layout: { rows: [], data_target: binding }, updated_at: '2026-11-01' },
        { id: '0f000000-0000-4000-8000-00000000f002', tenant_id: TENANT, name: 'Other ext', version: 1, fields: [], layout: { rows: [], data_target: { extension: 'other', key: 'record', config: {} } }, updated_at: '2026-11-02' },
        { id: '0f000000-0000-4000-8000-00000000f003', tenant_id: TENANT, name: 'Plain', version: 1, fields: [], layout: { rows: [] }, updated_at: '2026-11-03' },
      ],
    })
    const extCtx = createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: U1 })
    const list = await extCtx.forms.list()
    expect(list.map((f) => f.name)).toEqual(['Mine'])
    expect(list[0]).toMatchObject({ key: 'record', config: binding.config, designerUrl: '/automations/forms/0f000000-0000-4000-8000-00000000f001', pageUrl: '/f/0f000000-0000-4000-8000-00000000f001' })
    expect(await extCtx.forms.get('0f000000-0000-4000-8000-00000000f002')).toBeNull()
    expect((await extCtx.forms.get('0f000000-0000-4000-8000-00000000f001'))!.fields.map((f) => f.key)).toEqual(['title'])
    await expect(extCtx.forms.create({ name: 'x', fields: [], target: { key: 'missing', config: {} } })).rejects.toThrow('not declared')
  })
})
