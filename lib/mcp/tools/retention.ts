import type { McpToolServer } from '../server'
import type { McpContext } from '../server'
import { mcpErr, mcpOk } from '../server'
import { z } from 'zod'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '@/lib/mcp/descriptions'
import { getRetentionPolicyUsageSummary, RETENTION_APPLIES_TO, RETENTION_ASSIGNMENT_TARGETS } from '@/lib/retention-policy-api'
import { fromMcpContext } from '@/lib/services/context'
import { assignRetentionPolicy, listRetentionPolicyAssets } from '@/lib/services/retention'
import { messageOf } from './_util'

const appliesToEnum = z.enum(RETENTION_APPLIES_TO)
const retentionModeEnum = z.enum(['review', 'review_on_exact_date', 'purge_on', 'purge_on_exact_date', 'keep_forever'])

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeRetentionPayload(args: {
  policy_mode?: 'review' | 'review_on_exact_date' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
  duration_value?: number
  duration_unit?: 'days' | 'months' | 'years'
  exact_date?: string
}) {
  if (!args.policy_mode) return { ok: true as const, payload: null }

  if (args.policy_mode === 'keep_forever') {
    return {
      ok: true as const,
      payload: { duration_value: null, duration_unit: null, exact_date: null },
    }
  }

  if (args.policy_mode === 'review_on_exact_date' || args.policy_mode === 'purge_on_exact_date') {
    const exactDate = normalizeText(args.exact_date)
    if (!exactDate) return {
      ok: false as const,
      error: `exact_date is required for ${args.policy_mode}`,
    }
    const parsed = new Date(exactDate)
    if (Number.isNaN(parsed.getTime())) return { ok: false as const, error: 'exact_date must be a valid date' }
    return {
      ok: true as const,
      payload: { duration_value: null, duration_unit: null, exact_date: parsed.toISOString() },
    }
  }

  if (!Number.isFinite(args.duration_value) || Number(args.duration_value) <= 0) {
    return { ok: false as const, error: 'duration_value must be greater than 0' }
  }
  if (!args.duration_unit) {
    return { ok: false as const, error: 'duration_unit is required for interval retention policies' }
  }

  return {
    ok: true as const,
    payload: {
      duration_value: Number(args.duration_value),
      duration_unit: args.duration_unit,
      exact_date: null,
    },
  }
}

export function registerRetentionTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase, actingUserId } = ctx

  server.tool('retention_policies_list', 'List and search centrally governed retention policies, optionally filtering by scope or policy mode so MCP can discover reusable governance rules for tables/lists, rows, roles and forms.', {
    search: z.string().optional().describe('Optional search on policy name or description'),
    applies_to: appliesToEnum.optional().describe('Optional scope filter: data tables, data rows, roles or forms'),
    policy_mode: retentionModeEnum.optional().describe('Optional policy mode filter'),
    limit: z.number().optional().describe('Max results, default 100, hard cap 200'),
  }, async (args) => {
    let query = (supabase as any)
      .from('retention_policies')
      .select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('name')
      .limit(Math.min(args.limit ?? 100, 200))

    if (args.policy_mode) query = query.eq('policy_mode', args.policy_mode)

    const { data, error } = await query
    if (error) return mcpErr(error.message)

    const needle = normalizeText(args.search).toLowerCase()
    const policies = (data ?? []).filter((policy: any) => {
      if (args.applies_to && !(policy.applies_to ?? []).includes(args.applies_to)) return false
      if (!needle) return true
      return `${policy.name ?? ''} ${policy.description ?? ''}`.toLowerCase().includes(needle)
    })

    return mcpOk({ retention_policies: policies, count: policies.length })
  })

  server.tool('retention_policies_list_assets', 'List which tables, rows, roles and forms currently use a retention policy so MCP can assess governance coverage and cleanly plan updates or deletions.', {
    retention_policy_id: z.string().describe('Retention policy ID'),
    include_data_tables: z.boolean().optional().describe('Include data tables/lists using this policy'),
    include_data_rows: z.boolean().optional().describe('Include individual rows using this policy'),
    include_roles: z.boolean().optional().describe('Include roles using this policy'),
    include_forms: z.boolean().optional().describe('Include forms using this policy (a form\'s policy governs its submissions)'),
    limit_per_type: z.number().optional().describe('Max rows per target type, default 100, hard cap 500'),
  }, async (args) => {
    const { data: policy, error: policyError } = await (supabase as any)
      .from('retention_policies')
      .select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to')
      .eq('tenant_id', tenantId)
      .eq('id', args.retention_policy_id)
      .single()
    if (policyError || !policy) return mcpErr(policyError?.message ?? 'Retention policy not found')

    const limit = Math.min(args.limit_per_type ?? 100, 500)
    try {
      const assets = await listRetentionPolicyAssets(supabase, tenantId, args.retention_policy_id, {
        data_tables: args.include_data_tables ?? true,
        data_rows: args.include_data_rows ?? true,
        roles: args.include_roles ?? true,
        forms: args.include_forms ?? true,
      }, limit)
      const usage = await getRetentionPolicyUsageSummary(supabase, tenantId, args.retention_policy_id)
      return mcpOk({ retention_policy: policy, usage, assets })
    } catch (error) {
      return mcpErr(messageOf(error, 'Could not list the policy assets'))
    }
  })

  server.tool('retention_policies_get', 'Get a single retention policy by ID so MCP can inspect exact retention behavior before assignment or reuse.', {
    retention_policy_id: z.string().describe('Retention policy ID'),
  }, async (args) => {
    const { data, error } = await (supabase as any)
      .from('retention_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', args.retention_policy_id)
      .single()
    if (error || !data) return mcpErr(error?.message ?? 'Retention policy not found')
    return mcpOk({ retention_policy: data })
  })

  server.tool('retention_policies_create', MCP_CORE_TOOL_DESCRIPTIONS.retention_policies_create, {
    name: z.string().describe('Retention policy name'),
    description: z.string().optional().describe('Optional description'),
    policy_mode: retentionModeEnum.describe('Retention mode'),
    duration_value: z.number().optional().describe('Duration number for interval modes'),
    duration_unit: z.enum(['days', 'months', 'years']).optional().describe('Duration unit for interval modes'),
    exact_date: z.string().optional().describe('Exact purge date for purge_on_exact_date'),
    applies_to: z.array(appliesToEnum).optional().describe('Scopes this policy can be applied to. Defaults to all supported scopes.'),
  }, async (args) => {
    const name = normalizeText(args.name)
    if (!name) return mcpErr('name is required')

    const retention = normalizeRetentionPayload(args)
    if (!retention.ok) return mcpErr(retention.error)
    if ((args.applies_to ?? []).includes('roles') && ['purge_on', 'purge_on_exact_date'].includes(args.policy_mode)) {
      return mcpErr('Roles support review-style retention policies only')
    }

    const { data, error } = await (supabase as any)
      .from('retention_policies')
      .insert({
        tenant_id: tenantId,
        name,
        description: normalizeText(args.description) || null,
        policy_mode: args.policy_mode,
        duration_value: retention.payload?.duration_value ?? null,
        duration_unit: retention.payload?.duration_unit ?? null,
        exact_date: retention.payload?.exact_date ?? null,
        applies_to: args.applies_to?.length ? args.applies_to : [...RETENTION_APPLIES_TO],
        created_by: actingUserId ?? null,
        updated_by: actingUserId ?? null,
      })
      .select('id, name, policy_mode, duration_value, duration_unit, exact_date, applies_to')
      .single()
    if (error || !data) return mcpErr(error?.message ?? 'Failed to create retention policy')
    return mcpOk({ created: true, retention_policy: data })
  })

  server.tool('retention_policies_update', 'Update a centrally governed retention policy, including its mode, timing, description, and allowed scopes. Roles support review-style retention only.', {
    retention_policy_id: z.string().describe('Retention policy ID'),
    name: z.string().optional().describe('Updated retention policy name'),
    description: z.string().optional().describe('Updated description'),
    policy_mode: retentionModeEnum.optional().describe('Updated retention mode'),
    duration_value: z.number().optional().describe('Duration number for interval modes'),
    duration_unit: z.enum(['days', 'months', 'years']).optional().describe('Duration unit for interval modes'),
    exact_date: z.string().optional().describe('Exact review/purge date for exact-date modes'),
    applies_to: z.array(appliesToEnum).optional().describe('Updated scopes this policy can be applied to'),
  }, async (args) => {
    const { data: existing, error: existingError } = await (supabase as any)
      .from('retention_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', args.retention_policy_id)
      .single()
    if (existingError || !existing) return mcpErr(existingError?.message ?? 'Retention policy not found')

    const nextPolicyMode = args.policy_mode ?? existing.policy_mode
    const retention = normalizeRetentionPayload({
      policy_mode: nextPolicyMode,
      duration_value: args.duration_value ?? existing.duration_value ?? undefined,
      duration_unit: args.duration_unit ?? existing.duration_unit ?? undefined,
      exact_date: args.exact_date ?? existing.exact_date ?? undefined,
    })
    if (!retention.ok) return mcpErr(retention.error)

    const appliesTo = args.applies_to?.length ? args.applies_to : (existing.applies_to ?? [...RETENTION_APPLIES_TO])
    if (appliesTo.includes('roles') && ['purge_on', 'purge_on_exact_date'].includes(nextPolicyMode)) {
      return mcpErr('Roles support review-style retention policies only')
    }

    const name = args.name !== undefined ? normalizeText(args.name) : normalizeText(existing.name)
    if (!name) return mcpErr('name is required')

    const { data, error } = await (supabase as any)
      .from('retention_policies')
      .update({
        name,
        description: args.description !== undefined ? (normalizeText(args.description) || null) : existing.description,
        policy_mode: nextPolicyMode,
        duration_value: retention.payload?.duration_value ?? null,
        duration_unit: retention.payload?.duration_unit ?? null,
        exact_date: retention.payload?.exact_date ?? null,
        applies_to: appliesTo,
        updated_by: actingUserId ?? existing.updated_by ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', args.retention_policy_id)
      .select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to, updated_at')
      .single()
    if (error || !data) return mcpErr(error?.message ?? 'Failed to update retention policy')

    return mcpOk({ updated: true, retention_policy: data })
  })

  server.tool('retention_policies_delete', 'Delete a retention policy after confirming it is no longer assigned to any tables, rows, or roles.', {
    retention_policy_id: z.string().describe('Retention policy ID'),
    force: z.boolean().optional().describe('Reserved for future use. Currently deletions require zero assignments.'),
  }, async (args) => {
    const { data: existing, error: existingError } = await (supabase as any)
      .from('retention_policies')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('id', args.retention_policy_id)
      .single()
    if (existingError || !existing) return mcpErr(existingError?.message ?? 'Retention policy not found')

    const usage = await getRetentionPolicyUsageSummary(supabase, tenantId, args.retention_policy_id)
    const totalUsage = Object.values(usage).reduce((sum, value) => sum + Number(value ?? 0), 0)
    if (totalUsage > 0) {
      return mcpErr(`Remove this policy from all assigned assets before deleting it. Current usage: ${JSON.stringify(usage)}`)
    }

    const { error } = await (supabase as any)
      .from('retention_policies')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', args.retention_policy_id)
    if (error) return mcpErr(error.message)

    return mcpOk({ deleted: true, retention_policy_id: args.retention_policy_id, retention_policy_name: existing.name })
  })

  server.tool('retention_policies_assign', 'Assign or clear a centrally governed retention policy on a table/list, individual row, role or form. Roles support review-style retention only; a form\'s policy governs its submissions (purge modes delete due submissions and their files unless the form is on legal hold).', {
    target_type: z.enum(RETENTION_ASSIGNMENT_TARGETS).describe('Target object type'),
    target_id: z.string().describe('Target object ID'),
    retention_policy_id: z.string().optional().describe('Retention policy ID to assign. Omit to clear the assignment.'),
  }, async (args) => {
    try {
      const result = await assignRetentionPolicy(fromMcpContext(ctx), { targetType: args.target_type, targetId: args.target_id, retentionPolicyId: args.retention_policy_id ?? null })
      return mcpOk({ updated: true, ...result })
    } catch (error) {
      return mcpErr(messageOf(error, 'Could not update the retention assignment'))
    }
  })
}
