import { z } from 'zod'
import { getDb } from '../context'
import { loadGovernanceData } from '@/lib/governance-data'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/**
 * Governance: the settings page, object-permission pickers and overview,
 * retention-policy picker, and asset dependency scans (integrations,
 * references, data tables).
 */

interface Dep { id: string; name: string }
export interface AssetDeps {
  workflows: Dep[]
  tables: Dep[]
  references: Dep[]
  integrations: Dep[]
  tasks: number
  submissions: number
  runs: number
}

type ObjectType = 'workflow' | 'data_table' | 'agent' | 'integration'

const emptyDeps = (): AssetDeps => ({ workflows: [], tables: [], references: [], integrations: [], tasks: 0, submissions: 0, runs: 0 })

/** Workflows whose nodes match — scanned here so the browser gets names, not every workflow's nodes. */
async function workflowsUsing(db: any, matches: (config: any) => boolean): Promise<Dep[]> {
  const { data: wfs } = await db.from('workflows').select('id, name, nodes')
  const out: Dep[] = []
  for (const wf of (wfs ?? []) as Array<{ id: string; name: string; nodes: unknown }>) {
    const nodes = (wf.nodes as any[]) ?? []
    if (nodes.some((n: any) => matches(n?.config))) out.push({ id: wf.id, name: wf.name })
  }
  return out
}

const tenantArgs = z.object({ tenantId: id })

/** Retention policy scopes (retention_policies.applies_to values). */
const retentionScope = z.enum(['data_tables', 'data_rows', 'roles'])

export const reads = {
  /** Settings → Governance: roles, users with role assignments, retention policies, audit log. */
  'governance.settingsPage': defineRead({
    args: tenantArgs,
    perm: 'team.change_roles',
    run: async (ctx, { tenantId }) => loadGovernanceData(getDb(ctx) as any, tenantId),
  }),

  // Grantee pickers for object permissions. ObjectPermissions is embedded in
  // many designers, so these are ungated: RLS is the boundary.
  'governance.roleOptions': defineRead({
    args: tenantArgs,
    run: async (ctx, { tenantId }) => {
      const { data } = await (getDb(ctx) as any).from('roles').select('id, name, slug').eq('tenant_id', tenantId).order('name')
      return (data ?? []) as { id: string; name: string; slug: string }[]
    },
  }),

  'governance.teamOptions': defineRead({
    args: tenantArgs,
    run: async (ctx, { tenantId }) => {
      const { data } = await (getDb(ctx) as any).from('teams').select('id, name').eq('tenant_id', tenantId).order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
  }),

  'governance.userOptions': defineRead({
    args: tenantArgs,
    run: async (ctx, { tenantId }) => {
      const { data } = await (getDb(ctx) as any).from('users').select('id, display_name, email')
        .eq('tenant_id', tenantId).is('deleted_at', null).order('display_name')
      return (data ?? []) as { id: string; display_name: string; email: string }[]
    },
  }),

  /** Every permissionable object in the tenant (governance overview). */
  'governance.permissionObjects': defineRead({
    args: tenantArgs,
    perm: 'team.change_roles',
    run: async (ctx, { tenantId }) => {
      const db = getDb(ctx) as any
      const [workflows, tables, agents, integrations] = await Promise.all(
        ['workflows', 'custom_tables', 'agents', 'integrations']
          .map((table) => db.from(table).select('id, name').eq('tenant_id', tenantId).order('name')),
      ) as Array<{ data: { id: string; name: string }[] | null }>
      const results: { type: ObjectType; id: string; name: string; href: string }[] = []
      workflows.data?.forEach((w) => results.push({ type: 'workflow', id: w.id, name: w.name, href: `/automations/${w.id}` }))
      tables.data?.forEach((t) => results.push({ type: 'data_table', id: t.id, name: t.name, href: `/data/${t.id}` }))
      agents.data?.forEach((a) => results.push({ type: 'agent', id: a.id, name: a.name, href: `/agents/${a.id}` }))
      integrations.data?.forEach((i) => results.push({ type: 'integration', id: i.id, name: i.name, href: `/integrations/${i.id}` }))
      return results
    },
  }),

  /** Objects that have any permission rows (deduplicated here). */
  'governance.restrictedObjects': defineRead({
    args: NO_ARGS,
    perm: 'team.change_roles',
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('object_permissions').select('object_type, object_id')
      const seen = new Set<string>()
      return ((data ?? []) as { object_type: string; object_id: string }[]).filter((d) => {
        const key = `${d.object_type}:${d.object_id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).map(({ object_type, object_id }) => ({ object_type, object_id }))
    },
  }),

  /** Retention policies that apply to a scope (data table, row, role pickers). */
  'governance.retentionPolicies': defineRead({
    args: z.object({ scope: retentionScope }),
    perm: ['data.view', 'team.change_roles'],
    run: async (ctx, { scope }) => {
      const data = check(await (getDb(ctx) as any).from('retention_policies')
        .select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to')
        .order('name')) as Array<{ applies_to?: string[] | null } & Record<string, any>> | null
      return (data ?? []).filter((policy) => (policy.applies_to ?? []).includes(scope)) as any[]
    },
  }),

  /** An integration's references and the workflows that call them. */
  'governance.integrationDependencies': defineRead({
    args: z.object({ integrationId: id }),
    perm: 'integrations.view',
    run: async (ctx, { integrationId }) => {
      const db = getDb(ctx) as any
      const deps = emptyDeps()
      const { data: refs } = await db.from('integration_references').select('id, name').eq('integration_id', integrationId)
      deps.references = ((refs ?? []) as Dep[]).map(({ id, name }) => ({ id, name }))
      const refIds = deps.references.map((r) => r.id)
      if (refIds.length > 0) {
        deps.workflows = await workflowsUsing(db, (c) => refIds.includes(c?.referenceId ?? c?.reference_id))
      }
      return deps
    },
  }),

  /** Workflows that call an integration reference. */
  'governance.referenceDependencies': defineRead({
    args: z.object({ referenceId: id }),
    perm: 'integrations.view',
    run: async (ctx, { referenceId }) => {
      const deps = emptyDeps()
      deps.workflows = await workflowsUsing(getDb(ctx), (c) => (c?.referenceId ?? c?.reference_id) === referenceId)
      return deps
    },
  }),

  /** A data table's row count and the workflows that use it. */
  'governance.tableDependencies': defineRead({
    args: z.object({ tableId: id }),
    perm: 'data.view',
    run: async (ctx, { tableId }) => {
      const db = getDb(ctx) as any
      const deps = emptyDeps()
      const [{ count }, workflows] = await Promise.all([
        db.from('custom_table_rows').select('id', { count: 'exact', head: true }).eq('table_id', tableId),
        workflowsUsing(db, (c) => (c?.tableId ?? c?.table_id) === tableId),
      ])
      deps.submissions = count ?? 0 // reusing submissions as "rows"
      deps.workflows = workflows
      return deps
    },
  }),
} satisfies Record<string, UiRead<any, any>>
