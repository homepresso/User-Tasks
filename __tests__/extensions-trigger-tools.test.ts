/**
 * Record-change trigger tools of the extension SDK: field-change filters
 * (evaluateFieldFilters and friends), the trigger manifest's filter builder
 * and preview declarations (validation, catalog entry, design-time source
 * guards with the trigger's licence feature), ctx.workflows.triggerConfigs
 * (what a poller must watch) and ctx.users.findByEmail (external user →
 * workspace member).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import {
  defineExtension, defineServerExtension, describeFieldFilters, evaluateFieldFilters, fieldFilterFields, fieldFilterOperators, parseFieldFilters,
} from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { createExtensionContext } from '@/lib/extensions/host'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { extensionCatalogEntry } from '@/lib/extensions/nodes'
import { guardsReferencing } from '@/lib/extensions/ui-server'
import { invalidateExtensionTriggerCache } from '@/lib/extensions/triggers'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000f0001'
const OTHER = '0e000000-0000-4000-8000-0000000f0002'

const manifest = {
  manifest_version: 1, id: 'crm', name: 'CRM', version: '1.0.0', publisher: { id: 'crm', name: 'CRM' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'paid', sku: 'crm', features: ['connector', 'trigger'] },
  deployments: ['cloud', 'self_hosted'],
  contributes: {
    triggers: [{
      key: 'record_changed', label: 'Record changed', description: 'A CRM record changed', feature: 'trigger',
      config: [
        { name: 'table', type: 'string', required: true },
        { name: 'events', type: 'array', items: { type: 'string' }, options: [{ value: 'created' }, { value: 'updated' }], default: ['created'] },
        { name: 'filters', type: 'object' },
      ],
      variables: [{ name: 'record_id', type: 'string' }],
      optionsFrom: { table: 'tables' },
      filters: { config: 'filters', fieldsFrom: 'record_fields' },
      previewFrom: 'record_preview',
    }],
    nodes: [{ key: 'lookup', label: 'Lookup', description: 'Look up', feature: 'connector', optionsFrom: { table: 'tables' }, inputs: [{ name: 'table', type: 'string' }], outputs: [] }],
  },
}

describe('field-change filters', () => {
  const types = { Status: 'choice', Amount: 'number', Due: 'date', Urgent: 'boolean', Tags: 'multichoice', Owner: 'user', Title: 'string' }
  const before = { Status: 'New', Amount: 900, Due: '2026-11-20T00:00:00Z', Urgent: false, Tags: ['a'], Owner: { id: 3, name: 'Ana B', email: 'anab@contoso.local' }, Title: 'Laptop' }

  it('passes when there is no filter', () => {
    expect(evaluateFieldFilters(null, { before, after: before })).toBe(true)
    expect(evaluateFieldFilters('', { before, after: before })).toBe(true)
    expect(evaluateFieldFilters({ rules: [] }, { before, after: before })).toBe(true)
  })

  it('"changes to" fires only on the matching change', () => {
    const f = { match: 'all', rules: [{ field: 'Status', op: 'changed_to', value: 'Submitted' }] }
    expect(evaluateFieldFilters(f, { before, after: { ...before, Status: 'Submitted' } }, { types })).toBe(true)
    expect(evaluateFieldFilters(f, { before: { ...before, Status: 'Submitted' }, after: { ...before, Status: 'Submitted', Title: 'x' } }, { types })).toBe(false)
    expect(evaluateFieldFilters(f, { before, after: { ...before, Status: 'Approved' } }, { types })).toBe(false)
    // Case-insensitive text, and "changes from".
    expect(evaluateFieldFilters({ rules: [{ field: 'Status', op: 'changed_from', value: 'new' }] }, { before, after: { ...before, Status: 'Approved' } }, { types })).toBe(true)
  })

  it('typed comparisons with "only when it changes"', () => {
    const f = { rules: [{ field: 'Amount', op: 'gt', value: 1000, changed: true }] }
    expect(evaluateFieldFilters(f, { before, after: { ...before, Amount: 1500 } }, { types })).toBe(true)
    expect(evaluateFieldFilters(f, { before: { ...before, Amount: 1500 }, after: { ...before, Amount: 1500, Title: 'y' } }, { types })).toBe(false)
    expect(evaluateFieldFilters(f, { before, after: { ...before, Amount: 950 } }, { types })).toBe(false)
    // Numbers given as text compare numerically, not as strings.
    expect(evaluateFieldFilters({ rules: [{ field: 'Amount', op: 'lte', value: '1000' }] }, { before, after: { ...before, Amount: '999.5' } }, { types })).toBe(true)
    // Dates as instants; a date-only value matches the whole day.
    expect(evaluateFieldFilters({ rules: [{ field: 'Due', op: 'lt', value: '2026-12-01' }] }, { before, after: before }, { types })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Due', op: 'eq', value: '2026-11-20' }] }, { before, after: { ...before, Due: '2026-11-20T15:30:00Z' } }, { types })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Urgent', op: 'changed_to', value: 'yes' }] }, { before, after: { ...before, Urgent: true } }, { types })).toBe(true)
  })

  it('structured and multi values match on any part; the changed list wins over values', () => {
    expect(evaluateFieldFilters({ rules: [{ field: 'Owner', op: 'contains', value: 'ANAB@contoso.local' }] }, { before, after: before }, { types })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Tags', op: 'contains', value: 'b' }] }, { before, after: { ...before, Tags: ['a', 'b'] } }, { types })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Tags', op: 'empty' }] }, { before, after: { ...before, Tags: [] } }, { types })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Title', op: 'changed' }] }, { before, after: before, changed: ['title'] })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Title', op: 'changed' }] }, { before, after: { ...before, Title: 'z' }, changed: [] })).toBe(false)
    // Created (no before): "changes to" holds.
    expect(evaluateFieldFilters({ rules: [{ field: 'Status', op: 'changed_to', value: 'New' }] }, { before: null, after: before }, { types })).toBe(true)
  })

  it('all vs any, parsing and helpers', () => {
    const rules = [{ field: 'Status', op: 'changed_to', value: 'Submitted' }, { field: 'Amount', op: 'gt', value: 5000 }]
    const after = { ...before, Status: 'Submitted' }
    expect(evaluateFieldFilters({ match: 'all', rules }, { before, after }, { types })).toBe(false)
    expect(evaluateFieldFilters({ match: 'any', rules }, { before, after }, { types })).toBe(true)
    expect(evaluateFieldFilters(JSON.stringify({ match: 'any', rules }), { before, after }, { types })).toBe(true)
    expect(parseFieldFilters([{ field: 'A', op: 'bogus' }])).toEqual({ match: 'all', rules: [{ field: 'A', op: 'changed' }] })
    expect(parseFieldFilters('not json')).toBeNull()
    expect(parseFieldFilters({ rules: Array.from({ length: 50 }, () => ({ field: 'A', op: 'changed' })) })?.rules).toHaveLength(20)
    expect(fieldFilterFields({ rules })).toEqual(['Status', 'Amount'])
    expect(fieldFilterOperators('number')).toContain('gt')
    expect(fieldFilterOperators('boolean')).not.toContain('contains')
    expect(fieldFilterOperators('user')).toContain('contains')
    // Without declared types: the rule's saved type, else the values.
    expect(evaluateFieldFilters({ rules: [{ field: 'Amount', op: 'gt', value: '1000' }] }, { before, after: { ...before, Amount: 1500 } })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Due', op: 'gt', value: '2026-11-01' }] }, { before, after: before })).toBe(true)
    expect(evaluateFieldFilters({ rules: [{ field: 'Code', op: 'gt', value: '9', type: 'number' }] }, { before: null, after: { Code: '10' } })).toBe(true)
    expect(parseFieldFilters({ rules: [{ field: 'A', op: 'eq', type: 'bogus' }] })?.rules[0]).toEqual({ field: 'A', op: 'eq' })
    expect(describeFieldFilters({ rules: [{ field: 'Amount', op: 'gt', value: 1000, changed: true }] }, { Amount: 'Amount (USD)' })).toBe('Amount (USD) is greater than 1000 (when it changes)')
  })
})

describe('trigger manifest: filter builder and preview', () => {
  it('validates the filters config field', () => {
    expect(parseExtensionManifest(manifest).contributes.triggers[0].previewFrom).toBe('record_preview')
    const missing = structuredClone(manifest) as any
    missing.contributes.triggers[0].filters = { config: 'nope', fieldsFrom: 'record_fields' }
    expect(() => parseExtensionManifest(missing)).toThrow(/filters\.config names "nope"/)
    const wrongType = structuredClone(manifest) as any
    wrongType.contributes.triggers[0].filters = { config: 'table', fieldsFrom: 'record_fields' }
    expect(() => parseExtensionManifest(wrongType)).toThrow(/must be of type object or json/)
  })

  describe('registered', () => {
    beforeEach(() => {
      registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'crm', triggers: { record_changed: {} } })] })
      invalidateExtensionTriggerCache()
    })
    afterEach(() => resetExtensionsForTest())

    it('carries filters and preview into the catalog entry', () => {
      const entry = extensionCatalogEntry('ext.crm.record_changed')
      expect(entry?.filters).toEqual({ config: 'filters', fieldsFrom: 'record_fields' })
      expect(entry?.previewFrom).toBe('record_preview')
    })

    it('guards the filter and preview sources for workflow editors with the trigger feature', () => {
      const parsed = parseExtensionManifest(manifest)
      for (const source of ['record_fields', 'record_preview']) {
        expect(guardsReferencing(parsed, { kind: 'data', name: source })).toEqual([{ anyPermission: ['workflows.edit', 'workflows.create'], feature: 'trigger' }])
      }
      // A source shared by a node (connector) and the trigger (trigger) has no single feature.
      expect(guardsReferencing(parsed, { kind: 'data', name: 'tables' })).toEqual([{ anyPermission: ['workflows.edit', 'workflows.create'] }])
    })

    it('lists the trigger settings of active workflows (published version first)', async () => {
      const node = (config: any) => [{ id: 't', type: 'ext.crm.record_changed', config }]
      db.current = createMemorySupabase({
        workflows: [
          { id: 'w1', tenant_id: TENANT, name: 'Draft edits', is_active: true, trigger_type: 'ext.crm.record_changed', published_version_id: 'v1', nodes: node({ table: 'draft' }) },
          { id: 'w2', tenant_id: TENANT, name: 'Unpublished', is_active: true, trigger_type: 'ext.crm.record_changed', published_version_id: null, nodes: node({ table: 'accounts' }) },
          { id: 'w3', tenant_id: TENANT, name: 'Inactive', is_active: false, trigger_type: 'ext.crm.record_changed', published_version_id: null, nodes: node({ table: 'x' }) },
          { id: 'w4', tenant_id: OTHER, name: 'Elsewhere', is_active: true, trigger_type: 'ext.crm.record_changed', published_version_id: null, nodes: node({ table: 'y' }) },
        ],
        workflow_versions: [{ id: 'v1', nodes: node({ table: 'contacts', events: ['updated'] }) }],
      }) as any
      const ctx = createExtensionContext({ extensionId: 'crm', tenantId: TENANT })
      const configs = await ctx.workflows.triggerConfigs('record_changed')
      expect(configs.map((c) => [c.workflowId, c.name, c.config.table]).sort()).toEqual([['w1', 'Draft edits', 'contacts'], ['w2', 'Unpublished', 'accounts']])
      expect(configs.find((c) => c.workflowId === 'w1')?.versionId).toBe('v1')
      await expect(ctx.workflows.triggerConfigs('nope')).rejects.toThrow(/no trigger/)
      await expect(createExtensionContext({ extensionId: 'crm', tenantId: null }).workflows.triggerConfigs('record_changed')).rejects.toThrow(/workspace/)
    })
  })
})

describe('ctx.users.findByEmail', () => {
  beforeEach(() => {
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'crm' })] })
    setEntitlementPort({ async check() { return { allowed: true, state: 'licensed', limits: {} } } })
  })
  afterEach(() => resetExtensionsForTest())

  it('finds active workspace members by e-mail, case-insensitively', async () => {
    db.current = createMemorySupabase({
      users: [
        { id: 'u1', email: 'anab@contoso.local', display_name: 'Ana B', deleted_at: null },
        { id: 'u2', email: 'Marie.B@Contoso.local', display_name: 'Marie B', deleted_at: null },
        { id: 'u3', email: 'gone@contoso.local', display_name: 'Gone', deleted_at: '2026-01-01T00:00:00Z' },
        { id: 'u4', email: 'other@contoso.local', display_name: 'Other workspace', deleted_at: null },
        { id: 'u5', email: 'left@contoso.local', display_name: 'Left', deleted_at: null },
      ],
      user_memberships: [
        { user_id: 'u1', tenant_id: TENANT, is_active: true },
        { user_id: 'u2', tenant_id: TENANT, is_active: true },
        { user_id: 'u3', tenant_id: TENANT, is_active: true },
        { user_id: 'u4', tenant_id: OTHER, is_active: true },
        { user_id: 'u5', tenant_id: TENANT, is_active: false },
      ],
    }) as any
    const ctx = createExtensionContext({ extensionId: 'crm', tenantId: TENANT })
    const found = await ctx.users.findByEmail(['ANAB@contoso.local', 'marie.b@contoso.local', 'gone@contoso.local', 'other@contoso.local', 'left@contoso.local', 'not-an-email', ''])
    expect(found.map((u) => u.id).sort()).toEqual(['u1', 'u2'])
    expect(found.find((u) => u.id === 'u1')).toEqual({ id: 'u1', email: 'anab@contoso.local', name: 'Ana B' })
    expect(await ctx.users.findByEmail([])).toEqual([])
  })
})
