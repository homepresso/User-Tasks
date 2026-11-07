/**
 * Forms in governance, without a database: the parity matrix covers the
 * governance operations on forms on every surface, grants on forms are
 * described with View / Submit, forms are a retention scope and an audit
 * filter with friendly labels, the retention cut-off for submissions, and
 * the permissions overview lists forms.
 */
import { describe, expect, it } from 'vitest'
import { SURFACE_PARITY } from '@/lib/surface-parity'
import { describeGrant, grantColumns, OBJECT_PERMISSION_META, OBJECT_PERMISSION_TYPES } from '@/lib/object-permission-types'
import { RETENTION_APPLIES_TO, RETENTION_ASSIGNMENT_TABLE_MAP, RETENTION_SCOPE_LABELS } from '@/lib/retention-policy-api'
import { AUDIT_OBJECT_TYPE_LABELS, auditActionLabel, auditObjectTypeLabel } from '@/lib/audit-labels'
import { formSubmissionCutoff } from '@/lib/retention-review'
import { hrefForObject } from '@/components/activity/activity-feed'
import { requiredToolPermission, AUDITED_IN_SERVICE } from '@/lib/mcp/authz'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

describe('forms governance: surface parity', () => {
  const formsOps = SURFACE_PARITY.find((r) => r.resource === 'forms')!.ops
  const op = (name: string) => formsOps.find((o) => o.op === name)

  it.each([
    ['governance', 'GET /forms/{id}/governance', 'forms_governance_get', 'forms governance'],
    ['legal hold', 'POST /forms/{id}/legal-hold', 'forms_legal_hold', 'forms legal-hold'],
    ['assign retention policy', 'POST /retention-policies/assign', 'retention_policies_assign', 'retention assign'],
    ['list grants', 'GET /object-permissions', 'object_permissions_list', 'object-permissions list'],
    ['set grant', 'POST /object-permissions', 'object_permissions_set', 'object-permissions set'],
    ['remove grant', 'DELETE /object-permissions/{id}', 'object_permissions_remove', 'object-permissions remove'],
    ['audit history', 'GET /audit-log', 'object_audit_log_query', 'audit-log list'],
  ])('forms › %s is on REST, MCP and the CLI', (name, rest, mcp, cli) => {
    expect(op(name)).toMatchObject({ rest, mcp, cli })
  })

  it('lists object permissions and the audit log as resources', () => {
    expect(SURFACE_PARITY.find((r) => r.resource === 'object permissions')?.ops.map((o) => o.op)).toEqual(['list', 'get', 'create', 'update', 'delete'])
    expect(SURFACE_PARITY.find((r) => r.resource === 'audit log')?.ops.find((o) => o.op === 'list')).toMatchObject({ rest: 'GET /audit-log', mcp: 'object_audit_log_query', cli: 'audit-log list' })
  })

  it('gates the MCP governance tools with team.change_roles and audits them once, in the service', () => {
    for (const tool of ['object_permissions_list', 'object_permissions_set', 'object_permissions_remove', 'forms_legal_hold']) {
      expect(requiredToolPermission(tool), tool).toBe('team.change_roles')
    }
    expect(requiredToolPermission('forms_governance_get')).toBe('forms.view')
    for (const tool of ['object_permissions_set', 'object_permissions_remove', 'forms_legal_hold', 'retention_policies_assign']) {
      expect(AUDITED_IN_SERVICE.has(tool), tool).toBe(true)
    }
  })
})

describe('forms governance: grants, retention scope and audit labels', () => {
  it('forms grants use View and Submit', () => {
    expect(OBJECT_PERMISSION_TYPES).toContain('form')
    expect(grantColumns('form')).toEqual(['can_view', 'can_execute'])
    expect(OBJECT_PERMISSION_META.form.execute).toBe('Submit')
    expect(describeGrant('form', { can_view: true, can_edit: true, can_execute: true })).toBe('View, Submit')
    expect(describeGrant('workflow', { can_view: true, can_execute: true })).toBe('View, Execute')
    expect(describeGrant('data_table', { can_view: true, can_execute: true })).toBe('View')
    expect(describeGrant('form', {})).toBe('no access')
  })

  it('forms are a retention scope assigned on the forms table', () => {
    expect(RETENTION_APPLIES_TO).toContain('forms')
    expect(RETENTION_SCOPE_LABELS.forms).toBe('Forms (submissions)')
    expect(RETENTION_ASSIGNMENT_TABLE_MAP.form).toEqual({ table: 'forms', scope: 'forms' })
  })

  it('forms are a filterable audit object type with friendly labels and links', () => {
    expect(AUDIT_OBJECT_TYPE_LABELS.form).toBe('Form')
    expect(auditObjectTypeLabel('form_theme')).toBe('Form theme')
    expect(auditActionLabel('legal_hold')).toBe('Legal hold placed')
    expect(auditActionLabel('purge')).toBe('Purged')
    expect(auditActionLabel('something_new')).toBe('something new')
    expect(hrefForObject('form', 'f1')).toBe('/automations/forms?details=f1')
  })

  it('computes the submission cut-off of a purge policy', () => {
    const now = new Date('2026-11-13T12:00:00Z')
    expect(formSubmissionCutoff({ policy_mode: 'purge_on', duration_value: 30, duration_unit: 'days' }, now)).toBe('2026-10-14T12:00:00.000Z')
    expect(formSubmissionCutoff({ policy_mode: 'purge_on', duration_value: 1, duration_unit: 'years' }, now)).toBe('2025-11-13T12:00:00.000Z')
    // Exact date: only once it has come, and everything submitted before it.
    expect(formSubmissionCutoff({ policy_mode: 'purge_on_exact_date', exact_date: '2026-12-01T00:00:00Z' }, now)).toBeNull()
    expect(formSubmissionCutoff({ policy_mode: 'purge_on_exact_date', exact_date: '2026-11-01T00:00:00Z' }, now)).toBe('2026-11-01T00:00:00.000Z')
    expect(formSubmissionCutoff({ policy_mode: 'review', duration_value: 30, duration_unit: 'days' }, now)).toBeNull()
    expect(formSubmissionCutoff({ policy_mode: 'keep_forever' }, now)).toBeNull()
  })
})

describe('forms governance: permissions overview', () => {
  it('lists the workspace forms next to workflows and data tables, linked to their Details', async () => {
    const db = createMemorySupabase({
      workflows: [{ id: 'wf1', name: 'Approve', tenant_id: 'tenant-a' }],
      custom_tables: [{ id: 'tb1', name: 'Claims', tenant_id: 'tenant-a' }],
      forms: [{ id: 'fm1', name: 'Expense claim', tenant_id: 'tenant-a' }, { id: 'fm2', name: 'Elsewhere', tenant_id: 'tenant-b' }],
      agents: [], integrations: [],
    })
    const ctx = { db: db as any, supabase: db as any, tenantId: 'tenant-a', actorId: 'u1', permissions: new Set(['team.change_roles']), authKind: 'session', source: 'ui' } as ServiceContext
    const { data } = await runUiRead(ctx, { name: 'governance.permissionObjects', args: { tenantId: 'tenant-a' } }) as any
    expect(data).toContainEqual({ type: 'form', id: 'fm1', name: 'Expense claim', href: '/automations/forms?details=fm1', in_menu: false })
    expect(data).toContainEqual({ type: 'workflow', id: 'wf1', name: 'Approve', href: '/automations/wf1' })
    expect(data.some((o: any) => o.id === 'fm2')).toBe(false)
  })
})
