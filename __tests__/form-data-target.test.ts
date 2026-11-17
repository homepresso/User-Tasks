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

const deletedForms = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock('@/lib/services/forms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/forms')>()),
  deleteForm: async (_ctx: unknown, id: string) => { deletedForms.ids.push(id); return { deleted: true as const, id } },
}))

import { defineExtension, defineServerExtension, ExtensionError, type FormTarget } from '@user-tasks/extension-sdk'
import { applyFieldPatches, layoutDataTarget, normalizeDataTarget, normalizeFieldPatches, normalizeTargetLinks } from '@/lib/forms/data-target'
import { formEventMessage } from '@/lib/forms/embed'
import { buttonProblems, normalizeFormButtons, planButtonEffects, TARGET_RETURN_URL } from '@/lib/forms/buttons'
import { deleteFormTargetRecord } from '@/lib/services/form-targets'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { assertTargetBinding, checkFormTarget, formTargetDeleted, formTargetDeps, formTargetSaved, mapPeopleValues, prepareFormTarget, sameIdentity, submitFormTarget, targetError } from '@/lib/services/form-targets'
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

  it('display forms: every field read-only, no version, actions and files cleaned, submissions refused', async () => {
    const withHeading: TaskFieldDef[] = [...fields, { key: 'h', label: 'Heading', type: 'heading' }]
    provider = {
      label: 'Acme record',
      async prepare() {
        return {
          mode: 'display', values: { title: 'Hello' }, version: '"4"', record: { id: '12', label: 'Hello' },
          actions: [{ label: 'Edit', url: '/f/abc?ItemId=12', primary: true }, { label: 'Close', url: 'https://sp.example/list', target: 'top' }, { label: 'Bad', url: 'javascript:alert(1)' }, { label: 'Proto-relative', url: '//evil.example/x' }, { label: 'Creds', url: 'https://u:p@sp.example/' }],
          files: [{ label: 'a.pdf', url: 'https://sp.example/a.pdf' }, { label: 'local', url: '/f/x' }],
        }
      },
      async submit() { return { record: { id: '1' } } },
    }
    const out = await prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields: withHeading, layout }, { item: 12 }, 'render')
    expect(out.state).toMatchObject({ mode: 'display', version: null, record: { id: '12' } })
    expect(out.fields.filter((f) => f.type !== 'heading').every((f) => f.read_only === true && !f.required)).toBe(true)
    expect(out.fields.find((f) => f.key === 'h')!.read_only).toBeUndefined()
    expect(out.state!.actions).toEqual([{ label: 'Edit', url: '/f/abc?ItemId=12', primary: true }, { label: 'Close', url: 'https://sp.example/list', target: 'top' }])
    expect(out.state!.files).toEqual([{ label: 'a.pdf', url: 'https://sp.example/a.pdf' }])
    await expect(prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { item: 12 }, 'submit')).rejects.toMatchObject({ code: 'validation_error', details: { code: 'display_form' } })
  })

  it('cleans provider links; the trusted-embedding host event carries the event only', () => {
    expect(normalizeTargetLinks('x')).toEqual([])
    expect(normalizeTargetLinks([{ label: ' Edit ', url: '/f/1', target: 'nope' }, { label: '', url: '/f/2' }, { label: 'x', url: '/\\\\evil' }, { label: 'sp', url: 'http://sp/a b' }])).toEqual([{ label: 'Edit', url: '/f/1' }])
    expect(normalizeTargetLinks(Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, url: `/f/${i}` }))).length).toBe(20)
    expect(formEventMessage('submitted')).toEqual({ type: 'usertasks:form', event: 'submitted' })
  })

  it('passes a vetted return URL and can-delete (only with a remove hook and a record)', async () => {
    provider = { label: 'x', prepare: async () => ({ record: { id: '5' }, returnUrl: 'https://sp.example/list', canDelete: true, urls: { edit: '/f/e?ItemId=5', bad: 'javascript:x', 'Bad Key': '/f/x' } }), submit: async () => ({ record: { id: '1' } }), remove: async () => ({}) }
    const out = await prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { item: 5 }, 'render')
    expect(out.state).toMatchObject({ return_url: 'https://sp.example/list', can_delete: true, urls: { edit: '/f/e?ItemId=5' } })
    expect(Object.keys(out.state!.urls!)).toEqual(['edit'])
    provider = { label: 'x', prepare: async () => ({ record: { id: '5' }, returnUrl: 'javascript:alert(1)', canDelete: true }), submit: async () => ({ record: { id: '1' } }) }
    expect((await prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { item: 5 }, 'render')).state).toMatchObject({ return_url: null, can_delete: false })
    provider = { label: 'x', prepare: async () => ({ returnUrl: 'https://sp.example/list', canDelete: true }), submit: async () => ({ record: { id: '1' } }), remove: async () => ({}) }
    expect((await prepareFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, {}, 'render')).state!.can_delete).toBe(false)
  })

  it('deletes through the provider with re-validated params, and maps its errors', async () => {
    let seen: any = null
    provider = { label: 'Acme record', submit: async () => ({ record: { id: '1' } }), remove: async (input) => { seen = input; return { record: { id: '12', label: 'Hello' }, message: 'Recycled', returnUrl: 'https://sp.example/list' } } }
    const out = await deleteFormTargetRecord(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { params: { item: '12', other: 1 }, version: '"3"' })
    expect(seen.params).toEqual({ item: 12 })
    expect(seen.version).toBe('"3"')
    expect(out).toEqual({ label: 'Acme records', record: { id: '12', label: 'Hello' }, message: 'Recycled', returnUrl: 'https://sp.example/list' })
    provider = { label: 'x', submit: async () => ({ record: { id: '1' } }), remove: async () => { throw new ExtensionError('forbidden', 'You may not delete it', 403) } }
    await expect(deleteFormTargetRecord(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, {})).rejects.toMatchObject({ code: 'forbidden' })
    provider = { label: 'x', submit: async () => ({ record: { id: '1' } }) }
    await expect(deleteFormTargetRecord(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, {})).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('buttons: a Delete kind (one, danger by default) and {{target.return_url}} redirects', () => {
    const buttons = normalizeFormButtons([{ kind: 'submit', label: 'Save', actions: [{ type: 'redirect', url: TARGET_RETURN_URL }] }, { kind: 'delete' }, { kind: 'delete', label: 'Twice' }])
    expect(buttons.map((b) => [b.kind, b.label, b.style])).toEqual([['submit', 'Save', 'primary'], ['delete', 'Delete', 'danger']])
    expect(buttonProblems(buttons)).toEqual({})
    expect(planButtonEffects(buttons[0], { values: {}, targetReturnUrl: 'https://sp.example/Lists/R/AllItems.aspx' }).redirect).toBe('https://sp.example/Lists/R/AllItems.aspx')
    expect(planButtonEffects(buttons[0], { values: {}, targetReturnUrl: 'javascript:x' }).redirect).toBeUndefined()
    expect(planButtonEffects(buttons[0], { values: {} }).redirect).toBeUndefined()
    expect(planButtonEffects({ id: 'x', label: 'x', kind: 'submit', style: 'primary', actions: [{ type: 'redirect', url: 'https://evil.example/' }] }, { values: {}, targetReturnUrl: 'https://sp.example/' }).redirect).toBeUndefined()
    expect(formEventMessage('deleted')).toEqual({ type: 'usertasks:form', event: 'deleted' })
    // Link buttons and named target pages ({{target.url.<name>}}).
    const [link] = normalizeFormButtons([{ kind: 'link', label: 'Edit item', actions: [{ type: 'redirect', url: '{{target.url.edit}}' }, { type: 'message', text: 'dropped' }] }]).filter((b) => b.kind === 'link')
    expect(link.actions).toEqual([{ type: 'redirect', url: '{{target.url.edit}}' }])
    expect(buttonProblems([link])).toEqual({})
    expect(planButtonEffects(link, { values: {}, targetUrls: { edit: '/f/abc?ItemId=1' } }).redirect).toBe('/f/abc?ItemId=1')
    expect(planButtonEffects(link, { values: {}, targetUrls: { edit: '//evil.example' } }).redirect).toBeUndefined()
    expect(planButtonEffects(link, { values: {} }).redirect).toBeUndefined()
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
    expect(out).toEqual({ label: 'Acme records', record: { id: '13', label: 'New', url: null }, version: '"1"', message: 'created', returnUrl: null })
  })

  it('turns field errors into validation errors per field, 412 into a conflict, 5xx into 502', async () => {
    const run = (error: Error) => {
      provider = { label: 'x', submit: async () => { throw error } }
      return submitFormTarget(ctx(), { id: 'f', name: 'F', version: 1, fields, layout }, { title: 'T' }, {})
    }
    await expect(run(new ExtensionError('invalid_field_value', 'Amount must be positive', 400, { fields: { amount: 'Must be positive', bogus: 3 } }))).rejects.toMatchObject({ code: 'validation_error', status: 400, details: { fields: { amount: 'Must be positive' } } })
    await expect(run(new ExtensionError('etag_mismatch', 'The item changed since it was read', 412))).rejects.toMatchObject({ code: 'conflict', status: 412 })
    // Form users never see the upstream's raw answer (status lines, API paths); designers do.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const upstream = run(new ExtensionError('upstream_error', 'SharePoint answered 500 (POST /_api/web/ensureuser): boom', 502))
    await expect(upstream).rejects.toMatchObject({ status: 502, message: "Acme records couldn't be reached to save this. Try again in a moment; if it keeps happening, tell your administrator.", details: { code: 'upstream_error' } })
    await expect(upstream).rejects.not.toMatchObject({ message: expect.stringContaining('ensureuser') })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('/_api/web/ensureuser'))
    logged.mockRestore()
    expect(targetError(new ExtensionError('upstream_error', 'Upstream down', 502), 'Acme records')).toMatchObject({ status: 502, message: 'Acme records failed: Upstream down' })
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

  it('a config change that keeps the provider identity is not a new binding (no bindPermission)', async () => {
    provider = { label: 'x', bindPermission: 'ext.acme.write', identity: (c) => String(c.list), submit: async () => ({ record: { id: '1' } }) }
    const moreIds = { ...layout, data_target: { ...binding, config: { list: 'L1', ids: ['a', 'b', 'c'] } } }
    await expect(assertTargetBinding(ctx(['forms.edit']), moreIds, layout)).resolves.toBeUndefined()
    await expect(assertTargetBinding(ctx(['forms.edit']), { ...layout, data_target: { ...binding, config: { list: 'L2' } } }, layout)).rejects.toMatchObject({ code: 'forbidden' })
    expect(sameIdentity(provider, binding, { ...binding, key: 'other' })).toBe(false)
    expect(sameIdentity(null, binding, { ...binding, config: { list: 'L1' } })).toBe(false)
    expect(sameIdentity({ identity: () => { throw new Error('bad') } }, binding, { ...binding, config: { list: 'L1' } })).toBe(false)
  })

  it('saved: same identity → saved with previousConfig (deleted not called); another identity → deleted (old) then saved', async () => {
    const calls: Array<[string, unknown]> = []
    provider = {
      label: 'x', identity: (c) => String(c.list), submit: async () => ({ record: { id: '1' } }),
      saved: async ({ form, previousConfig }) => { calls.push(['saved', { config: form.config, previousConfig }]) },
      deleted: async ({ formId, config }) => { calls.push(['deleted', { formId, config }]) },
    }
    const form = (config: Record<string, unknown>) => ({ id: 'f1', name: 'F', version: 2, fields, layout: { ...layout, data_target: { ...binding, config } } })
    await formTargetSaved(ctx(), form({ list: 'L1', ids: ['a'] }), layout)
    expect(calls).toEqual([['saved', { config: { list: 'L1', ids: ['a'] }, previousConfig: binding.config }]])
    calls.length = 0
    await formTargetSaved(ctx(), form({ list: 'L2' }), layout)
    expect(calls).toEqual([['deleted', { formId: 'f1', config: binding.config }], ['saved', { config: { list: 'L2' }, previousConfig: null }]])
    calls.length = 0
    // Without identity every config change is a new binding (as before).
    delete provider.identity
    await formTargetSaved(ctx(), form({ list: 'L1', ids: ['a'] }), layout)
    expect(calls.map(([k]) => k)).toEqual(['deleted', 'saved'])
    calls.length = 0
    // Unbound: the old provider is told; a provider that can't be reached keeps its binding on a field edit.
    await formTargetSaved(ctx(), { id: 'f1', name: 'F', version: 3, fields, layout: { rows: [] } }, layout)
    expect(calls.map(([k]) => k)).toEqual(['deleted'])
    calls.length = 0
    provider.identity = (c) => String(c.list)
    vi.mocked(formTargetDeps.assertAccess).mockRejectedValueOnce(new Error('not licensed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await formTargetSaved(ctx(), form({ list: 'L1', ids: ['z'] }), layout)
    expect(calls).toEqual([])
    expect(warn).toHaveBeenCalled()
    await formTargetDeleted(ctx(), 'f1', layout)
    expect(calls).toEqual([['deleted', { formId: 'f1', config: binding.config }]])
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
    // delete: only this extension's forms reach the form service.
    deletedForms.ids = []
    expect(await extCtx.forms.delete('0f000000-0000-4000-8000-00000000f002')).toEqual({ deleted: false })
    expect(await extCtx.forms.delete('0f000000-0000-4000-8000-00000000f003')).toEqual({ deleted: false })
    expect(await extCtx.forms.delete('nope')).toEqual({ deleted: false })
    expect(await extCtx.forms.delete('0f000000-0000-4000-8000-00000000f001')).toEqual({ deleted: true })
    expect(deletedForms.ids).toEqual(['0f000000-0000-4000-8000-00000000f001'])
  })
})

describe('designer: describe / bind / actions', () => {
  beforeEach(() => { vi.spyOn(formTargetDeps, 'context').mockImplementation(async () => ({}) as never) })
  const form = { id: 'f', name: 'F', version: 1, fields, layout }

  it('bounds the description: known field types only, http(s) links, group / isNew passed through, tokens by name', async () => {
    provider = {
      label: 'x', submit: async () => ({ record: { id: '1' } }),
      describe: async () => ({
        title: 'Acme list "Requests"', link: { label: 'Open', url: 'javascript:alert(1)' },
        sourceFields: [
          { key: 'Title', label: 'Title', typeLabel: 'Text', fieldTypes: ['text', 'bogus' as never], required: true, group: 'columns' },
          { key: 'New1', label: 'New one', typeLabel: 'Number', fieldTypes: ['number'], group: 'columns', isNew: true },
        ],
        mappings: [{ field: 'title', source: 'Title' }],
        tokens: { return_url: 'Back to the list', 'url.edit': 'Edit form', evil: 'x' },
      }),
    }
    const out = await (await import('@/lib/services/form-targets')).describeFormTarget(ctx(), form)
    expect(out.description?.link ?? null).toBeNull()
    expect(out.description?.sourceFields[0]).toMatchObject({ key: 'Title', fieldTypes: ['text'], required: true, group: 'columns' })
    expect(out.description?.sourceFields[1]).toMatchObject({ isNew: true })
    expect(out.description?.tokens).toEqual({ return_url: 'Back to the list', 'url.edit': 'Edit form' })
    expect(out).toMatchObject({ actions: false, bind: false })
  })

  it('bind returns the new binding and only new fields; it never changes what the form is connected to', async () => {
    const { bindFormTarget } = await import('@/lib/services/form-targets')
    provider = {
      label: 'x', submit: async () => ({ record: { id: '1' } }),
      identity: (c) => String(c.list),
      bind: async ({ form: f }) => ({ config: { ...f.config, ids: ['a'] }, fields: [{ key: 'title', label: 'Dup', type: 'text' }, { key: 'due', label: 'Due', type: 'date' }] }),
    }
    const out = await bindFormTarget(ctx(), form, { mappings: [{ field: 'title', source: null }] })
    expect((out.layout.data_target as { config: unknown }).config).toEqual({ list: 'L1', ids: ['a'] })
    expect(out.fields.map((f) => f.key)).toEqual(['due'])
    provider = { ...provider, bind: async () => ({ config: { list: 'OTHER' } }) }
    await expect(bindFormTarget(ctx(), form, {})).rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('connect the form to something else') })
    provider = { ...provider, bindPermission: 'ext.acme.write' }
    await expect(bindFormTarget(ctx(['forms.edit']), form, {})).rejects.toMatchObject({ status: 403 })
  })

  it('provider refusals (incompatible types) come back as field errors', async () => {
    const { bindFormTarget } = await import('@/lib/services/form-targets')
    provider = { label: 'x', submit: async () => ({ record: { id: '1' } }), bind: async () => { throw new ExtensionError('invalid_mapping', '"Due" (Date) can\'t hold this kind of field.', 400, { fields: { amount: '"Due" (Date) can\'t hold this kind of field.' } }) } }
    await expect(bindFormTarget(ctx(), form, { mappings: [{ field: 'amount', source: 'Due' }] })).rejects.toMatchObject({ status: 400, details: { fields: { amount: expect.stringContaining("can't hold") } } })
  })

  it('runs actions with the message; providers without actions refuse', async () => {
    const { runFormTargetAction } = await import('@/lib/services/form-targets')
    provider = { label: 'x', submit: async () => ({ record: { id: '1' } }), runAction: async ({ action }) => ({ message: `did ${action}` }) }
    expect(await runFormTargetAction(ctx(), form, 'use_sharepoint')).toEqual({ message: 'did use_sharepoint' })
    provider = { label: 'x', submit: async () => ({ record: { id: '1' } }) }
    await expect(runFormTargetAction(ctx(), form, 'x')).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('hostRedirectUrl', () => {
  it('passes http(s), keeps other forms in the frame, makes app paths absolute', async () => {
    const { hostRedirectUrl } = await import('@/lib/forms/embed')
    expect(hostRedirectUrl('https://sp.example/list', 'https://app.example')).toBe('https://sp.example/list')
    expect(hostRedirectUrl('/f/abc?x=1', 'https://app.example')).toBeNull()
    expect(hostRedirectUrl('/tasks', 'https://app.example')).toBe('https://app.example/tasks')
    expect(hostRedirectUrl('//evil.example', 'https://app.example')).toBeNull()
    expect(hostRedirectUrl(null, 'https://app.example')).toBeNull()
  })
})

describe('bar buttons: look and feel, show-when, provider defaults', () => {
  it('keeps icon, size, colour, outline, hidden (any kind) and a show-when rule; drops junk', async () => {
    const { normalizeFormButtons, barButtonShown } = await import('@/lib/forms/buttons')
    const [save, del] = normalizeFormButtons([
      { id: 'save', kind: 'submit', label: 'Save', style: 'outline', icon: 'save', icon_after: true, size: 'lg', color: '#A945B0', visible_when: { field: 'status', operator: 'equals', value: 'Done' } },
      { id: 'delete', kind: 'delete', label: 'Delete item', style: 'danger', hidden: true, icon: 'not-an-icon', size: 'xl', color: 'red' },
    ])
    expect(save).toMatchObject({ style: 'outline', icon: 'save', icon_after: true, size: 'lg', color: '#a945b0', visible_when: { field: 'status', operator: 'equals', value: 'Done' } })
    expect(del).toMatchObject({ hidden: true })
    expect(del).not.toHaveProperty('icon'); expect(del).not.toHaveProperty('size'); expect(del).not.toHaveProperty('color')
    expect(barButtonShown(save, { status: 'Done' })).toBe(true)
    expect(barButtonShown(save, { status: 'New' })).toBe(false)
    expect(barButtonShown(del, {})).toBe(false)
  })

  it('passes the provider\'s default buttons (normalized, its ids only) and their name', async () => {
    const { normalizeTargetDescription } = await import('@/lib/services/form-targets')
    const d = normalizeTargetDescription({ title: 't', sourceFields: [], mappings: [], defaultButtons: [{ id: 'save', kind: 'submit', label: 'Save', style: 'primary', actions: [{ type: 'redirect', url: '{{target.return_url}}' }] }, { id: 'cancel', kind: 'cancel', label: 'Cancel', style: 'secondary' }], defaultsLabel: 'SharePoint default' })
    expect(d?.defaultButtons?.map((b) => b.id)).toEqual(['save', 'cancel'])
    expect(d?.defaultsLabel).toBe('SharePoint default')
    expect(normalizeTargetDescription({ title: 't', sourceFields: [], mappings: [] })).not.toHaveProperty('defaultButtons')
  })

  it('canvas reorder moves one button, ignores moves out of range', async () => {
    const { moveButton } = await import('@/components/forms/designer/canvas-button-bar')
    const bs = ['save', 'cancel', 'delete'].map((id) => ({ id, kind: 'submit', label: id, style: 'primary' })) as never[]
    expect((moveButton(bs, 1, 0) as Array<{ id: string }>).map((b) => b.id)).toEqual(['cancel', 'save', 'delete'])
    expect(moveButton(bs, 0, -1)).toBe(bs)
  })
})
